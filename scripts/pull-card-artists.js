#!/usr/bin/env node

/**
 * Snapshot the artist credits from the community "Redemption Card List" sheet
 * into scripts/data/card-artists-sheet.json, then regenerate the card catalog
 * (parse-carddata.js matches every printing against the snapshot — see
 * scripts/lib/applyCardArtists.js).
 *
 * Only the columns the matcher needs are kept (name, set, verse, artist), so a
 * re-pull diffs as a reviewable list of credit changes.
 *
 * Usage:
 *   node scripts/pull-card-artists.js
 *   OR
 *   make pull-card-artists
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const SHEET_ID = '1pK4BlpoAXqPSkbniyaAh3_QufApHmwQzeuck5dVK_54';
// The two tabs that list printings. "Notes", "Sets" and the dated "Edits" tabs
// are changelogs whose rows already appear in these two.
const TABS = [
  { name: "Set's Card List", gid: '0', minRows: 4500 },
  { name: "Collector's List", gid: '1084803588', minRows: 800 },
];
const outPath = path.join(__dirname, 'data/card-artists-sheet.json');

// RFC 4180: quoted fields may hold commas, doubled quotes and newlines.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
// The sheet writes "-" for an empty cell.
const value = (s) => (clean(s) === '-' ? '' : clean(s));

async function pullTab(tab) {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${tab.gid}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${tab.name}: HTTP ${res.status}`);
  const [header, ...body] = parseCsv(await res.text());
  const col = (label) => {
    const i = header.findIndex((h) => clean(h).toLowerCase() === label.toLowerCase());
    if (i < 0) throw new Error(`${tab.name}: no "${label}" column (header: ${header.join(' | ')})`);
    return i;
  };
  const c = {
    name: col('Name'), set: col('Set'), book: col('Book'),
    chapter: col('Chapter'), verse: col('Verse'), artist: col('Artist'),
  };
  const rows = [];
  for (const r of body) {
    const name = value(r[c.name]);
    const artist = value(r[c.artist]);
    if (!name || !artist) continue; // spacer rows
    const book = value(r[c.book]);
    const chapter = value(r[c.chapter]);
    const verse = value(r[c.verse]);
    const ref = book ? `${book} ${chapter}${verse ? `:${verse}` : ''}`.trim() : '';
    rows.push({ name, set: value(r[c.set]), ref, artist });
  }
  if (rows.length < tab.minRows) {
    throw new Error(`${tab.name}: only ${rows.length} credited rows (expected >= ${tab.minRows}) — refusing a truncated snapshot`);
  }
  console.log(`📥 ${tab.name}: ${rows.length} credited rows`);
  return rows;
}

async function main() {
  const rows = [];
  for (const tab of TABS) rows.push(...(await pullTab(tab)));
  // One row per line: compact, and a re-pull diffs card by card.
  const json =
    '{\n' +
    ` "source": ${JSON.stringify(`https://docs.google.com/spreadsheets/d/${SHEET_ID}`)},\n` +
    ` "tabs": ${JSON.stringify(TABS.map((t) => t.name))},\n` +
    ' "rows": [\n' +
    rows.map((r) => `  ${JSON.stringify(r)}`).join(',\n') +
    '\n ]\n}\n';
  fs.writeFileSync(outPath, json);
  console.log(`✅ Wrote ${rows.length} rows to ${path.relative(process.cwd(), outPath)}`);
  console.log('🔄 Regenerating the card catalog...');
  execFileSync('node', [path.join(__dirname, 'parse-carddata.js')], { stdio: 'inherit' });
}

main().catch((e) => {
  console.error(`❌ ${e.message}`);
  process.exit(1);
});
