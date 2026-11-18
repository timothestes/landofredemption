#!/usr/bin/env node

/**
 * Parse scripts/data/carddata.txt and generate lib/cards/generated/cardData.ts
 *
 * Usage:
 *   node scripts/parse-carddata.js
 *   OR
 *   make update-cards
 */

const fs = require('fs');
const path = require('path');

const txtPath = path.join(__dirname, 'data/carddata.txt');
const outputPath = path.join(__dirname, '../lib/cards/generated/cardData.ts');
const jsonPath = path.join(__dirname, '../lib/cards/generated/cardData.json');
const abMapPath = path.join(__dirname, '../lib/cards/generated/abMap.json');
const abOverridesPath = path.join(__dirname, 'data/ab-overrides.json');
const forgeReleasedPath = path.join(__dirname, 'data/forge-released.json');
const cardOverridesPath = path.join(__dirname, 'data/card-overrides.json');
const imgVersionsPath = path.join(__dirname, '../lib/cards/generated/imgVersions.json');
const cardAliasesPath = path.join(__dirname, '../lib/cards/generated/cardAliases.json');
const { applyCardOverrides } = require('./lib/applyCardOverrides');
const { applyCardAliases } = require('./lib/applyCardAliases');
const { applyCardArtists } = require('./lib/applyCardArtists');
const cardArtistsPath = path.join(__dirname, 'data/card-artists-sheet.json');
const printingCuesPath = path.join(__dirname, '../lib/scan/generated/printingCues.json');

const raw = fs.readFileSync(txtPath, 'utf-8');
const lines = raw.split('\n');

// Skip header row, drop empty lines
const dataLines = lines.slice(1).filter((l) => l.trim().length > 0);

const cards = [];

for (const line of dataLines) {
  const cols = line.split('\t');

  const name = (cols[0] || '').trim();
  if (!name) continue;

  cards.push({
    name,
    set: (cols[1] || '').trim(),
    imgFile: (cols[2] || '').trim().replace(/\.jpe?g$/i, ''),
    officialSet: (cols[3] || '').trim(),
    type: (cols[4] || '').trim(),
    brigade: (cols[5] || '').trim(),
    strength: (cols[6] || '').trim(),
    toughness: (cols[7] || '').trim(),
    class: (cols[8] || '').trim(),
    identifier: (cols[9] || '').trim(),
    specialAbility: (cols[10] || '').trim(),
    rarity: (cols[11] || '').trim(),
    reference: (cols[12] || '').trim(),
    // Column 13 intentionally skipped — matches legacy deckcheck parser
    alignment: (cols[14] || '').trim(),
    legality: (cols[15] || '').trim(),
  });
}

// This guard covers UPSTREAM rows alone, before the forge overlay merges —
// moving it after the merge would let a truncated upstream fetch hide behind
// the overlay's row count.
if (cards.length < 5000) {
  console.error(
    `❌ Only ${cards.length} cards parsed — expected >= 5000. Aborting to avoid writing a truncated artifact.`
  );
  process.exit(1);
}

