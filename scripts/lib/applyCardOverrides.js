// Applies the card-overrides overlay (scripts/data/card-overrides.json) to the
// merged catalog rows. Overrides win over upstream AND forge-released rows —
// applied last in parse-carddata.js. Mutates rows in place; the caller decides
// exit behavior from the returned errors/warnings.
//
// The overlay is DB-shaped data, not trusted input: unknown keys, identity
// keys, ambiguous matches and stranded image versions are hard errors here so
// a bad pull can never silently corrupt the generated catalog.

const EDITABLE_FIELDS = [
  'officialSet', 'type', 'brigade', 'strength', 'toughness', 'class',
  'identifier', 'specialAbility', 'rarity', 'reference', 'alignment', 'legality', 'artist',
];
const IDENTITY_FIELDS = ['name', 'set', 'imgFile'];

function applyCardOverrides(cards, overlay) {
  const errors = [];
  const warnings = [];
  const overrides = Array.isArray(overlay && overlay.overrides) ? overlay.overrides : [];
  const imageVersions =
    overlay && overlay.imageVersions && typeof overlay.imageVersions === 'object'
      ? overlay.imageVersions
      : {};

  // name|set → row, with duplicate keys poisoned: the catalog tolerates
  // last-wins collisions (lib/cards/lookup.ts), so nothing else guarantees
  // uniqueness, and patching a shadowed row would be a silent no-op.
  const DUP = Symbol('dup');
  const byKey = new Map();
  for (const c of cards) {
    const k = `${c.name}|${c.set}`;
    byKey.set(k, byKey.has(k) ? DUP : c);
  }

  for (const o of overrides) {
    const key = `${o.name}|${o.set}`;
    const row = byKey.get(key);
    if (!row) {
      errors.push(
        `orphan override: no catalog card matches "${key}" — the catalog changed underneath it; ` +
          `fix or delete the override in /admin/catalog, then re-run make pull-card-overrides`
      );
      continue;
    }
    if (row === DUP) {
      errors.push(`ambiguous override: "${key}" matches more than one catalog row — cannot patch safely`);
      continue;
    }
    const fields = o.fields || {};
    for (const [field, value] of Object.entries(fields)) {
      if (IDENTITY_FIELDS.includes(field)) {
        errors.push(`override for "${key}" touches identity field "${field}" — identity is immutable`);
        continue;
      }
      if (!EDITABLE_FIELDS.includes(field)) {
        errors.push(`override for "${key}" has unknown field "${field}"`);
        continue;
      }
      if (typeof value !== 'string') {
        errors.push(`override for "${key}" field "${field}" is not a string`);
        continue;
      }
      if (row[field] === value) {
        warnings.push(
          `override absorbed: "${key}" ${field} already equals ${JSON.stringify(value)} in the base data — consider retiring it`
        );
      }
      row[field] = value;
    }
  }

  const liveImgFiles = new Set(cards.map((c) => c.imgFile));
  for (const [imgFile, version] of Object.entries(imageVersions)) {
    if (!Number.isInteger(version) || version < 1) {
      errors.push(`image version for "${imgFile}" must be a positive integer (got ${JSON.stringify(version)})`);
      continue;
    }
    if (!liveImgFiles.has(imgFile)) {
      errors.push(
        `stranded image version: no catalog card uses imgFile "${imgFile}" — upstream likely renamed the ` +
          `image file (art silently reverts, spec F5); re-replace the art under the new imgFile and delete this entry`
      );
    }
  }

  return { errors, warnings };
}

module.exports = { applyCardOverrides, EDITABLE_FIELDS, IDENTITY_FIELDS };
