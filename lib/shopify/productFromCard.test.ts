import { describe, it, expect } from 'vitest';
import type { CardData } from '@/lib/cards/generated/cardData';
import { CARDS } from '@/lib/cards/lookup';
import { productFromCard, baseCardName, slugifyTitle, cardSku } from './productFromCard';

// Fixtures: EXACT rows from lib/cards/generated/cardData.json (Step 1 extraction).
//
// Note: the dump product for "I AM Has Sent Me" has title `"I AM" Has Sent Me (PoC)`
// (quotes around "I AM"), but the underlying generated card record's `name` field is
// literally `I AM Has Sent Me` — no quotes. That quoting is a one-off manual/editorial
// choice on the Shopify side (not reproducible by a general baseCardName + ytgAbbrev
// rule), so the title/alt assertions below use the real, unquoted fixture value. A
// real import of this exact card would need `titleOverride` to reproduce the quoted
// dump title verbatim — see the titleOverride test below for that path.
const I_AM_HAS_SENT_ME: CardData = {
  name: 'I AM Has Sent Me',
  set: 'PoC',
  imgFile: '021-I-AM-Has-Sent-Me',
  officialSet: 'Prophecies of Christ',
  type: 'GE',
  brigade: 'Green/Teal',
  strength: '3',
  toughness: '2',
  class: '',
  identifier: '',
  specialAbility:
    '(Star) Shuffle a card from Reserve. (HE) If used by an Exodus or * Hero, interrupt the battle. Hero may band to any number of O.T. Heroes.',
  rarity: 'Common',
  reference: 'Exodus 3:14',
  alignment: 'Good',
  legality: 'Rotation',
  artist: '',
};

const ABUSIVE_SOLDIERS: CardData = {
  name: 'Abusive Soldiers (GoC)',
  set: 'GoC',
  imgFile: '217-Abusive-Soldiers',
  officialSet: 'Gospel of Christ',
  type: 'Evil Character',
  brigade: 'Gold',
  strength: '2',
  toughness: '1',
  class: 'Warrior',
  identifier: 'Generic, Gospel',
  specialAbility:
    'You may reserve a Hero from opponent’s hand. Protect gold Evil Characters from the next good Enhancement played in battle.',
  rarity: 'Common',
  reference: 'Luke 23:11',
  alignment: 'Evil',
  legality: 'Rotation',
  artist: '',
};

const ROMAN_SOLDIERS_FAITH: CardData = {
  name: "A Roman Soldier's Faith",
  set: 'Ap',
  imgFile: "A_Roman_Soldier's_Faith_(Ap)",
  officialSet: 'Apostles',
  type: 'GE',
  brigade: 'Red',
  strength: '3',
  toughness: '3',
  class: '',
  identifier: '',
  specialAbility: 'Heal any Hero in play.',
  rarity: 'Common',
  reference: 'Matthew 8:5-6',
  alignment: 'Good',
  legality: '',
  artist: '',
};

describe('baseCardName', () => {
  it('strips a trailing set parenthetical', () => {
    expect(baseCardName('Abusive Soldiers (GoC)')).toBe('Abusive Soldiers');
  });
  it('strips a trailing bracket qualifier', () => {
    expect(baseCardName('7 Years of Famine [RR2]')).toBe('7 Years of Famine');
  });
  it('keeps internal quotes/parentheticals', () => {
    expect(baseCardName('"I AM" Has Sent Me (PoC)')).toBe('"I AM" Has Sent Me');
  });
  it('returns names with no qualifier unchanged', () => {
    expect(baseCardName('Son of God')).toBe('Son of God');
  });
});

describe('slugifyTitle', () => {
  it('matches YTG handle for quoted title', () => {
    expect(slugifyTitle('"I AM" Has Sent Me (PoC)')).toBe('i-am-has-sent-me-poc');
  });
  it('collapses apostrophes without a hyphen', () => {
    expect(slugifyTitle("A Roman Soldier's Faith (Ap)")).toBe('a-roman-soldiers-faith-ap');
  });
  it('handles commas and multiple parentheticals', () => {
    expect(slugifyTitle('Abaddon, the Destroyer (AB) (RoJ)')).toBe('abaddon-the-destroyer-ab-roj');
  });
});