// ---- Forge-released overlay ------------------------------------------------
// Sets promoted from the Forge ride scripts/data/forge-released.json (synced by
// `make pull-forge-releases`) so `make update-cards` can never wipe them. Rows
// are CardData-shaped JSON tagged with releaseId/setCode — they bypass the
// positional TSV fragility entirely. Upstream wins on name|set: once a released
// set lands in upstream carddata.txt its overlay rows drop out (printed below).
// PARTIAL absorption of one release is a hard failure — some rows matching
// upstream while others linger is the rename/errata signature, and it must
// never merge silently.
const upstreamCount = cards.length;
if (fs.existsSync(forgeReleasedPath)) {
  let overlayRows;
  try {
    overlayRows = JSON.parse(fs.readFileSync(forgeReleasedPath, 'utf-8'));
  } catch (e) {
    console.error(`❌ Failed to read ${forgeReleasedPath}: ${e.message}`);
    process.exit(1);
  }
  if (!Array.isArray(overlayRows)) {
    console.error(`❌ ${forgeReleasedPath} must contain a JSON array`);
    process.exit(1);
  }
  const upstreamKeys = new Set(cards.map((c) => `${c.name}|${c.set}`));
  const byRelease = new Map();
  for (const row of overlayRows) {
    const releaseId = row.releaseId || 'untagged';
    if (!byRelease.has(releaseId)) byRelease.set(releaseId, []);
    byRelease.get(releaseId).push(row);
  }
  const CARD_FIELDS = [
    'name', 'set', 'imgFile', 'officialSet', 'type', 'brigade', 'strength',
    'toughness', 'class', 'identifier', 'specialAbility', 'rarity', 'reference',
    'alignment', 'legality',
  ];
  for (const [releaseId, rows] of byRelease) {
    if (rows.some((r) => /\(AB\)/.test(r.set || ''))) {
      console.error(`❌ Overlay release ${releaseId} uses an (AB)-pattern set code — not allowed.`);
      process.exit(1);
    }
    const absorbed = rows.filter((r) => upstreamKeys.has(`${r.name}|${r.set}`));
    const lingering = rows.filter((r) => !upstreamKeys.has(`${r.name}|${r.set}`));
    if (absorbed.length > 0 && lingering.length > 0) {
      console.error(
        `❌ Release ${releaseId} (${rows[0]?.set}) is PARTIALLY absorbed upstream — ` +
          `${absorbed.length}/${rows.length} rows match carddata.txt but these do not ` +
          `(rename/errata suspects; reconcile before regenerating):\n` +
          lingering.map((r) => `   - ${r.name} | ${r.set}`).join('\n')
      );
      process.exit(1);
    }
    for (const r of absorbed) console.log(`⤵️  absorbed upstream: ${r.name} (${r.set})`);
    for (const r of lingering) {
      const clean = {};
      for (const f of CARD_FIELDS) clean[f] = (r[f] ?? '').toString();
      cards.push(clean);
    }
  }
  if (cards.length < upstreamCount) {
    console.error('❌ Merged card count fell below the upstream count — overlay merge bug.');
    process.exit(1);
  }
  const appended = cards.length - upstreamCount;
  if (appended > 0) console.log(`🔥 ${appended} forge-released cards appended from overlay`);
}

// ---- Card-override overlay (catalog admin editor) --------------------------
// Superuser metadata edits ride scripts/data/card-overrides.json (synced by
// `make pull-card-overrides`) and are applied LAST — they win over upstream AND
// forge-released rows. Validation lives in scripts/lib/applyCardOverrides.js;
// any error there (orphan, ambiguity, unknown/identity field, stranded image
// version) is a hard exit so a bad pull can never silently corrupt the catalog.
let overridesOverlay = { overrides: [], imageVersions: {} };
if (fs.existsSync(cardOverridesPath)) {
  try {
    overridesOverlay = JSON.parse(fs.readFileSync(cardOverridesPath, 'utf-8'));
  } catch (e) {
    console.error(`❌ Failed to read ${cardOverridesPath}: ${e.message}`);
    process.exit(1);
  }
}
const overrideCount = (overridesOverlay.overrides || []).length;
// Pristine copy for the AB-pairing guard below: pairing derives from editable
// fields (reference + stats), so we must prove the patch didn't re-pair anything.
const cardsPrePatch = overrideCount > 0 ? cards.map((c) => ({ ...c })) : null;
{
  const { errors, warnings } = applyCardOverrides(cards, overridesOverlay);
  for (const w of warnings) console.log(`♻️  ${w}`);
  if (errors.length > 0) {
    console.error(
      `❌ card-overrides.json failed validation:\n` + errors.map((e) => `   - ${e}`).join('\n')
    );
    process.exit(1);
  }
}
if (overrideCount > 0) console.log(`✏️  ${overrideCount} card override(s) applied`);

