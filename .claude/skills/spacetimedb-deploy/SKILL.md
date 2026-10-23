---
name: spacetimedb-deploy
description: >
  Publish the SpacetimeDB module and regenerate TypeScript client bindings.
  Always use this skill after any change to spacetimedb/src/schema.ts or
  spacetimedb/src/index.ts — including new/modified reducers, table definitions,
  or index changes. Do not skip even for small edits; the client will get
  runtime errors (e.g. "reducer X not found", "SenderError") until the module
  is republished and bindings are regenerated. Also use when the user explicitly
  runs `spacetime publish` or `spacetime generate`, or passes --clear to wipe
  the database.
---

# SpacetimeDB Deploy

Publish the SpacetimeDB server module and regenerate TypeScript client bindings
after changes to `spacetimedb/src/`. The client will produce runtime errors
calling new or modified reducers until both steps are complete.

## Configuration

| Setting                  | Value                                      |
|--------------------------|---------------------------------------------|
| Module path              | `spacetimedb/` (relative to repo root)     |
| Production database      | `redemption-multiplayer`                   |
| Dev database             | `redemption-multiplayer-dev`               |
| Server                   | `maincloud.spacetimedb.com` (default)      |
| Config file              | `spacetime.json` (repo root) — locked to production db |
| Client bindings output   | `lib/spacetimedb/module_bindings/`         |
| Env vars                 | `.env.local` — `NEXT_PUBLIC_SPACETIMEDB_HOST`, `NEXT_PUBLIC_SPACETIMEDB_DB_NAME` |
| CLI version              | ≥ 2.13.0 (`spacetime version list` / `spacetime version use 2.13.0`) |

**Important:** the CLI must be at least 2.13.0 to run `spacetime generate` or `publish`
against this module — the module depends on `spacetimedb` npm SDK 2.13, which imports
`spacetime:sys@2.2`; an older CLI fails with `Could not import "spacetime:sys@2.2" …
that version is not supported by the database` / `could not extract schema`. (Older
history: 2.3.0 failed with `unknown tag 0xd for sum type RawModuleDefV10Section`;
2.8.1 renamed the generated `tables` accessor keys to camelCase, with a back-compat
alias shim keeping the PascalCase names `tables.Game`, `tables.PregameState`, … working.)
Keep the SDK version in `spacetimedb/package.json` and root `package.json` in step.

**Important:** `.env.local` sets `NEXT_PUBLIC_SPACETIMEDB_DB_NAME=redemption-multiplayer-dev`,
so the local dev server connects to the **dev** database. Check which database the client
actually connects to before publishing — schema mismatches between the client bindings and
the deployed module cause BSATN deserialization errors at runtime.

## Steps

### 1. Publish the module

**Production** (uses `spacetime.json` config):
```bash
echo "y" | spacetime publish redemption-multiplayer --module-path spacetimedb
```

**Dev** (must bypass `spacetime.json` with `--no-config`):
```bash
echo "y" | spacetime publish redemption-multiplayer-dev --module-path "$(pwd)/spacetimedb" --no-config --server maincloud
```

The `echo "y"` is required — the CLI prompts for confirmation when publishing
to a non-local server and aborts without it.

**With `--clear`** (destroys all game data):
```bash
# Production
echo "y" | spacetime publish redemption-multiplayer --clear-database -y --module-path spacetimedb
# Dev
echo "y" | spacetime publish redemption-multiplayer-dev --clear-database -y --module-path "$(pwd)/spacetimedb" --no-config --server maincloud
```

⚠️ **After every `--clear` publish, run the step-1b verification** — `--clear`
wipes `forge_config` (this silently broke all Forge/PT games on 2026-07-14 with
"Could not authorize your seat — try again"; the module now carries a baked-in
default identity so seat auth survives the wipe, but verify anyway).

**Default behavior:** Publish to **both** production and dev databases unless the
user specifies one. Always publish dev first to catch migration issues early.

