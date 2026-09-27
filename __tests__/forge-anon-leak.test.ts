import { describe, it, expect } from "vitest";
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Load local env (Next convention); CI provides these as secrets.
config({ path: ".env.local" });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
// Opt-in: only runs under `npm run test:security` so the default unit run stays
// hermetic (no network). Requires the Supabase env to be present.
const ENABLED = process.env.FORGE_LEAK_TEST === "1" && !!URL && !!ANON;

// Every table that holds Forge secret data. EXTEND THIS as new Forge tables are
// added in later plans. The anon (public) role must see ZERO rows in each.
const FORGE_TABLES = [
  "playtest_members", "forge_invites", "forge_audit", "forge_cards",
  "forge_sets", "forge_set_elders", "forge_set_grants", "card_versions",
  "card_proposals", "card_comments", "forge_decks", "forge_card_art_candidates",
  "forge_public_releases", "forge_public_release_cards", "forge_deck_migration_backups",
];

// Built per test, not once in the describe body: vitest still evaluates the
// body of a skipped `describe.runIf`, so constructing the client up there
// threw "supabaseUrl is required" and failed the whole default run in any
// checkout without a .env.local (a fresh clone or a git worktree).
const anonClient = () => createClient(URL!, ANON!);

describe.runIf(ENABLED)("Forge anon-leak guardrail", () => {
  for (const table of FORGE_TABLES) {
    it(`anon sees zero rows in ${table}`, async () => {
      const { data, error } = await anonClient().from(table).select("*").limit(1000);
      const rows = data ?? [];
      // A permission error (REVOKE) or an empty result (RLS) is fine; a leak is not.
      expect(
        rows.length,
        `anon leaked ${rows.length} row(s) from ${table} (error: ${error?.message ?? "none"})`
      ).toBe(0);
    });
  }

  // Spec leak-test step 3: no Forge SECURITY DEFINER function is callable by anon.
  // (Calling with empty/placeholder args is fine — anon lacks EXECUTE, so PostgREST
  // rejects before the body runs. A success here means a grant leaked.)
  const FORGE_RPCS: Array<[string, Record<string, unknown>]> = [
    ["my_forge_role", {}],
    ["forge_role_of", { uid: "00000000-0000-0000-0000-000000000000" }],
    ["is_forge_member", {}],
    ["is_forge_elder_or_super", {}],
    ["forge_role_outranks", { actor_role: "elder", target_role: "playtester" }],
    ["forge_mint_invite", { p_token_hash: "x", p_role: "playtester", p_set_ids: [], p_email: null, p_expires_at: null }],
    ["forge_redeem_invite", { p_token_hash: "x", p_nda_agreed: false }],
    ["forge_add_member", { p_user_id: "00000000-0000-0000-0000-000000000000", p_role: "playtester" }],
    ["forge_remove_member", { p_user_id: "00000000-0000-0000-0000-000000000000" }],
    ["forge_change_role", { p_user_id: "00000000-0000-0000-0000-000000000000", p_new_role: "playtester" }],
    ["forge_set_profile", { p_display_name: "x", p_avatar_url: null }],
    ["forge_list_invites", {}],
    ["forge_create_card", { p_title: "x" }],
    ["forge_set_working_art", { p_card_id: "00000000-0000-0000-0000-000000000000", p_key: "x", p_original_key: "x" }],
    ["forge_set_working_finished", { p_card_id: "00000000-0000-0000-0000-000000000000", p_key: "x" }],
    ["forge_set_art_placeholder", { p_card_id: "00000000-0000-0000-0000-000000000000", p_is_placeholder: true }],
    ["forge_log_art_download", { p_card_id: "00000000-0000-0000-0000-000000000000" }],
    ["is_forge_superadmin", {}],
    ["forge_save_card", { p_card_id: "00000000-0000-0000-0000-000000000000", p_snapshot: {} }],
    ["is_forge_set_elder", { p_set_id: "00000000-0000-0000-0000-000000000000" }],
    ["is_forge_set_granted", { p_set_id: "00000000-0000-0000-0000-000000000000" }],
    ["forge_create_set", { p_name: "x" }],
    ["forge_rename_set", { p_set_id: "00000000-0000-0000-0000-000000000000", p_name: "x" }],
    ["forge_save_set_notes", { p_set_id: "00000000-0000-0000-0000-000000000000", p_notes: "x" }],
    ["forge_save_set_targets", { p_set_id: "00000000-0000-0000-0000-000000000000", p_targets: {} }],
    ["forge_add_set_elder", { p_set_id: "00000000-0000-0000-0000-000000000000", p_user_id: "00000000-0000-0000-0000-000000000000" }],
    ["forge_remove_set_elder", { p_set_id: "00000000-0000-0000-0000-000000000000", p_user_id: "00000000-0000-0000-0000-000000000000" }],
    ["forge_grant_set", { p_set_id: "00000000-0000-0000-0000-000000000000", p_user_id: "00000000-0000-0000-0000-000000000000" }],
    ["forge_revoke_set", { p_set_id: "00000000-0000-0000-0000-000000000000", p_user_id: "00000000-0000-0000-0000-000000000000" }],
    ["forge_share_card_to_set", { p_card_id: "00000000-0000-0000-0000-000000000000", p_set_id: "00000000-0000-0000-0000-000000000000" }],
    ["forge_send_card_to_private", { p_card_id: "00000000-0000-0000-0000-000000000000" }],
    ["forge_publish_card", { p_card_id: "00000000-0000-0000-0000-000000000000" }],
    ["forge_approve_card", { p_card_id: "00000000-0000-0000-0000-000000000000" }],
    ["forge_unapprove_card", { p_card_id: "00000000-0000-0000-0000-000000000000" }],
    ["forge_archive_card", { p_card_id: "00000000-0000-0000-0000-000000000000" }],
    ["forge_unarchive_card", { p_card_id: "00000000-0000-0000-0000-000000000000" }],
    ["forge_delete_card", { p_card_id: "00000000-0000-0000-0000-000000000000" }],
    ["forge_delete_set", { p_set_id: "00000000-0000-0000-0000-000000000000" }],
    ["forge_set_privacy", { p_set_id: "00000000-0000-0000-0000-000000000000", p_is_private: true }],
    ["_forge_can_read_card", { p_card_id: "00000000-0000-0000-0000-000000000000" }],
    ["_forge_is_card_field", { p_field: "name" }],
    ["_forge_can_read_topic", { p_topic: "forge:card:00000000-0000-0000-0000-000000000000" }],
    ["forge_create_proposal", { p_card_id: "00000000-0000-0000-0000-000000000000", p_snapshot: {}, p_summary: "x" }],
    ["forge_accept_proposal", { p_proposal_id: "00000000-0000-0000-0000-000000000000" }],
    ["forge_deny_proposal", { p_proposal_id: "00000000-0000-0000-0000-000000000000", p_reason: "x" }],
    ["forge_add_comment", { p_card_id: "00000000-0000-0000-0000-000000000000", p_proposal_id: null, p_parent_id: null, p_field: null, p_suggested_value: null, p_body: "x" }],
    ["forge_resolve_comment", { p_comment_id: "00000000-0000-0000-0000-000000000000", p_resolved: true }],
    ["forge_apply_suggestion", { p_comment_id: "00000000-0000-0000-0000-000000000000" }],
    ["forge_delete_comment", { p_comment_id: "00000000-0000-0000-0000-000000000000" }],
    ["forge_add_art_candidate", { p_card_id: "00000000-0000-0000-0000-000000000000", p_key: "x" }],
    ["forge_delete_art_candidate", { p_candidate_id: "00000000-0000-0000-0000-000000000000" }],
    ["forge_candidate_art_key", { p_card_id: "00000000-0000-0000-0000-000000000000", p_candidate_id: "00000000-0000-0000-0000-000000000000" }],
    ["forge_promote_set", { p_set_id: "00000000-0000-0000-0000-000000000000", p_set_code: "X", p_official_set: "X", p_rows: [], p_close_set: true }],
    ["forge_abort_release", { p_release_id: "00000000-0000-0000-0000-000000000000" }],
    ["forge_set_release_image_transform", { p_release_id: "00000000-0000-0000-0000-000000000000", p_card_id: "00000000-0000-0000-0000-000000000000", p_transform: null }],
    ["forge_mark_release_image_uploaded", { p_release_id: "00000000-0000-0000-0000-000000000000", p_card_id: "00000000-0000-0000-0000-000000000000" }],
    ["forge_mark_release_live", { p_release_id: "00000000-0000-0000-0000-000000000000" }],
    ["forge_count_release_decks", { p_release_id: "00000000-0000-0000-0000-000000000000" }],
    ["forge_migrate_release_decks", { p_release_id: "00000000-0000-0000-0000-000000000000" }],
  ];

  for (const [fn, args] of FORGE_RPCS) {
    it(`anon cannot execute ${fn}`, async () => {
      const { error } = await anonClient().rpc(fn, args);
      expect(error, `anon was able to execute ${fn} — a definer grant leaked`).not.toBeNull();
    });
  }

  // Realtime: a non-member (anon) must not be able to JOIN a private forge topic.
  // A successful join is the only way to receive broadcasts/presence, so ANY
  // non-SUBSCRIBED terminal outcome (CHANNEL_ERROR / TIMED_OUT / CLOSED / our own
  // timer) proves the channel can't leak. realtime-js retries a rejected private
  // join (and can stack-overflow its reconnect timer), so callers must hand us a
  // client created with a short `realtime.timeout`, and we tear the socket down
  // hard (disconnect) on the first terminal status to stop the reconnect storm.
  // `SupabaseClient` (Database = any), not ReturnType<typeof createClient>: ReturnType
  // instantiates the generics with their constraints (unknown/never) and rejects the
  // clients built above.
  function joinStatus(
    client: SupabaseClient,
    topic: string,
    internalTimeoutMs = 4000
  ): Promise<string> {
    return new Promise<string>((resolve) => {
      const ch = client.channel(topic, { config: { private: true } });
      let settled = false;
      const finish = (status: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { client.removeChannel(ch); } catch { /* ignore */ }
        try { client.realtime.disconnect(); } catch { /* ignore */ }
        resolve(status);
      };
      const timer = setTimeout(() => finish("TIMEOUT"), internalTimeoutMs);
      ch.subscribe((status) => {
        if (
          status === "SUBSCRIBED" || status === "CHANNEL_ERROR" ||
          status === "CLOSED" || status === "TIMED_OUT"
        ) {
          finish(status);
        }
      });
    });
  }

  it("anon cannot join a private forge card channel", async () => {
    const client = createClient(URL!, ANON!, { realtime: { timeout: 2500 } });
    await client.realtime.setAuth(ANON!); // anon-role JWT — private authz must reject it
    const status = await joinStatus(client, "forge:card:00000000-0000-0000-0000-000000000000");
    expect(status, `anon joined a forge channel (status: ${status})`).not.toBe("SUBSCRIBED");
  }, 15000);

  it("anon cannot join a private forge set channel", async () => {
    const client = createClient(URL!, ANON!, { realtime: { timeout: 2500 } });
    await client.realtime.setAuth(ANON!);
    const status = await joinStatus(client, "forge:set:00000000-0000-0000-0000-000000000000");
    expect(status, `anon joined a forge channel (status: ${status})`).not.toBe("SUBSCRIBED");
  }, 15000);

  // Member-vs-member isolation: a signed-in member must NOT see another member's
  // private idea. Opt-in (needs a test member + service role to seed a foreign card).
  const MEMBER_EMAIL = process.env.FORGE_TEST_MEMBER_EMAIL;
  const MEMBER_PW = process.env.FORGE_TEST_MEMBER_PASSWORD;
  const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const OTHER_OWNER = process.env.FORGE_TEST_OTHER_OWNER_ID; // an auth.users id != the test member
  const ISO_ENABLED = !!(MEMBER_EMAIL && MEMBER_PW && SERVICE && OTHER_OWNER);

  describe.runIf(ISO_ENABLED)("member cannot read another member's card", () => {
    it("a public channel of the same name receives no forge broadcast", async () => {
      // Defense-in-depth: DB broadcasts go only to the PRIVATE topic. A public
      // channel with the same name is a DISTINCT channel and must receive nothing,
      // even when a real member write fires a broadcast on the private topic.
      const svc = createClient(URL!, SERVICE!);
      const ins = await svc
        .from("forge_cards")
        .insert({ owner_id: OTHER_OWNER!, working_snapshot: { name: "RT LEAK PROBE" } })
        .select("id")
        .single();
      expect(ins.error, ins.error?.message).toBeNull();
      const cardId = ins.data!.id as string;

      const pub = createClient(URL!, ANON!);
      let received = 0;
      const ch = pub.channel(`forge:card:${cardId}`, { config: { private: false } });
      ch.on("broadcast", { event: "change" }, () => { received++; });
      try {
        // Wait for the public channel to settle (subscribe or error), capped.
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, 6000);
          ch.subscribe((status) => {
            if (status === "SUBSCRIBED" || status === "CHANNEL_ERROR" || status === "CLOSED") {
              clearTimeout(t);
              resolve();
            }
          });
        });
        // Fire a private DB broadcast: update the card as the service role.
        await svc.from("forge_cards").update({ working_snapshot: { name: "RT LEAK PROBE 2" } }).eq("id", cardId);
        // Give any (errant) delivery a window to arrive.
        await new Promise((r) => setTimeout(r, 2500));
        expect(received, "a public channel received a private forge broadcast").toBe(0);
      } finally {
        pub.removeChannel(ch);
        await svc.from("forge_cards").delete().eq("id", cardId);
      }
    });

    it("a signed-in member sees zero rows for a foreign-owned card", async () => {
      const svc = createClient(URL!, SERVICE!);
      const ins = await svc
        .from("forge_cards")
        .insert({ owner_id: OTHER_OWNER!, working_snapshot: { name: "SECRET IDEA" } })
        .select("id")
        .single();
      expect(ins.error, ins.error?.message).toBeNull();
      const foreignId = ins.data!.id as string;
      try {
        const member = createClient(URL!, ANON!, { realtime: { timeout: 2500 } });
        const auth = await member.auth.signInWithPassword({ email: MEMBER_EMAIL!, password: MEMBER_PW! });
        expect(auth.error, auth.error?.message).toBeNull();
        const { data } = await member.from("forge_cards").select("*").eq("id", foreignId);
        expect((data ?? []).length, "member leaked a foreign-owned card").toBe(0);
        // ...and cannot join that card's realtime topic (per-topic authz = table RLS).
        await member.realtime.setAuth(
          (await member.auth.getSession()).data.session!.access_token
        );
        const rtStatus = await joinStatus(member, `forge:card:${foreignId}`);
        expect(rtStatus, `member joined a foreign card's channel (status: ${rtStatus})`).not.toBe("SUBSCRIBED");
      } finally {
        await svc.from("forge_cards").delete().eq("id", foreignId);
      }
    });
  });
});