// Card aliases (catalog editor) — short names like "LAFS" that `[[mentions]]`
// fall back to. Checked against the FINAL patched rows, so the shadow check
// sees any stem an override just moved. Validated HERE, with every other gate
// and before the first write: aborting after abMap.json had been regenerated
// would leave lib/cards/generated/ describing two different catalogs. The file
// itself is written with the rest of them below.
const cardAliases = (() => {
  const { aliases, errors } = applyCardAliases(cards, overridesOverlay);
  if (errors.length > 0) {
    console.error(
      `❌ card alias overlay failed validation:\n` + errors.map((e) => `   - ${e}`).join('\n')
    );
    process.exit(1);
  }
  return aliases;
})();

// ---- Artist credits --------------------------------------------------------
// Upstream carddata.txt has no artist column. Credits come from a snapshot of
// the community "Redemption Card List" sheet (`make pull-card-artists`), with
// the scanner's machine-read credit line as the fallback. Matching lives in
// scripts/lib/applyCardArtists.js; a printing it can't place gets ''.
{
  let snapshot = { rows: [] };
  if (fs.existsSync(cardArtistsPath)) {
    try {
      snapshot = JSON.parse(fs.readFileSync(cardArtistsPath, 'utf-8'));
    } catch (e) {
      console.error(`❌ Failed to read ${cardArtistsPath}: ${e.message}`);
      process.exit(1);
    }
    if (!Array.isArray(snapshot.rows)) {
      console.error(`❌ ${cardArtistsPath} has no rows array`);
      process.exit(1);
    }
  } else {
    console.log(`⚠️  ${path.relative(process.cwd(), cardArtistsPath)} missing — run make pull-card-artists`);
  }
  let printingCues = {};
  if (fs.existsSync(printingCuesPath)) {
    try {
      printingCues = JSON.parse(fs.readFileSync(printingCuesPath, 'utf-8'));
    } catch (e) {
      console.error(`❌ Failed to read ${printingCuesPath}: ${e.message}`);
      process.exit(1);
    }
  }
  const { stats } = applyCardArtists(cards, snapshot, printingCues);
  console.log(
    `🎨 artists: ${stats.sheetSet + stats.sheetName + stats.sheetFuzzy} from the sheet, ` +
      `${stats.scan + stats.scanOverride} from scans (${stats.scanOverride} overruling the sheet), ` +
      `${stats.none} unknown`
  );
}

// Diff summary against previous generated data, if present
function loadPreviousCards() {
  if (!fs.existsSync(jsonPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  } catch {
    return null;
  }
}

const previous = loadPreviousCards();
if (previous) {
  const keyOf = (c) => `${c.name}|${c.set}|${c.imgFile}`;
  const prevByKey = new Map(previous.map((c) => [keyOf(c), c]));
  const currByKey = new Map(cards.map((c) => [keyOf(c), c]));

  let added = 0;
  let removed = 0;
  let modified = 0;

  for (const [k, c] of currByKey) {
    if (!prevByKey.has(k)) {
      added++;
    } else {
      const p = prevByKey.get(k);
      if (JSON.stringify(p) !== JSON.stringify(c)) modified++;
    }
  }
  for (const k of prevByKey.keys()) {
    if (!currByKey.has(k)) removed++;
  }

  console.log(`➕ ${added} cards added`);
  console.log(`➖ ${removed} cards removed`);
  console.log(`🔄 ${modified} cards modified`);
}

// ---- AB (alternate-art booster) → original-print mapping -------------------
// The three AB sets ("CoW (AB)", "RoJ (AB)", "T2C (AB)") are alternate-art
// reprints of cards that also exist as a normal print in the same base set. The
// source data carries NO key linking a reprint to its original, so we derive the
// pairing here: for each AB card, match it against ONLY its base-set candidates,
// first by normalized name, then by Bible reference + gameplay stats. The result
// feeds the deckbuilder's "Prefer AB" filter (show the AB art of any card that
// has one, hide the matched original).
//
// DO NOT loosen the normalizer to strip trailing brackets wholesale: T2C has
// cards distinguished ONLY by an identity bracket — e.g. "Cherubim [Blake]" vs
// "Cherubim [Unknown]" (same stats and verse) — which would collide and break
// the build's completeness assertion.
const keyOf = (c) => `${c.name}|${c.set}`;
const isAbCard = (c) => /\(AB\)/.test(c.set);
// Base family: "CoW (AB)", "CoW [Ban]", and "CoW" all share family "CoW".
const familyOf = (set) =>
  set.replace(/\s*\(AB\)\s*/g, ' ').replace(/\s*\[[^\]]*\]\s*$/g, ' ').trim();
