import { describe, it, expect } from "vitest";
import { applyCardArtists, titleKey, setMatches, cueArtist, sameCredit } from "../applyCardArtists";
import cardData from "../../../lib/cards/generated/cardData.json";

const card = (over: Record<string, string> = {}) => ({
  name: "Abigail (Wo)", set: "Wom", imgFile: "Abigail_(Wo)", officialSet: "Women",
  type: "Hero", brigade: "Green", strength: "5", toughness: "5", class: "",
  identifier: "", specialAbility: "", rarity: "Common", reference: "I Samuel 25:3",
  alignment: "Good", legality: "", ...over,
});
const row = (name: string, set: string, artist: string, ref = "") => ({ name, set, ref, artist });
const run = (c: ReturnType<typeof card>, rows: ReturnType<typeof row>[], cues = {}) => {
  const r = applyCardArtists([c], { rows }, cues);
  return { artist: (c as Record<string, string>).artist, method: r.methods.get(c) };
};

describe("applyCardArtists", () => {
  it("takes the row from the printing's own set when a reprint changed the art", () => {
    const rows = [row("Abigail [K]", "K Starter", "J.J. Tissot"), row("Abigail [Wo]", "Women", "Sue Dawe")];
    expect(run(card(), rows)).toEqual({ artist: "Sue Dawe", method: "sheetSet" });
    expect(run(card({ name: "Abigail [K]", set: "K", officialSet: "K Starter" }), rows).artist).toBe("J.J. Tissot");
  });

  it("maps the first base set's deck letters to Main / Main Unlimited / 1st Edition", () => {
    expect(setMatches({ officialSet: "Main" }, "A,a,L,Un")).toBe(true);
    expect(setMatches({ officialSet: "Main Unlimited" }, "B,b,L,Un")).toBe(true);
    expect(setMatches({ officialSet: "1st Edition" }, "L,Un")).toBe(false);
    expect(setMatches({ officialSet: "2nd Edition" }, "D Starter")).toBe(true);
    expect(setMatches({ officialSet: "Roots" }, "Redemption Roots")).toBe(true);
  });

  it("tells Lost Souls apart by verse", () => {
    const rows = [
      row("Lost Soul [Ezekiel 34:12 - Or]", "A,a,B,b,L,Un", "Steve Firchow", "Ezekiel 34:12"),
      row("Lost Soul [Ephesians 5:14 - Or]", "A,a,B,b,L,Un", "John Corbitt", "Ephesians 5:14"),
    ];
    const c = card({ name: "Lost Soul Ezekiel 34:12 (UL)", set: "Main UL", officialSet: "Main Unlimited", reference: "Ezekiel 34:12" });
    expect(run(c, rows).artist).toBe("Steve Firchow");
  });

  it("does not hand a Lost Soul another verse's artist when its set holds a whole family of them", () => {
    // 1st Edition Unlimited (a/b decks) has many Lost Souls; this verse was only
    // printed in A/B, with art the a/b rows don't share.
    const rows = [
      row("Lost Soul [Ezekiel 36:19 - Or]", "A,B", "Tom Simonton", "Ezekiel 36:19"),
      row("Lost Soul [Ezekiel 34:12 - Or]", "A,a,B,b,L,Un", "Steve Firchow", "Ezekiel 34:12"),
      row("Lost Soul [Luke 15:6 - Or]", "A,a,B,b", "Scott Sava", "Luke 15:6"),
    ];
    const c = card({ name: "Lost Soul Ezekiel 36:19 (UL)", set: "1EU", imgFile: "LS", officialSet: "1st Edition Unlimited", reference: "Ezekiel 36:19" });
    // Its own verse is only filed under A/B, which is no proof the a/b print
    // shares the art — so blank, never a neighbour's Steve Firchow.
    expect(run(c, rows).artist).toBe("");
    // The scan of the printing settles it.
    const cues = { "Lost Soul Ezekiel 36:19 (UL)|1EU|LS": { illustrator: "Illus. Tom Simonton" } };
    expect(run(c, rows, cues)).toEqual({ artist: "Tom Simonton", method: "scan" });
  });

  it("never answers a Lost Soul from a row with another verse", () => {
    // One other Lost Soul in the set agrees with itself — still not this card.
    const rows = [
      row("Lost Soul \"Bar\" [John 3:16]", "Warriors", "Doug Gray", "John 3:16"),
      row("Lost Soul \"Foo\" [Romans 3:23]", "Promo", "Ned Loeb", "Romans 3:23"),
    ];
    const c = card({ name: "Lost Soul \"Foo\" [Romans 3:23] (Wa)", set: "War", officialSet: "Warriors", reference: "Romans 3:23" });
    expect(run(c, rows).artist).toBe("");
  });

  it("does not let the typo pass join two different cards with near-identical titles", () => {
    const rows = [row("King Jehoiakim [Ki]", "Kings", "Doug Gray", "II Kings 23:36")];
    const c = card({ name: "King Jehoiakin (Ki)", set: "Ki", officialSet: "Kings", reference: "II Kings 24:8" });
    expect(run(c, rows).artist).toBe("");
  });

  it("merges an artist's spellings into the most common one", () => {
    const rows = [
      row("A [Ap]", "Apostles", "Jean-Leon Gerome"),
      row("B [Ap]", "Apostles", "Jean-Leon Gerome"),
      row("C [Ap]", "Apostles", "Jean Leon Gerome"),
    ];
    const cards = ["A (Ap)", "B (Ap)", "C (Ap)"].map((name) => card({ name, set: "Ap", officialSet: "Apostles" }));
    applyCardArtists(cards, { rows }, {});
    expect(cards.map((c) => (c as Record<string, string>).artist)).toEqual(Array(3).fill("Jean-Leon Gerome"));
  });

  it("separates same-verse variants by the words their names add", () => {
    const rows = [
      row("Aliens [Black/Pale Green]", "Lineage of Christ", "William Hole", "II Chronicles 2:17"),
      row("Aliens [Brown/Gray]", "Lineage of Christ", "C.M. Burd", "II Chronicles 2:17"),
    ];
    const c = card({ name: "Aliens (LoC Black/Pale Green)", set: "LoC", officialSet: "Lineage of Christ", reference: "II Chronicles 2:17" });
    expect(run(c, rows).artist).toBe("William Hole");
  });

  it("ignores a credit cell holding a verse, and falls back to the scan", () => {
    const c = card({ name: "Chariot of Fire (Wa)", set: "War", imgFile: "Chariot_of_Fire_(Wa)", officialSet: "Warriors" });
    const rows = [row("Chariot of Fire [Wa]", "Warriors", "II Kings 2:11")];
    const cues = { "Chariot of Fire (Wa)|War|Chariot_of_Fire_(Wa)": { illustrator: "Illus. Doug Gray" } };
    expect(run(c, rows, cues)).toEqual({ artist: "Doug Gray", method: "scan" });
  });

  it("matches a misspelled name only within the printing's own set", () => {
    const ref = "II Chronicles 23:17";
    const rows = [row("Mattan, Priest of Baal", "Lineage of Christ", "Michel-Ange Houasse", ref)];
    const typo = card({ name: "Mattan, Priiest of Baal (LoC)", set: "LoC", officialSet: "Lineage of Christ", reference: ref });
    expect(run(typo, rows)).toEqual({ artist: "Michel-Ange Houasse", method: "sheetFuzzy" });
    const otherSet = card({ name: "Mattan, Priiest of Baal (Ki)", set: "Ki", officialSet: "Kings", reference: ref });
    expect(run(otherSet, rows).artist).toBe("");
  });

  it("borrows another set's artist only for printings that reuse art", () => {
    const rows = [row("Moses' Parents", "Cloud of Witnesses", "Nicolas Poussin"), row("Magnificat [Ap]", "Apostles", "J.J. Tissot")];
    const ab = card({ name: "Moses' Parents (CoW AB)", set: "CoW (AB)", officialSet: "Cloud of Witnesses (Alternate Border)" });
    expect(run(ab, rows)).toEqual({ artist: "Nicolas Poussin", method: "sheetName" });
    // Magnificat (Di) prints Carl Bloch — a reprint's art can't be assumed.
    const reprint = card({ name: "Magnificat", set: "Di", officialSet: "Disciples" });
    expect(run(reprint, rows).artist).toBe("");
  });

  it("lets the scan of this printing overrule the sheet when it names someone else", () => {
    // Repentance (L): the sheet says John Corbitt, the card prints Joe Boulden.
    const c = card({ name: "Repentance (L)", set: "Main", imgFile: "Repentance_(UL)", officialSet: "Main" });
    const rows = [row("Repentance [Or]", "A,a,L,Un", "John Corbitt")];
    const cues = { "Repentance (L)|Main|Repentance_(UL)": { illustrator: "Illus. Joe Boulden" } };
    expect(run(c, rows, cues)).toEqual({ artist: "Joe Boulden", method: "scanOverride" });
  });

  it("keeps the sheet's spelling when the scan only misreads it", () => {
    const c = card({ name: "David the Shepherd", set: "CoW", imgFile: "David", officialSet: "Cloud of Witnesses" });
    const rows = [row("David the Shepherd", "Cloud of Witnesses", "Francois Biennoury")];
    const cues = { "David the Shepherd|CoW|David": { illustrator: "Illus. Francois Blonnoury" } };
    expect(run(c, rows, cues)).toEqual({ artist: "Francois Biennoury", method: "sheetSet" });
  });

  it("decides whether two credits name the same artist", () => {
    expect(sameCredit("Steven Firchow", "Steve Firchow")).toBe(true);
    expect(sameCredit("Quatremere de Quincy", "Quatremère de Quincy")).toBe(true);
    expect(sameCredit("Edwin Church", "Frederic Edwin Church")).toBe(true);
    expect(sameCredit("Standard Publishing / GoodSalt.com", "Standard Publishing")).toBe(true);
    expect(sameCredit("Backyard Entertainment", "Backyard Tournament")).toBe(true);
    expect(sameCredit("Jeff Preston / GoodSalt.com", "Carl Wuttke / GoodSalt.com")).toBe(false);
    expect(sameCredit("Christopher Kohler", "Christian Köhler")).toBe(false);
    expect(sameCredit("Joe Boulden", "AI Generated")).toBe(false);
    expect(sameCredit("Artist Unknown", "Unknown Artist")).toBe(true);
    expect(sameCredit("Artist Unknown", "Artist Unknown & Frans Pourbus")).toBe(false);
    expect(sameCredit("Jason Weingart", "Artist Unknown")).toBe(false);
  });

  it("keeps a Forge release's own credit over any sheet or scan match", () => {
    const rows = [row("Abigail [Wo]", "Women", "Sue Dawe")];
    const cues = { "Abigail (Wo)|Wom|Abigail_(Wo)": { illustrator: "Illus. Someone Else" } };
    expect(run(card({ artist: " Gustave Doré " }), rows, cues)).toEqual({ artist: "Gustave Doré", method: "forge" });
    // A Forge card released with no credit is filled like any other printing.
    expect(run(card({ artist: "" }), rows)).toEqual({ artist: "Sue Dawe", method: "sheetSet" });
  });

  it("does not merge credits that have no Latin letters into one name", () => {
    const cards = ["Μιχαηλ Καρρολλ", "李明", "李明", "—"].map((artist, i) => card({ name: `Forge ${i}`, artist }));
    applyCardArtists(cards, { rows: [] }, {});
    expect(cards.map((c) => (c as Record<string, string>).artist)).toEqual(["Μιχαηλ Καρρολλ", "李明", "李明", "—"]);
  });

  it("leaves a printing nobody can place empty", () => {
    expect(run(card({ name: "Nowhere Card" }), [])).toEqual({ artist: "", method: undefined });
  });

  it("normalizes names and scanner credits", () => {
    expect(titleKey("Lost Soul \"Wanderer\" [Ezekiel 34:6 - RR]")).toBe("lost soul");
    expect(titleKey("Elders of Jerusalem - Black Background")).toBe("elders of jerusalem");
    expect(titleKey("Moses' Parents (CoW AB)")).toBe("moses parents");
    expect(cueArtist("Illus. © Jamison Services, Inc.")).toBe("Jamison Services, Inc.");
    expect(cueArtist("Ιλλυς. Μιχαηλ Καρρολλ")).toBe("");
    expect(cueArtist("Illυ. Μιχαηλ Καρρολλ")).toBe("");
    expect(cueArtist("Illus. Steve Gulık")).toBe("Steve Gulık");
    expect(cueArtist("Illus, Edward Goodall")).toBe("Edward Goodall");
    expect(cueArtist(null)).toBe("");
  });
});

describe("generated catalog", () => {
  it("credits an artist on at least 99% of printings", () => {
    const rows = cardData as Array<{ artist?: string }>;
    const credited = rows.filter((c) => c.artist).length;
    expect(credited / rows.length).toBeGreaterThanOrEqual(0.99);
  });
});