### 1b. After ANY `--clear` publish: verify Forge seat auth

`--clear` wipes `forge_config` (the trusted-server-identity singleton). The module
falls back to `FORGE_SERVER_IDENTITY_HEX_DEFAULT` (in `spacetimedb/src/index.ts`)
when the row is absent, so seat auth keeps working — **as long as that constant
matches the live `SPACETIMEDB_SERVER_TOKEN`**. There is ONE token everywhere:
Vercel production/preview holds a copy of `.env.local`'s token (identity
`c200c2ac41b9b91c641f0e40c14298b88f16978e456ff232926822af4eeaec63`).

Verify after a `--clear` (dev needs `--no-config --server maincloud` —
`spacetime.json` otherwise mangles the db name into a SQL parser error):

```bash
spacetime sql redemption-multiplayer "SELECT * FROM forge_config"   # empty = default identity in charge (fine)
spacetime logs redemption-multiplayer | grep "forge_authorize_seat" | tail -5   # no fresh "Not authorized"
```

**If the server token is rotated:** update `FORGE_SERVER_IDENTITY_HEX_DEFAULT` in
the module (republish) AND set the row at runtime. Derive the hex from the token's
JWT payload (`hex_identity` claim):

```bash
python3 -c "import base64,json;p=input('token: ').split('.')[1];print(json.loads(base64.urlsafe_b64decode(p+'='*(-len(p)%4)))['hex_identity'])"
# Arg is a bare JSON string, NOT a JSON array (array form fails with
# "trailing characters" on CLI v2.3.0). Owner CLI is always authorized.
spacetime call redemption-multiplayer set_forge_server_identity '"<new-identity-hex>"'
spacetime call --no-config --server maincloud redemption-multiplayer-dev set_forge_server_identity '"<new-identity-hex>"'
```

### 2. Regenerate client bindings
```bash
spacetime generate --lang typescript --out-dir lib/spacetimedb/module_bindings --module-path spacetimedb
```

Regenerates TypeScript types and reducer wrappers in
`lib/spacetimedb/module_bindings/`. These files are checked into git.

### 3. Check for binding changes
```bash
git diff --name-only lib/spacetimedb/module_bindings/
```

If bindings changed, commit them:
```bash
git add lib/spacetimedb/module_bindings/
git commit -m "chore: regenerate SpacetimeDB client bindings"
```

### 4. Verify the client compiles
```bash
npx tsc --noEmit 2>&1 | head -10
```

## Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `SenderError: Invalid zone for search: X` | Server doesn't know a new zone value | Republish the module |
| `reducer X not found` | Client bindings reference a reducer the server doesn't have | Republish + regenerate |
| `Publish aborted by user` | Missing `echo "y"` pipe | Use `echo "y" \| spacetime publish ...` |
| `reading 'tag'` on publish | Indexes defined in wrong position in `table()` call | Indexes go in the 1st arg (OPTIONS), not 2nd (COLUMNS) |
| Binding import errors | Stale generated types | Regenerate with `spacetime generate` |
| `Adding a column X requires a default value` | Existing rows can't auto-migrate with new column | Use `--clear-database -y` to wipe and republish, or add `.default()` to schema column |
| `No database target matches 'X'` | `spacetime.json` restricts to a single db name | Use `--no-config --server maincloud` with absolute `--module-path` |
| BSATN `RangeError: Tried to read N byte(s)` | Client bindings don't match deployed module schema | Republish the correct database (check `NEXT_PUBLIC_SPACETIMEDB_DB_NAME` in `.env.local`) + regenerate bindings |
| PT games: "Could not authorize your seat — try again" / `forge_authorize_seat: Not authorized` in `spacetime logs` | Server identity mismatch: `forge_config` row (or the baked-in default when empty) doesn't match the live `SPACETIMEDB_SERVER_TOKEN` — e.g. token rotated, or a stale pre-fallback module | Run step 1b (verify, and `set_forge_server_identity` with the token's real identity) |