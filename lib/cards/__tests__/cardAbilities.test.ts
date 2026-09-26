// lib/cards/__tests__/cardAbilities.test.ts
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { findCard } from '../lookup';
import {
  CARD_ABILITIES,
  DEFAULT_ABILITY_SOURCE_ZONES,
  SPECIAL_TOKEN_CARDS,
  abilityLabel,
  getAbilitiesForCard,
  resolveTokenCard,
  IMITATE_SOUL_IMAGES as libImitateImages,
  CARD_ABILITIES as libCardAbilities,
  simplifyLostSoulName,
  isNewTestamentLostSoul,
  isCharacterCard,
  isLostSoulCard,
  isHeroCard,
  isDanielCard,
  hasReferenceBook,
  getEffectiveAbilities,
  hasUsableAbilityInZone,
} from '../cardAbilities';
import { CARDS } from '../lookup';
import {
  IMITATE_SOUL_IMAGES as serverImitateImages,
  IMITATE_ORIGINAL_IMG,
  isNewTestamentLostSoul as serverIsNewTestamentLostSoul,
  isHeroCard as serverIsHeroCard,
  hasReferenceBook as serverHasReferenceBook,
} from '@/spacetimedb/src/cardAbilities';

describe('CARD_ABILITIES registry', () => {
  it('every key resolves to a real card via findCard()', () => {
    const bad: string[] = [];
    for (const identifier of Object.keys(CARD_ABILITIES)) {
      if (!findCard(identifier)) bad.push(identifier);
    }
    expect(bad).toEqual([]);
  });

  it('every spawn_token.tokenName resolves via resolveTokenCard()', () => {
    // Real carddata tokens (Proselyte, etc.) resolve via findCard; handcrafted
    // tokens (Harvest Soul, Daniel Soul, etc.) resolve via SPECIAL_TOKEN_CARDS.
    const bad: Array<{ source: string; tokenName: string }> = [];
    for (const [source, abilities] of Object.entries(CARD_ABILITIES)) {
      for (const a of abilities) {
        if (a.type === 'spawn_token' && !resolveTokenCard(a.tokenName)) {
          bad.push({ source, tokenName: a.tokenName });
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('every SPECIAL_TOKEN_CARDS image path resolves to a public/gameplay asset', () => {
    for (const [name, data] of Object.entries(SPECIAL_TOKEN_CARDS)) {
      expect(data.imgFile, `${name} imgFile`).toMatch(/^\/gameplay\/.+\.(png|jpg|jpeg|svg|webp)$/i);
    }
  });

  it('getAbilitiesForCard returns [] for unknown identifiers', () => {
    expect(getAbilitiesForCard('Nonexistent Card')).toEqual([]);
  });

  it('SpacetimeDB duplicate of CARD_ABILITIES stays in sync', async () => {
    const spacetimeCopy = await import('@/spacetimedb/src/cardAbilities');
    expect(spacetimeCopy.CARD_ABILITIES).toEqual(CARD_ABILITIES);
  });

  it('every spawn_token in the registry has metadata in TOKEN_CARD_DATA (server-side)', async () => {
    const { TOKEN_CARD_DATA } = await import('@/spacetimedb/src/cardAbilities');
    const bad: string[] = [];
    for (const abilities of Object.values(CARD_ABILITIES)) {
      for (const a of abilities) {
        if (a.type === 'spawn_token' && !TOKEN_CARD_DATA[a.tokenName]) {
          bad.push(a.tokenName);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('every spawn_token.cyclingTokenNames entry resolves (lib) and has server metadata', async () => {
    // The cycling easter-egg tokens aren't covered by the primary tokenName
    // checks above — verify each cycling name resolves via resolveTokenCard
    // (lib) and exists in TOKEN_CARD_DATA (server) so spawning can't fail.
    const { TOKEN_CARD_DATA } = await import('@/spacetimedb/src/cardAbilities');
    const badLib: string[] = [];
    const badServer: string[] = [];
    for (const abilities of Object.values(CARD_ABILITIES)) {
      for (const a of abilities) {
        if (a.type === 'spawn_token' && a.cyclingTokenNames) {
          for (const name of a.cyclingTokenNames) {
            if (!resolveTokenCard(name)) badLib.push(name);
            if (!TOKEN_CARD_DATA[name]) badServer.push(name);
          }
        }
      }
    }
    expect(badLib, 'unresolved cycling tokens (lib)').toEqual([]);
    expect(badServer, 'cycling tokens missing TOKEN_CARD_DATA (server)').toEqual([]);
  });
});

describe('abilityLabel', () => {
  it('formats singular spawn_token without multiplier', () => {
    expect(abilityLabel({ type: 'spawn_token', tokenName: 'Proselyte Token' }))
      .toBe('Create Proselyte Token');
  });

  it('formats spawn_token with count > 1 using ×N prefix', () => {
    expect(abilityLabel({ type: 'spawn_token', tokenName: 'Violent Possessor Token', count: 2 }))
      .toBe('Create 2× Violent Possessor Token');
  });

  it('formats shuffle_and_draw', () => {
    expect(abilityLabel({ type: 'shuffle_and_draw', shuffleCount: 6, drawCount: 6 }))
      .toBe('Shuffle 6 from hand, draw 6');
  });

  it('formats all_players_shuffle_and_draw', () => {
    expect(abilityLabel({ type: 'all_players_shuffle_and_draw', shuffleCount: 6, drawCount: 6 }))
      .toBe('All players shuffle 6 from hand, draw 6');
  });

  it('formats reveal_own_deck for top position', () => {
    expect(abilityLabel({ type: 'reveal_own_deck', position: 'top', count: 6 }))
      .toBe('Reveal top 6 cards of deck');
  });

  it('formats reveal_own_deck for random position', () => {
    expect(abilityLabel({ type: 'reveal_own_deck', position: 'random', count: 3 }))
      .toBe('Reveal 3 random cards of deck');
  });

  it('formats reveal_own_deck singular', () => {
    expect(abilityLabel({ type: 'reveal_own_deck', position: 'bottom', count: 1 }))
      .toBe('Reveal bottom 1 card of deck');
  });

  it('uses explicit label for custom abilities', () => {
    expect(abilityLabel({ type: 'custom', reducerName: 'foo', label: 'Do Thing' }))
      .toBe('Do Thing');
  });

  it('formats discard_opponent_deck for top position singular', () => {
    expect(abilityLabel({ type: 'discard_opponent_deck', position: 'top', count: 1 }))
      .toBe("Discard top 1 card of opponent's deck");
  });

  it('formats discard_opponent_deck for top position plural', () => {
    expect(abilityLabel({ type: 'discard_opponent_deck', position: 'top', count: 3 }))
      .toBe("Discard top 3 cards of opponent's deck");
  });

  it('formats discard_opponent_deck for bottom position', () => {
    expect(abilityLabel({ type: 'discard_opponent_deck', position: 'bottom', count: 2 }))
      .toBe("Discard bottom 2 cards of opponent's deck");
  });

  it('formats discard_opponent_deck for random position', () => {
    expect(abilityLabel({ type: 'discard_opponent_deck', position: 'random', count: 4 }))
      .toBe("Discard 4 random cards of opponent's deck");
  });

  it('formats discard_characters_from_reserve for self', () => {
    expect(abilityLabel({ type: 'discard_characters_from_reserve', target: 'self' }))
      .toBe('Discard all characters from your Reserve');
  });

  it('formats discard_characters_from_reserve for opponent', () => {
    expect(abilityLabel({ type: 'discard_characters_from_reserve', target: 'opponent' }))
      .toBe("Discard all characters from opponent's Reserve");
  });
});

describe('isCharacterCard', () => {
  it('recognizes Heroes and Evil Characters (incl. combos and tokens)', () => {
    expect(isCharacterCard({ type: 'Hero' })).toBe(true);
    expect(isCharacterCard({ type: 'Evil Character' })).toBe(true);
    expect(isCharacterCard({ type: 'Hero/Evil Character' })).toBe(true);
    expect(isCharacterCard({ cardType: 'Hero Token' })).toBe(true);
    expect(isCharacterCard({ cardType: 'Evil Character Token' })).toBe(true);
  });

  it('rejects non-characters and empty input', () => {
    expect(isCharacterCard({ type: 'Artifact' })).toBe(false);
    expect(isCharacterCard({ type: 'Lost Soul' })).toBe(false);
    expect(isCharacterCard({ type: 'Evil Enhancement' })).toBe(false);
    expect(isCharacterCard({ type: '' })).toBe(false);
    expect(isCharacterCard({})).toBe(false);
  });
});

describe('isLostSoulCard', () => {
  it('recognizes Lost Souls via type or cardType', () => {
    expect(isLostSoulCard({ type: 'Lost Soul' })).toBe(true);
    expect(isLostSoulCard({ cardType: 'LS' })).toBe(true);
    expect(isLostSoulCard({ cardType: 'Lost Soul' })).toBe(true);
  });

  it('rejects Dominants that legitimately play to the Land of Redemption', () => {
    // Guardian of Your Souls says "Place this card in your Land of
    // Redemption" but is a Dominant, not a Lost Soul — it must not count
    // toward the redeemed-soul total shown by the LoR badges/HUD.
    for (const name of [
      'Guardian Of Your Souls',
      'Guardian of Your Souls (RoJ)',
      'Guardian of Your Souls [2024 - 1st Place]',
      'Guardian of Your Souls [2024 - National]',
    ]) {
      const card = findCard(name);
      expect(card?.type).toBe('Dominant');
      expect(isLostSoulCard({ type: card?.type })).toBe(false);
    }
  });

  it('rejects other non-Lost-Soul input', () => {
    expect(isLostSoulCard({ type: 'Dominant' })).toBe(false);
    expect(isLostSoulCard({ type: '' })).toBe(false);
    expect(isLostSoulCard({})).toBe(false);
  });
});

describe('isHeroCard', () => {
  it('matches any type containing "hero" (incl. dual-alignment / tokens)', () => {
    expect(isHeroCard({ type: 'Hero' })).toBe(true);
    expect(isHeroCard({ type: 'Hero/Evil Character' })).toBe(true);
    expect(isHeroCard({ cardType: 'Hero Token' })).toBe(true);
    expect(isHeroCard({ cardType: 'Evil Character/Hero' })).toBe(true);
  });

  it('rejects non-Heroes and empty input', () => {
    expect(isHeroCard({ type: 'Evil Character' })).toBe(false);
    expect(isHeroCard({ type: 'Lost Soul' })).toBe(false);
    expect(isHeroCard({ type: 'Good Enhancement' })).toBe(false);
    expect(isHeroCard({ type: '' })).toBe(false);
    expect(isHeroCard({})).toBe(false);
  });

  it('lib and spacetimedb copies behave identically', () => {
    const samples = [
      { type: 'Hero' }, { type: 'Hero/Evil Character' }, { cardType: 'Hero Token' },
      { type: 'Evil Character' }, { type: 'Lost Soul' }, { type: '' }, {},
    ];
    for (const s of samples) {
      expect(serverIsHeroCard(s)).toBe(isHeroCard(s));
    }
  });
});

describe('hasReferenceBook', () => {
  it('matches the leading book of a reference, case- and space-insensitively', () => {
    expect(hasReferenceBook('Genesis 2:7', 'Genesis')).toBe(true);
    expect(hasReferenceBook('  genesis 49:27 ', 'Genesis')).toBe(true);
    expect(hasReferenceBook('Genesis 17:4-5', 'Genesis')).toBe(true);
  });

  it('rejects other books and empty input', () => {
    expect(hasReferenceBook('I Samuel 17:50', 'Genesis')).toBe(false);
    expect(hasReferenceBook('Revelation 12:9', 'Genesis')).toBe(false);
    expect(hasReferenceBook('', 'Genesis')).toBe(false);
    expect(hasReferenceBook('Genesis 1:1', '')).toBe(false);
  });

  it('lib and spacetimedb copies behave identically', () => {
    const samples: Array<[string, string]> = [
      ['Genesis 2:7', 'Genesis'], ['I Samuel 17:50', 'Genesis'], ['', 'Genesis'], ['Genesis 1:1', ''],
    ];
    for (const [ref, book] of samples) {
      expect(serverHasReferenceBook(ref, book)).toBe(hasReferenceBook(ref, book));
    }
  });
});

describe('band_heroes_from_deck — Creation of the World', () => {
  it('is registered on the Patriarchs printing only', () => {
    // "Creation of the World (Roots)" is a different card — blue, "each player
    // may play up to 3 animals, O.T. angels and/or Genesis humans".
    expect(CARD_ABILITIES['Creation of the World'])
      .toEqual([{ type: 'band_heroes_from_deck', referenceBook: 'Genesis' }]);
    expect(CARD_ABILITIES['Creation of the World (Roots)']).toBeUndefined();
  });

  it('the referenceBook matches real Genesis Heroes and nothing else', () => {
    // Guards the predicate against a carddata reformat: if references ever stop
    // leading with the book, or the Hero type strings change, this goes red.
    const matches = CARDS.filter(c => isHeroCard(c) && hasReferenceBook(c.reference, 'Genesis'));
    expect(matches.length).toBeGreaterThan(50);
    expect(matches.some(c => c.name === 'Adam')).toBe(true);
    expect(matches.some(c => c.name.startsWith('Melchizedek'))).toBe(true);
    expect(matches.every(c => c.reference.toLowerCase().startsWith('genesis'))).toBe(true);
    // The card itself is a Good Enhancement, so it can never band itself.
    expect(matches.some(c => c.name === 'Creation of the World')).toBe(false);
  });

  it('labels the menu item with the book it pulls', () => {
    expect(abilityLabel({ type: 'band_heroes_from_deck', referenceBook: 'Genesis' }))
      .toBe('Band all Genesis Heroes from deck into battle');
  });
});

describe('resurrect_heroes registration', () => {
  it('both cards are registered with the resurrect_heroes ability', () => {
    expect(libCardAbilities['Emptying the Tombs (GoC)']).toEqual([{ type: 'resurrect_heroes' }]);
    expect(libCardAbilities['Redemption [2025 - National]']).toEqual([{ type: 'resurrect_heroes' }]);
  });

  it('labels the ability', () => {
    expect(abilityLabel({ type: 'resurrect_heroes' })).toBe('Resurrect Heroes…');
  });
});

describe("Darius' Decree [T2C]", () => {
  it('is registered with self + opponent Reserve discard abilities', () => {
    const abilities = libCardAbilities["Darius' Decree [T2C]"];
    expect(abilities).toEqual([
      { type: 'discard_characters_from_reserve', target: 'self' },
      { type: 'discard_characters_from_reserve', target: 'opponent' },
    ]);
  });
});

describe('IMITATE_SOUL_IMAGES parity + integrity', () => {
  it('lib and spacetimedb copies are identical', () => {
    expect(serverImitateImages).toEqual(libImitateImages);
  });

  it('every key resolves to a real card via findCard', () => {
    for (const cardName of Object.keys(libImitateImages)) {
      expect(findCard(cardName), `findCard(${JSON.stringify(cardName)})`).toBeTruthy();
    }
  });

  it('every value points to an existing file under public/imitate-souls/cards/', () => {
    for (const [cardName, imgPath] of Object.entries(libImitateImages)) {
      const absPath = path.join(process.cwd(), 'public', imgPath);
      expect(
        fs.existsSync(absPath),
        `${cardName} → ${imgPath} (resolved: ${absPath})`,
      ).toBe(true);
    }
  });

  it('both Imitate Lost Soul variants are registered with imitate_lost_soul', () => {
    const a = libCardAbilities['Lost Soul "Imitate" [III John 1:11]'];
    const b = libCardAbilities['Lost Soul "Imitate" [III John 1:11]  [AB - RoJ]'];
    expect(a, 'regular variant registered').toBeDefined();
    expect(b, 'AB variant registered (note literal double space)').toBeDefined();
    expect(a?.[0]?.type).toBe('imitate_lost_soul');
    expect(b?.[0]?.type).toBe('imitate_lost_soul');
  });

  it('IMITATE_ORIGINAL_IMG matches findCard().imgFile for each Imitate variant', () => {
    for (const [cardName, originalImg] of Object.entries(IMITATE_ORIGINAL_IMG)) {
      const card = findCard(cardName);
      expect(card, `findCard(${cardName})`).toBeTruthy();
      expect(card?.imgFile).toBe(originalImg);
    }
  });
});

describe('isNewTestamentLostSoul', () => {
  it('recognizes NT books across various reference formats', () => {
    expect(isNewTestamentLostSoul('Ephesians 5:14')).toBe(true);
    expect(isNewTestamentLostSoul('III John 1:11')).toBe(true);
    expect(isNewTestamentLostSoul('II Timothy 3:6-7')).toBe(true);
    expect(isNewTestamentLostSoul('I Corinthians 1:27')).toBe(true);
    expect(isNewTestamentLostSoul('1 Corinthians 1:27')).toBe(true);
    expect(isNewTestamentLostSoul('Acts 11:18')).toBe(true);
    expect(isNewTestamentLostSoul('Luke 13:25')).toBe(true);
    expect(isNewTestamentLostSoul('Revelation 22:1')).toBe(true);
  });

  it('rejects OT books and empty/unknown input', () => {
    expect(isNewTestamentLostSoul('Genesis 1:1')).toBe(false);
    expect(isNewTestamentLostSoul('Ezekiel 34:12')).toBe(false);
    expect(isNewTestamentLostSoul('Isaiah 6:1')).toBe(false);
    expect(isNewTestamentLostSoul('II Kings 1:1')).toBe(false);
    expect(isNewTestamentLostSoul('1 Samuel 17')).toBe(false);
    expect(isNewTestamentLostSoul('Proverbs 3:34')).toBe(false);
    expect(isNewTestamentLostSoul('')).toBe(false);
    expect(isNewTestamentLostSoul('Unknown Book 1:1')).toBe(false);
  });

  it('every IMITATE_SOUL_IMAGES key resolves to an NT reference', () => {
    for (const cardName of Object.keys(libImitateImages)) {
      const card = findCard(cardName);
      expect(card, `findCard(${cardName})`).toBeTruthy();
      expect(
        isNewTestamentLostSoul(card!.reference),
        `${cardName} reference "${card!.reference}" should be NT`,
      ).toBe(true);
    }
  });

  it('lib and spacetimedb copies behave identically on a sample of references', () => {
    const samples = [
      'Ephesians 5:14', 'III John 1:11', 'I Corinthians 1:27',
      'Genesis 1:1', 'Ezekiel 34:12', 'Isaiah 6:1',
      '', 'Unknown 1:1',
    ];
    for (const ref of samples) {
      expect(serverIsNewTestamentLostSoul(ref), `parity for "${ref}"`).toBe(isNewTestamentLostSoul(ref));
    }
  });
});

describe('simplifyLostSoulName', () => {
  it('extracts the quoted name when present', () => {
    expect(simplifyLostSoulName('Lost Soul "Awake" [Ephesians 5:14 - TPC]')).toBe('Awake');
    expect(simplifyLostSoulName('Lost Soul "Open Hand" [Hebrews 4:13]')).toBe('Open Hand');
  });

  it('falls back to the parenthetical when no quoted name', () => {
    expect(simplifyLostSoulName('Lost Soul Acts 11:18 (NT Only)')).toBe('NT Only');
    expect(simplifyLostSoulName('Lost Soul Matthew 19:26 (First Round Protect)')).toBe('First Round Protect');
  });

  it('strips "Lost Soul " prefix when neither quoted nor parenthetical exists', () => {
    expect(simplifyLostSoulName('Lost Soul Romans 3:23')).toBe('Romans 3:23');
  });
});

describe('hasUsableAbilityInZone', () => {
  it('true for Lost Soul "Harvest" resting in the Land of Redemption', () => {
    // spawn_token has no explicit sourceZones → DEFAULT (which includes LoR).
    expect(hasUsableAbilityInZone({
      cardName: 'Lost Soul "Harvest" [John 4:35]',
      zone: 'land-of-redemption',
    })).toBe(true);
  });

  it('false for the same soul in a pile zone abilities cannot fire from (reserve)', () => {
    expect(hasUsableAbilityInZone({
      cardName: 'Lost Soul "Harvest" [John 4:35]',
      zone: 'reserve',
    })).toBe(false);
  });

  it('false for a card with no registered ability', () => {
    expect(hasUsableAbilityInZone({
      cardName: 'Lost Soul Romans 3:23',
      zone: 'land-of-redemption',
    })).toBe(false);
  });

  it('respects explicit sourceZones (Virgin Birth is usable from hand, not reserve)', () => {
    expect(hasUsableAbilityInZone({ cardName: 'Virgin Birth', zone: 'hand' })).toBe(true);
    expect(hasUsableAbilityInZone({ cardName: 'Virgin Birth', zone: 'reserve' })).toBe(false);
  });

  it('sees inherited abilities from an imitated soul (Imitate → Lawless in LoR)', () => {
    expect(hasUsableAbilityInZone({
      cardName: 'Lost Soul "Imitate" [III John 1:11]',
      imitatingName: 'Lost Soul "Lawless" [Hebrews 12:8]',
      zone: 'land-of-redemption',
    })).toBe(true);
  });
});

describe('player-chosen-count (*_choose) abilities', () => {
  const CHOOSE_TYPES = [
    'look_at_own_deck_choose',
    'reveal_own_deck_choose',
    'look_at_opponent_deck_choose',
    'reveal_opponent_deck_choose',
    'discard_opponent_deck_choose',
  ];
  const chooseEntries = Object.entries(CARD_ABILITIES).flatMap(([name, abilities]) =>
    abilities
      .filter((a) => CHOOSE_TYPES.includes(a.type))
      .map((a) => [name, a] as [string, typeof a & { defaultCount: number; maxCount: number }]),
  );

  it('covers every card that has one', () => {
    expect(chooseEntries.length).toBeGreaterThan(0);
  });

  // The count prompt seeds itself with defaultCount and clamps to maxCount, so a
  // default above the cap would open the dialog already past its own limit.
  it('never seeds a default above its own cap', () => {
    const bad = chooseEntries
      .filter(([, a]) => a.defaultCount > a.maxCount)
      .map(([name, a]) => `${name}: default ${a.defaultCount} > max ${a.maxCount}`);
    expect(bad).toEqual([]);
  });

  it('has a positive, finite cap', () => {
    const bad = chooseEntries
      .filter(([, a]) => !Number.isInteger(a.maxCount) || a.maxCount < 1)
      .map(([name, a]) => `${name}: maxCount ${a.maxCount}`);
    expect(bad).toEqual([]);
  });

  it('renders a label ending in an ellipsis, marking it as prompting for input', () => {
    for (const [name, a] of chooseEntries) {
      expect(abilityLabel(a), name).toMatch(/…$/);
    }
  });
});

describe('getEffectiveAbilities', () => {
  it('returns base abilities when not imitating', () => {
    const out = getEffectiveAbilities({
      cardName: 'Lost Soul "Imitate" [III John 1:11]',
      imitatingName: '',
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.type).toBe('imitate_lost_soul');
  });

  it('appends abilities from the imitated soul (Lawless reveal_own_deck)', () => {
    const out = getEffectiveAbilities({
      cardName: 'Lost Soul "Imitate" [III John 1:11]',
      imitatingName: 'Lost Soul "Lawless" [Hebrews 12:8]',
    });
    expect(out).toHaveLength(2);
    expect(out[0]?.type).toBe('imitate_lost_soul');
    expect(out[1]).toEqual({ type: 'reveal_own_deck', position: 'top', count: 6 });
  });

  it('filters nested imitate_lost_soul so chained imitation does not duplicate the entry', () => {
    const out = getEffectiveAbilities({
      cardName: 'Lost Soul "Imitate" [III John 1:11]',
      imitatingName: 'Lost Soul "Imitate" [III John 1:11]  [AB - RoJ]',
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.type).toBe('imitate_lost_soul');
  });

  it('handles non-Imitate base card (target inheritance still works)', () => {
    // A hypothetical non-Imitate card pretending to imitate Lawless — used to
    // verify the helper doesn't assume the base is the Imitate variant.
    const out = getEffectiveAbilities({
      cardName: 'Three Nails (GoC)',  // has its own three_nails_reset ability
      imitatingName: 'Lost Soul "Lawless" [Hebrews 12:8]',
    });
    expect(out).toHaveLength(2);
    expect(out[0]?.type).toBe('three_nails_reset');
    expect(out[1]?.type).toBe('reveal_own_deck');
  });
});

describe('star abilities are fireable from hand', () => {
  const STAR_HALF_CARDS = [
    'The Coming Prince',
    'Sign of Jonah',
    'The Thankful Leper (GoC)',
    'The Three Visitors',
  ];

  // These 12 star cards have a registry entry that encodes the card's IN-PLAY
  // clause (EE/EC/GE/HERO/TOP/Artifact), not its STAR clause. Firing them from
  // hand during the pre-game star phase would resolve the wrong ability.
  const IN_PLAY_HALF_CARDS = [
    "Balaam's Prophecy",
    'Destructive Sin (GoC)',
    'Choked Seed (GoC)',
    'Redeeming Branch',
    'Strong Demon (GoC)',
    'Shealtiel, the Heir / Shealtiel, the Exilarch (LoC)',
    'Manna (PoC)',
    'Out of Egypt',
    'Ram, the Exalter / Ram, the Uplifted (LoC)',
    'The Outcasts',
    'Conspiring Herodians (GoC)',
    'Foolish Builder (GoC)',
  ];

  it.each(STAR_HALF_CARDS)('%s can fire from hand', (name) => {
    const abilities = CARD_ABILITIES[name];
    expect(abilities, `${name} missing from registry`).toBeDefined();
    for (const a of abilities) {
      expect(a.sourceZones ?? DEFAULT_ABILITY_SOURCE_ZONES).toContain('hand');
    }
  });

  it.each(IN_PLAY_HALF_CARDS)('%s stays in-play only', (name) => {
    const abilities = CARD_ABILITIES[name];
    expect(abilities, `${name} missing from registry`).toBeDefined();
    for (const a of abilities) {
      expect(a.sourceZones ?? DEFAULT_ABILITY_SOURCE_ZONES).not.toContain('hand');
    }
  });
});

describe('set_rotation (Two/Three Liner)', () => {
  it('uses the explicit label', () => {
    expect(abilityLabel({ type: 'set_rotation', rotated: true, label: 'Turn Sideways' }))
      .toBe('Turn Sideways');
    expect(abilityLabel({ type: 'set_rotation', rotated: false, label: 'Turn Upright' }))
      .toBe('Turn Upright');
  });

  it.each(['Lost Souls (Two Liner)', 'Lost Souls (Three Liner)'])(
    '%s is Land-of-Bondage only',
    (name) => {
      const abilities = CARD_ABILITIES[name];
      expect(abilities, `${name} missing from registry`).toBeDefined();
      for (const a of abilities) {
        expect(a.sourceZones).toEqual(['land-of-bondage']);
      }
    },
  );
});

describe('lostSoulValue', () => {
  it('counts the Two/Three Liner souls as 2 and everything else as 1', async () => {
    const { lostSoulValue, DOUBLE_VALUE_LOST_SOULS } = await import('../cardAbilities');
    expect(lostSoulValue('Lost Souls (Two Liner)')).toBe(2);
    expect(lostSoulValue('Lost Souls (Three Liner)')).toBe(2);
    expect(lostSoulValue('Lost Soul "Harvest" [John 4:35]')).toBe(1);
    // Every double-value entry must exist in the card data.
    for (const name of DOUBLE_VALUE_LOST_SOULS) {
      expect(findCard(name), `${name} not in CARDS`).toBeDefined();
    }
  });

  it('SpacetimeDB duplicate stays in sync', async () => {
    const lib = await import('../cardAbilities');
    const server = await import('@/spacetimedb/src/cardAbilities');
    expect(server.DOUBLE_VALUE_LOST_SOULS).toEqual(lib.DOUBLE_VALUE_LOST_SOULS);
    for (const name of lib.DOUBLE_VALUE_LOST_SOULS) {
      expect(server.lostSoulValue(name)).toBe(lib.lostSoulValue(name));
    }
  });
});

describe('toggle_top_deck_reveal — The Foretelling Angel (PC)', () => {
  it('is registered on the PC printing only', () => {
    expect(getAbilitiesForCard('The Foretelling Angel (PC)'))
      .toEqual([{ type: 'toggle_top_deck_reveal' }]);
    // The Paragon-era "Foretelling Angel" is a different card (look-at peeks).
    expect(getAbilitiesForCard('Foretelling Angel').some(a => a.type === 'toggle_top_deck_reveal')).toBe(false);
  });

  it('labels the menu item with the printed wording', () => {
    expect(abilityLabel({ type: 'toggle_top_deck_reveal' }))
      .toBe('Play with top card of deck face up');
  });
});

describe('isDanielCard', () => {
  it('matches names containing Daniel, case-insensitively', () => {
    expect(isDanielCard('Daniel (Pr)')).toBe(true);
    expect(isDanielCard('Daniel, the Apocalyptist (PoC)')).toBe(true);
    expect(isDanielCard("Daniel's Guardian")).toBe(true);
    expect(isDanielCard('Faith of Daniel')).toBe(true);
    expect(isDanielCard('Lost Soul "Stubborn" [Daniel 9:6]')).toBe(true);
  });

  it('matches cards whose printed reference cites the book of Daniel', () => {
    expect(isDanielCard('The Final Act', 'Daniel 12:10')).toBe(true);
    expect(isDanielCard('Fiery Furnace', 'Daniel 3:20')).toBe(true);
  });

  it('rejects non-Daniel names/references and empty input', () => {
    // TFA itself cites Daniel 10:6, so only the bare name misses.
    expect(isDanielCard('The Foretelling Angel (PC)')).toBe(false);
    expect(isDanielCard('David (Roots)', 'I Samuel 17:50')).toBe(false);
    expect(isDanielCard('')).toBe(false);
  });
});

describe('redeemedSoulValue / countRedeemedSouls (Land of Redemption count)', () => {
  // Everything a player puts in the Land of Redemption counts at its
  // lostSoulValue — Lost Souls, token souls, rescued captured characters —
  // except Guardian of Your Souls, which places itself there without being
  // a Redeemed Soul.
  it('counts every card at its lostSoulValue: Liners 2, anything else 1', async () => {
    const { redeemedSoulValue } = await import('../cardAbilities');
    expect(redeemedSoulValue({ cardName: 'Lost Soul "Harvest" [John 4:35]' })).toBe(1);
    expect(redeemedSoulValue({ cardName: 'Lost Souls (Two Liner)' })).toBe(2);
    expect(redeemedSoulValue({ cardName: 'Lost Souls (Three Liner)' })).toBe(2);
    expect(redeemedSoulValue({ cardName: 'Harvest Soul Token' })).toBe(1);
    // A rescued captured character is a Redeemed Soul too.
    expect(redeemedSoulValue({ cardName: 'Moses' })).toBe(1);
    expect(redeemedSoulValue({ cardName: 'Goliath' })).toBe(1);
  });

  it('counts Guardian of Your Souls (every printing) as zero', async () => {
    const { redeemedSoulValue } = await import('../cardAbilities');
    const printings = CARDS.filter(c => c.name.toLowerCase().startsWith('guardian of your souls'));
    expect(printings.length).toBeGreaterThanOrEqual(4);
    for (const card of printings) {
      expect(card.type).toBe('Dominant');
      expect(redeemedSoulValue({ cardName: card.name }), card.name).toBe(0);
    }
    // No other card shares the prefix, so the name test excludes only GoYS.
    for (const name of ['Guardian Angel', 'Angel of Your Souls', 'Your Souls']) {
      expect(redeemedSoulValue({ cardName: name }), name).toBe(1);
    }
  });

  it('countRedeemedSouls sums a mixed Land of Redemption', async () => {
    const { countRedeemedSouls } = await import('../cardAbilities');
    expect(countRedeemedSouls([])).toBe(0);
    expect(countRedeemedSouls([
      { cardName: 'Lost Souls (Two Liner)' },          // 2
      { cardName: 'Lost Soul "Harvest" [John 4:35]' }, // 1
      { cardName: 'Moses' },                           // 1 (rescued captive)
      { cardName: 'Guardian Of Your Souls' },          // 0
      { cardName: 'Harvest Soul Token' },              // 1
    ])).toBe(5);
  });

  it('SpacetimeDB duplicate behaves identically (checkAndApplyWin uses it)', async () => {
    const lib = await import('../cardAbilities');
    const server = await import('@/spacetimedb/src/cardAbilities');
    const samples = [
      'Lost Souls (Two Liner)',
      'Lost Souls (Three Liner)',
      'Lost Soul "Harvest" [John 4:35]',
      'Harvest Soul Token',
      'Moses',
      'Goliath',
      'Guardian Of Your Souls',
      'Guardian of Your Souls (RoJ)',
      'Guardian of Your Souls [2024 - 1st Place]',
      'Guardian of Your Souls [2024 - National]',
      'Ark of the Covenant',
    ];
    for (const cardName of samples) {
      expect(server.redeemedSoulValue({ cardName }), `parity for ${cardName}`).toBe(lib.redeemedSoulValue({ cardName }));
    }
  });
});