// A trailing (…)/[…] group is a strippable SET-CODE marker only when its whole
// content is a set code, optionally combined with "AB" (e.g. "CoW", "RoJ AB",
// "AB - T2C"). Identity brackets ("[Blake]", "(The Harlot)", verse brackets) and
// anything with extra text are preserved.
const PURE_SET_MARKER = /^(?:AB\s*[-–]\s*(?:CoW|RoJ|T2C)|(?:CoW|RoJ|T2C)(?:\s+AB)?|AB)$/i;
function stripSetMarkers(name) {
  let s = name;
  let prev;
  do {
    prev = s;
    s = s.replace(/\s*[([]([^()\[\]]*)[)\]]\s*$/, (m, inner) =>
      PURE_SET_MARKER.test(inner.trim()) ? '' : m
    );
  } while (s !== prev);
  return s;
}
const normName = (name) =>
  stripSetMarkers(name)
    .toLowerCase()
    .replace(/['‘’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const normRef = (ref) => (ref || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const statKey = (c) =>
  [c.brigade, c.strength, c.toughness, c.type, c.alignment].join('|').toLowerCase();

// Return the single candidate whose derived key matches the AB card; if several
// match, break the tie on gameplay stats; null if still ambiguous or none.
function pickCandidate(cands, deriveKey, target, ab) {
  if (!target) return null;
  const hits = cands.filter((c) => deriveKey(c) === target);
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) {
    const tie = hits.filter((c) => statKey(c) === statKey(ab));
    if (tie.length === 1) return tie[0];
  }
  return null;
}

// Derives the AB→original map for a given card list. Extracted so the
// override-patch guard below can compare a pre-patch and post-patch derivation
// without duplicating the matching logic.
function deriveAbMap(cardList) {
  const abList = cardList.filter(isAbCard);
  const candidatesByFamily = new Map();
  for (const c of cardList) {
    if (isAbCard(c)) continue;
    const fam = familyOf(c.set);
    if (!candidatesByFamily.has(fam)) candidatesByFamily.set(fam, []);
    candidatesByFamily.get(fam).push(c);
  }
  const map = {}; // { "<ab name>|<ab set>": "<original name>|<original set>" }
  for (const ab of abList) {
    const cands = candidatesByFamily.get(familyOf(ab.set)) || [];
    const match =
      pickCandidate(cands, (c) => normName(c.name), normName(ab.name), ab) ||
      pickCandidate(cands, (c) => normRef(c.reference), normRef(ab.reference), ab);
    if (match) map[keyOf(ab)] = keyOf(match);
  }
  return map;
}

const abCards = cards.filter(isAbCard); // the assertions below still use this
const abMap = deriveAbMap(cards);

// Guard (spec F6): an override to reference/stat fields can silently re-pair an
// AB card while the map stays complete and 1:1 — the existing assertions can't
// see it. Intentional re-pairing goes through data/ab-overrides.json instead.
if (cardsPrePatch) {
  const abMapBefore = deriveAbMap(cardsPrePatch);
  const allKeys = new Set([...Object.keys(abMapBefore), ...Object.keys(abMap)]);
  const changed = [...allKeys].filter((k) => abMapBefore[k] !== abMap[k]);
  if (changed.length > 0) {
    console.error(
      `❌ card override(s) changed AB→original pairing:\n` +
        changed.map((k) => `   - ${k}: ${abMapBefore[k] ?? '(none)'} → ${abMap[k] ?? '(none)'}`).join('\n') +
        `\nIf intentional, pin the pairing in ${path.relative(process.cwd(), abOverridesPath)}.`
    );
    process.exit(1);
  }
}

// Manual overrides (safety valve for future data drift) applied last.
if (fs.existsSync(abOverridesPath)) {
  try {
    const overrides = JSON.parse(fs.readFileSync(abOverridesPath, 'utf-8'));
    for (const [abKey, origKey] of Object.entries(overrides)) abMap[abKey] = origKey;
  } catch (e) {
    console.error(`❌ Failed to read ${abOverridesPath}: ${e.message}`);
    process.exit(1);
  }
}

// Assertion 1: every AB card must resolve to an original.
const unresolvedAb = abCards.filter((c) => !(keyOf(c) in abMap));
if (unresolvedAb.length > 0) {
  console.error(
    `❌ AB map incomplete: ${abCards.length - unresolvedAb.length}/${abCards.length} AB cards resolved.\n` +
      unresolvedAb.map((c) => `   - ${c.name} | ${c.set}`).join('\n') +
      `\nAdd the missing pair(s) to ${path.relative(process.cwd(), abOverridesPath)} ` +
      `as "<name>|<set>": "<originalName>|<originalSet>".`
  );
  process.exit(1);
}
// Assertion 2: the mapping must be 1:1 (no original claimed by two AB cards).
const claimedOriginals = Object.values(abMap);
if (new Set(claimedOriginals).size !== claimedOriginals.length) {
  const dupes = [...new Set(claimedOriginals.filter((k, i) => claimedOriginals.indexOf(k) !== i))];
  console.error(
    `❌ AB map is not 1:1 — original print(s) claimed by multiple AB cards:\n` +
      dupes.map((k) => `   - ${k}`).join('\n')
  );
  process.exit(1);
}
fs.writeFileSync(abMapPath, JSON.stringify(abMap, null, 2));
console.log(`🔗 ${path.relative(process.cwd(), abMapPath)} — ${abCards.length} AB→original pairs`);

// Image cache-bust versions (catalog editor image replacements). Consumed by
// app/shared/utils/cardImageUrl.ts, which appends ?v=<n>. Always written —
// {} when no image has ever been replaced.
const imgVersionsOut = {};
for (const k of Object.keys(overridesOverlay.imageVersions || {}).sort()) {
  imgVersionsOut[k] = overridesOverlay.imageVersions[k];
}
fs.writeFileSync(imgVersionsPath, JSON.stringify(imgVersionsOut, null, 2) + '\n');
console.log(`🖼️  ${path.relative(process.cwd(), imgVersionsPath)} — ${Object.keys(imgVersionsOut).length} versioned image(s)`);

fs.writeFileSync(cardAliasesPath, JSON.stringify(cardAliases, null, 2) + '\n');
console.log(`🔤 ${path.relative(process.cwd(), cardAliasesPath)} — ${cardAliases.length} card alias(es)`);


// The card array lives in a .json file so TypeScript never has to type-check a
// multi-megabyte inline literal (which OOMs the build). The lookup maps are
// rebuilt at runtime from CARDS in lib/cards/lookup.ts — no need to serialize them.
fs.writeFileSync(jsonPath, JSON.stringify(cards, null, 2));

const tsContent = `/**
 * Redemption CCG card data.
 * Auto-generated from scripts/data/carddata.txt.
 * Source: https://raw.githubusercontent.com/jalstad/RedemptionLackeyCCG/master/RedemptionQuick/sets/carddata.txt
 *
 * To regenerate this file, run: make update-cards
 *
 * DO NOT EDIT BY HAND.
 *
 * The card data itself lives in ./cardData.json; this module only types it.
 * Keeping the array out of the .ts source avoids type-checking a giant literal.
 */

import cardData from './cardData.json';

export interface CardData {
  name: string;
  set: string;
  imgFile: string;
  officialSet: string;
  type: string;
  brigade: string;
  strength: string;
  toughness: string;
  class: string;
  identifier: string;
  specialAbility: string;
  rarity: string;
  reference: string;
  alignment: string;
  legality: string;
  /** Illustrator credit, '' when unknown (scripts/lib/applyCardArtists.js). */
  artist: string;
}

export const CARDS: readonly CardData[] = cardData as readonly CardData[];
`;

fs.writeFileSync(outputPath, tsContent);
console.log(
  `✅ Generated ${path.relative(process.cwd(), jsonPath)} + ${path.relative(
    process.cwd(),
    outputPath
  )} with ${cards.length} cards`
);
