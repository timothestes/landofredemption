// Query + row-mapping logic for the forge-released overlay. Extracted verbatim
// from pull-forge-releases.js so scripts/prebuild-catalog.js can call it
// directly at build time without shelling out.
//
// Only releases with status images_done | live_verified | decks_migrated sync —
// a 'staged' release's rows would ship catalog entries whose images 404 forever
// (the daily blob cron can only backfill from upstream, never from the Forge).
// Staged releases are printed and skipped.

const SYNCED_STATUSES = ['images_done', 'live_verified', 'decks_migrated'];

async function fetchOverlayRows(supabase) {
  const { data: releases, error: relErr } = await supabase
    .from('forge_public_releases')
    .select('id, set_code, official_set, status, card_count, created_at')
    .order('created_at', { ascending: true });
  if (relErr) {
    console.error(`❌ Could not read forge_public_releases: ${relErr.message}`);
    process.exit(1);
  }

  const synced = (releases ?? []).filter((r) => SYNCED_STATUSES.includes(r.status));
  const skipped = (releases ?? []).filter((r) => !SYNCED_STATUSES.includes(r.status));
  for (const r of skipped) {
    console.log(`⏭️  skipping ${r.set_code} (${r.id}) — status '${r.status}' (images not done)`);
  }

  const rows = [];
  for (const release of synced) {
    const { data: cards, error: cardErr } = await supabase
      .from('forge_public_release_cards')
      .select('*')
      .eq('release_id', release.id)
      .order('name', { ascending: true });
    if (cardErr) {
      console.error(`❌ Could not read release ${release.id}: ${cardErr.message}`);
      process.exit(1);
    }
    for (const c of cards ?? []) {
      rows.push({
        // CardData shape (parse-carddata.js appends these verbatim) …
        name: c.name,
        set: c.set_code,
        imgFile: c.img_file,
        officialSet: c.official_set,
        type: c.type,
        brigade: c.brigade,
        strength: c.strength,
        toughness: c.toughness,
        class: c.class,
        identifier: c.identifier,
        specialAbility: c.special_ability,
        rarity: c.rarity,
        reference: c.reference,
        alignment: c.alignment,
        legality: c.legality,
        // The designer's credit (migration 129); '' lets the sheet/scan match fill it.
        artist: c.artist ?? '',
        // … plus tags for absorption tracking (stripped at codegen):
        releaseId: c.release_id,
        setCode: c.set_code,
      });
    }
    console.log(`📦 ${release.set_code} — ${cards?.length ?? 0} cards (${release.status})`);
  }

  return { rows, skipped };
}

module.exports = { fetchOverlayRows, SYNCED_STATUSES };
