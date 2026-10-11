/** Nationals promo card data. Year → array of promos. */

export interface PromoCard {
  label: string;
  cardName: string;
  imgFile: string;
}

const PROMO_LABEL_ORDER = [
  "1st Place",
  "2nd Place",
  "3rd Place",
  "Top Cut",
  "Side Event",
  "Worker",
  "Participation",
];

const PROMO_DATA: Record<number, PromoCard[]> = {
  2001: [{ label: "Participation", cardName: "Authority of Christ (Promo)", imgFile: "Authority_of_Christ_(Promo)" }],
  2002: [{ label: "Participation", cardName: "Mary's Prophetic Act", imgFile: "Mary's_Prophetic_Act_(Promo)" }],
  2003: [{ label: "Participation", cardName: "Walking on Water (Promo)", imgFile: "Walking_on_Water_(Promo)" }],
  2006: [{ label: "Participation", cardName: "Elijah (Promo)", imgFile: "Elijah_(Promo)" }],
  2007: [{ label: "Participation", cardName: "Priests of Christ (Promo)", imgFile: "Priests_of_Christ_(Promo)" }],
  2008: [{ label: "Participation", cardName: "Split Altar (Promo)", imgFile: "Split_Altar_(Promo)" }],
  2011: [{ label: "Participation", cardName: "Daniel (Promo)", imgFile: "Daniel_(Promo)" }],
  2014: [{ label: "Participation", cardName: "Glory of the Lord (Promo)", imgFile: "Glory_of_the_Lord_(Promo)" }],
  2015: [{ label: "Participation", cardName: "Glory of the Lord (2015 Promo)", imgFile: "Glory-of-the-Lord-2015-P" }],
  2016: [
    { label: "1st Place", cardName: "Son of God (2016 Promo)", imgFile: "Son-of-God-2016-P" },
    { label: "2nd Place", cardName: "Captain of the Host (2016 Promo)", imgFile: "Captain-of-the-Host-2016-P" },
    { label: "3rd Place", cardName: "Angel of the Lord (2016 Promo)", imgFile: "Angel-of-the-Lord-2016-P" },
    { label: "Participation", cardName: "Noah's Ark (Promo)", imgFile: "Noahs-Ark" },
  ],
  2017: [
    { label: "1st Place", cardName: "Son of God (2017 Promo)", imgFile: "Son-of-God-2017-P" },
    { label: "2nd Place", cardName: "Michael (2017 Promo)", imgFile: "Michael-2017-P" },
    { label: "3rd Place", cardName: "Angel of the Lord (2017 Promo)", imgFile: "Angel-of-the-Lord-2017-P" },
    { label: "Participation", cardName: "The Tabernacle (Promo)", imgFile: "The-Tabernacle-Promo" },
  ],
  2018: [
    { label: "1st Place", cardName: "Son of God (2018 Promo)", imgFile: "Son-of-God-2018" },
    { label: "2nd Place", cardName: "Falling Away (2018 Promo)", imgFile: "Falling-Away-Borderless" },
    { label: "3rd Place", cardName: "Angel of the Lord (2018 Promo)", imgFile: "Angel-of-the-Lord-2018" },
    { label: "Participation", cardName: "Whirlwind / Everlasting Ground", imgFile: "Whirlwind" },
  ],
  2019: [
    { label: "1st Place", cardName: 'Lost Soul "Darkness" (2019 Promo)', imgFile: "Promo_Lost-Soul-Darkness-Job_30-26-Nats2019" },
    { label: "2nd Place", cardName: "The Strong Angel (Promo)", imgFile: "Promo_The-Strong-Angel-Nats2019" },
    { label: "3rd Place", cardName: "Christian Martyr (2019 Promo)", imgFile: "Promo_Christian-Martyr-Nats2019" },
    { label: "Participation", cardName: "Son of God (2019 Promo)", imgFile: "Promo_Son-of-God-Nationals" },
    { label: "Participation", cardName: "New Jerusalem (Nats Promo)", imgFile: "Promo_New-Jerusalem-Nationals" },
    { label: "Top Cut", cardName: "The Priest of Zeus (Promo)", imgFile: "Promo_The-Priest-of-Zeus" },
    { label: "Worker", cardName: "Moses (Promo)", imgFile: "Promo_Moses_CoW" },
  ],
  2020: [
    { label: "1st Place", cardName: "Son of God (2020 Promo)", imgFile: "Son-of-God-2020-P" },
    { label: "2nd Place", cardName: "Angel of the Lord (2020 Promo)", imgFile: "Angel-of-the-Lord-2020-P" },
    { label: "3rd Place", cardName: "Glory of the Lord (2020 Promo)", imgFile: "Glory-of-the-Lord-2020-P" },
    { label: "Participation", cardName: "Mayhem (2020 Promo)", imgFile: "Mayhem-2020-P" },
    { label: "Top Cut", cardName: "Michael (2020 Promo)", imgFile: "Michael-2020-P" },
    { label: "Worker", cardName: "Captain of the Host (2020 Promo)", imgFile: "Captain-of-the-Host-2020-P" },
  ],
  2021: [
    { label: "1st Place", cardName: 'Lost Soul "Lawless" (2021 Promo)', imgFile: "Lost-Soul-Lawless-Heb_12-8-P" },
    { label: "2nd Place", cardName: "Grapes of Wrath (2021 Promo)", imgFile: "Grapes-of-Wrath-2021" },
    { label: "3rd Place", cardName: "The Serpent (2021 Promo)", imgFile: "The-Serpent-Nats" },
    { label: "Participation", cardName: "Humble Seeker", imgFile: "Humble-Seeker-2021" },
    { label: "Top Cut", cardName: "Scattered (Promo)", imgFile: "Scattered-P" },
    { label: "Worker", cardName: "The Angel of the Winds (Promo)", imgFile: "The-Angel-of-the-Winds-P" },
  ],
  2022: [
    { label: "1st Place", cardName: "King of Tyrus (2022 Promo)", imgFile: "King-of-Tyrus-Borderless" },
    { label: "2nd Place", cardName: "Treacherous Land (2022 Promo)", imgFile: "Treacherous-Land-alt" },
    { label: "3rd Place", cardName: 'Lost Soul "Humble" (2022 Promo)', imgFile: "Lost-Soul-Humble-alt" },
    { label: "Participation", cardName: "Nicodemus, the Seeker / Teacher (2022)", imgFile: "Nicodemus" },
    { label: "Side Event", cardName: "Foreign Wives (2022 Promo)", imgFile: "Foreign-Wives" },
    { label: "Worker", cardName: "Music Leader (2022 Promo)", imgFile: "Music-Leader-alt" },
  ],
  2023: [
    { label: "1st Place", cardName: "Son of God (2023 Promo)", imgFile: "Son-of-God-Textless-Nats-1st" },
    { label: "2nd Place", cardName: 'Lost Soul "Harvest" (2023 Promo)', imgFile: "Lost-Soul-Harvest-Nats-2nd" },
    { label: "3rd Place", cardName: "Reap the Whirlwind (2023 Promo)", imgFile: "Reap-the-Whirlwind-Nats-3rd" },
    { label: "Participation", cardName: "Angel of God (2023)", imgFile: "Angel-of-God" },
    { label: "Worker", cardName: "War in Heaven (2023 Promo)", imgFile: "War-in-Heaven" },
  ],
  2024: [
    { label: "1st Place", cardName: "Guardian of Your Souls (1st Place)", imgFile: "Guardian-of-Your-Souls-1st" },
    { label: "2nd Place", cardName: "The Gates of Hell (2nd Place)", imgFile: "The-Gates-of-Hell-2nd" },
    { label: "3rd Place", cardName: 'Lost Soul "Prosperity" (3rd Place)', imgFile: "Lost-Soul-Prosperity-3rd" },
    { label: "Participation", cardName: "Guardian of Your Souls (Participation)", imgFile: "Guardian-of-Your-Souls-participation" },
    { label: "Worker", cardName: "Two Bears (2024 Promo)", imgFile: "Two-Bears-Worker" },
  ],
  2025: [
    { label: "1st Place", cardName: "Benaiah, Lion Slayer", imgFile: "Benaiah-Lion-Slayer-1st-place" },
    { label: "2nd Place", cardName: "Twenty Shekels", imgFile: "Twenty-Shekels-2nd-place" },
    { label: "3rd Place", cardName: "Murderous Command", imgFile: "Murderous-Command-3rd-place" },
    { label: "Participation", cardName: "Redemption (2025 Promo)", imgFile: "Redemption-National-Participation" },
    { label: "Worker", cardName: 'Lost Soul "Crowds" (2025 Promo)', imgFile: "Lost-Soul-Crowds-Worker" },
  ],
  2026: [
    { label: "1st Place", cardName: "Son of God (National Promo 2026)", imgFile: "Son-of-God-Nativity-1st-Place" },
    { label: "2nd Place", cardName: 'Lost Soul "Forsaken" (National Promo 2026)', imgFile: "Lost-Soul-Forsaken-2nd-Place" },
    { label: "3rd Place", cardName: "Warrior Overtaken (National Promo 2026)", imgFile: "Warrior-Overtaken-3rd-Place" },
    { label: "Participation", cardName: "Ruth, the Retainer", imgFile: "Ruth-the-Retainer-Participation" },
    { label: "Worker", cardName: "Philosophy [2026 - Worker]", imgFile: "Philosophy-Worker" },
  ],
};

/** Return promos for a given year, sorted by canonical label order. Empty array if none. */
export function promosForYear(year: number): PromoCard[] {
  const raw = PROMO_DATA[year];
  if (!raw || !raw.length) return [];
  return [...raw].sort((a, b) => {
    const ai = PROMO_LABEL_ORDER.indexOf(a.label);
    const bi = PROMO_LABEL_ORDER.indexOf(b.label);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
}