describe('productFromCard', () => {
  const opts = { price: '0.75', imageUrl: 'https://blob.example/card-images/x.jpg', status: 'DRAFT' as const };

  it('reproduces the real YTG product shape for "I AM" Has Sent Me (PoC)', () => {
    const built = productFromCard(I_AM_HAS_SENT_ME, 'PoC', opts);
    // Real fixture name has no quotes (see fixture comment above) — computed title
    // reflects that, unlike the dump's manually-quoted title.
    expect(built.input.title).toBe('I AM Has Sent Me (PoC)');
    expect(built.input.handle).toBe('i-am-has-sent-me-poc');
    expect(built.input.tags).toEqual(['Good Enhancement', 'Green', 'Prophecies of Christ', 'Rotation Cards', 'Teal']);
    expect(built.input.productType).toBe('Single');
    expect(built.input.vendor).toBe('Your Turn Games');
    expect(built.input.status).toBe('DRAFT');
    expect(built.input.productOptions).toEqual([{ name: 'Title', values: [{ name: 'Default Title' }] }]);
    expect(built.input.variants).toEqual([{ optionValues: [{ optionName: 'Title', name: 'Default Title' }], price: '0.75', sku: cardSku(I_AM_HAS_SENT_ME), inventoryItem: { tracked: true } }]);
    expect(built.input.files).toEqual([{ originalSource: opts.imageUrl, contentType: 'IMAGE', alt: 'I AM Has Sent Me' }]);
    expect(built.warnings).toEqual([]);
  });

  it('maps bare Gold brigade on an evil card to Evil Gold tag', () => {
    const built = productFromCard(ABUSIVE_SOLDIERS, 'GoC', opts);
    expect(built.input.tags).toContain('Evil Gold');
    expect(built.input.tags).not.toContain('Gold');
    expect(built.input.tags).toContain('Evil Character');
    expect(built.input.tags).toContain('Gospel of Christ');
  });

  it('omits Rotation Cards for non-rotation cards', () => {
    const built = productFromCard(ROMAN_SOLDIERS_FAITH, 'Ap', opts);
    expect(built.input.tags).toEqual(['Apostles', 'Good Enhancement', 'Red']);
  });

  it('handles missing price / image / alias with warnings, never throws', () => {
    const built = productFromCard(I_AM_HAS_SENT_ME, null, { price: null, imageUrl: null, status: 'DRAFT' });
    expect(built.input.variants![0].price).toBe('0.00');
    expect(built.input.files).toBeUndefined();
    expect(built.input.title).toBe('I AM Has Sent Me (PoC)'); // falls back to card.set
    expect(built.warnings).toEqual(expect.arrayContaining(['no-price', 'no-image', 'no-set-alias']));
  });

  it('omits files when includeMedia is false (update re-run)', () => {
    const built = productFromCard(I_AM_HAS_SENT_ME, 'PoC', { ...opts, includeMedia: false });
    expect(built.input.files).toBeUndefined();
  });

  it('uses titleOverride verbatim and slugs the handle from it', () => {
    const built = productFromCard(I_AM_HAS_SENT_ME, 'PoC', { ...opts, titleOverride: '"I AM" Has Sent Me (Legacy Rare)' });
    expect(built.input.title).toBe('"I AM" Has Sent Me (Legacy Rare)');
    expect(built.input.handle).toBe('i-am-has-sent-me-legacy-rare');
  });

  it('always attaches the rtt_card_key metafield', () => {
    const built = productFromCard(I_AM_HAS_SENT_ME, 'PoC', opts);
    expect(built.input.metafields).toEqual([{ namespace: 'custom', key: 'rtt_card_key', value: built.cardKey, type: 'single_line_text_field' }]);
  });

  it('adds Dual Alignment for cross-alignment compound types', () => {
    const dual: CardData = { ...I_AM_HAS_SENT_ME, type: 'GE/EE' };
    const built = productFromCard(dual, 'PoC', opts);
    expect(built.input.tags).toEqual(expect.arrayContaining(['Good Enhancement', 'Evil Enhancement', 'Dual Alignment']));
  });

  it('omits variants/productOptions and the no-price warning when includeVariants is false', () => {
    const built = productFromCard(I_AM_HAS_SENT_ME, 'PoC', { ...opts, price: null, includeVariants: false });
    expect(built.input.variants).toBeUndefined();
    expect(built.input.productOptions).toBeUndefined();
    expect(built.warnings).not.toContain('no-price');
  });

  it('keeps variants/productOptions by default (includeVariants unset)', () => {
    const built = productFromCard(I_AM_HAS_SENT_ME, 'PoC', opts);
    expect(built.input.variants).toBeDefined();
    expect(built.input.productOptions).toBeDefined();
  });

  it('sets descriptionHtml from the special ability by default', () => {
    const built = productFromCard(ABUSIVE_SOLDIERS, 'GoC', opts);
    expect(built.input.descriptionHtml).toBe(`<p>${ABUSIVE_SOLDIERS.specialAbility}</p>`);
  });

  it('HTML-escapes the special ability in descriptionHtml', () => {
    const card: CardData = { ...ABUSIVE_SOLDIERS, specialAbility: `A "Test" & <tag> isn't fine` };
    const built = productFromCard(card, 'GoC', opts);
    expect(built.input.descriptionHtml).toBe('<p>A &quot;Test&quot; &amp; &lt;tag&gt; isn&#39;t fine</p>');
  });

  it('omits descriptionHtml when includeDescription is false', () => {
    const built = productFromCard(ABUSIVE_SOLDIERS, 'GoC', { ...opts, includeDescription: false });
    expect(built.input.descriptionHtml).toBeUndefined();
  });

  it('omits inventoryItem when trackInventory is false (update re-run)', () => {
    const built = productFromCard(I_AM_HAS_SENT_ME, 'PoC', { ...opts, trackInventory: false });
    expect(built.input.variants![0]).not.toHaveProperty('inventoryItem');
  });

  it('omits descriptionHtml when specialAbility is empty', () => {
    const card: CardData = { ...ABUSIVE_SOLDIERS, specialAbility: '' };
    const built = productFromCard(card, 'GoC', opts);
    expect(built.input.descriptionHtml).toBeUndefined();
  });

  it('omits descriptionHtml when specialAbility is whitespace-only', () => {
    const card: CardData = { ...ABUSIVE_SOLDIERS, specialAbility: '   ' };
    const built = productFromCard(card, 'GoC', opts);
    expect(built.input.descriptionHtml).toBeUndefined();
  });
});

describe('cardSku collision guard', () => {
  it('collides for exactly one known pair: Angel of the Lord (G)/(H), both 10A, shared imgFile', () => {
    // Spec §Matching tab: this collision is inert — 10A is in UNSOLD_SETS → no_price_exists.
    // If card data ever grows a SECOND collision, pass 0 could silently mis-match; this test is the tripwire.
    const bySku = new Map<string, string[]>();
    for (const c of CARDS) {
      const sku = cardSku(c);
      const list = bySku.get(sku) ?? [];
      list.push(`${c.name}|${c.set}|${c.imgFile}`);
      bySku.set(sku, list);
    }
    const collisions = [...bySku.entries()].filter(([, keys]) => keys.length > 1);
    expect(collisions).toHaveLength(1);
    expect(collisions[0][0]).toBe('10A-Angel_of_the_Lord_(G)');
    expect(collisions[0][1].map(k => k.split('|')[0]).sort()).toEqual([
      'Angel of the Lord (G)',
      'Angel of the Lord (H)',
    ]);
  });
});
