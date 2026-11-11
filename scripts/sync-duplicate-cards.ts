/**
 * Parse duplicate card groups from the ORDIR PDF and sync to Supabase.
 *
 * This script:
 * 1. Extracts duplicate card groups from the ORDIR PDF using pdftotext
 * 2. Parses each "Name (Sets) or Name (Sets)" line into groups
 * 3. Fetches carddata.txt to get all known card names
 * 4. Matches ORDIR names against carddata.txt names
 * 5. Upserts results into duplicate_card_groups / duplicate_card_group_members
 *
 * Usage: npx tsx scripts/sync-duplicate-cards.ts
 *        npx tsx scripts/sync-duplicate-cards.ts --dry-run
 */

import { createClient } from "@supabase/supabase-js";
import { execSync } from "child_process";
import { join } from "path";
import { config } from "dotenv";
import { CARDS } from "../lib/cards/lookup";

config({ path: join(__dirname, "..", ".env.local") });

const DRY_RUN = process.argv.includes("--dry-run");

const PDF_PATH = join(__dirname, "..", "ORDIR_PDF_7.1.0.pdf");

// --- Types ---

interface DuplicateGroup {
  canonicalName: string;
  members: { cardName: string; ordirSets: string }[];
}

// --- Manual mappings for ORDIR names that don't match carddata.txt ---
// These cover errata'd spellings, punctuation differences, and partial names.
const MANUAL_MAPPINGS: Record<string, string> = {
  // Spelling: ORDIR "Coppersmith" vs carddata "Coopersmith"
  "Alexander the Coppersmith": "Alexander the Coopersmith",
  // Missing comma in carddata
  "Balaam, Son of Beor": "Balaam Son of Beor",
  // Possessive form: singular vs plural (ASCII apostrophe)
  "David, Outcast's Refuge": "David, Outcasts\u2019 Refuge",
  // Same but with unicode right single quotation mark from PDF
  "David, Outcast\u2019s Refuge": "David, Outcasts\u2019 Refuge",
  // "Death" alone is not a card — it's part of "Death & Hades" which is already in the group
  "Death": "Death & Hades",
  // Lowercase + comma difference
  "James, son of Zebedee": "James Son of Zebedee",
  // Comma vs parens: ORDIR "the Despairing" vs carddata "(The Despairing)"
  "Lamech, the Despairing": "Lamech (The Despairing)",
  // Missing comma in ORDIR
  "Martha the Diligent": "Martha, the Diligent",
  // Generic "Matthew" maps to the Matthew (Levi) dual-name card
  "Matthew": "Matthew (Levi)",
  // Possessive form (ASCII)
  "The Amalekite's Slave": "The Amalekites' Slave",
  // Same with unicode apostrophe from PDF
  "The Amalekite\u2019s Slave": "The Amalekites' Slave",
  // Partial name — "The Harlot" is stored as "Babylon The Harlot"
  "The Harlot": "Babylon The Harlot",
  // "Amram & Jochebed" is the alt-border name for "Moses' Parents" in CW set
  // Not a separate card in carddata — map to Moses' Parents
  "Amram & Jochebed": "Moses' Parents",
  // RR2 names that end in a parenthesised alias, which the set-suffix stripper
  // takes for a set code — point them at the exact carddata name instead.
  "Barsabbas (Judas)": "Barsabbas (Judas) [RR2]",
  "The Quelling Spirit (Que)": "The Quelling Spirit (Que) [RR2]",
  // The duplicate list calls the RR2 Hero "The Fourth Living Creature"; the card (and the
  // rest of the ORDIR) is "The Fourth Creature". "Fourth Living Creature" is a different
  // card, the Priests Enhancement.
  "The Fourth Living Creature": "The Fourth Creature [RR2]",
};

// --- Extra members for printings released after the ORDIR PDF ---
// The ORDIR v7 PDF can't list cards printed after it was published, so these
// new printings of existing duplicate groups never come through the parse.
// Keyed by the group's canonical name → exact carddata names to add.
// Re-applied on every sync because the ordir groups are cleared and rebuilt
// each run (a direct DB insert into an ordir group would be wiped).
const EXTRA_MEMBERS: Record<string, string[]> = {
  Ruth: ["Ruth, the Retainer [2026 - National]"],
};

// --- Step 1: Extract duplicate section from ORDIR PDF ---

function extractDuplicateSection(): string {
  console.log("Extracting duplicate card section from ORDIR PDF...");

  const fullText = execSync(`pdftotext "${PDF_PATH}" -`, {
    encoding: "utf-8",
    maxBuffer: 10 * 1024 * 1024,
  });

  // Find the duplicate card section
  const lines = fullText.split("\n");
  let startIdx = -1;
  let endIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === "Duplicate Card" && startIdx === -1) {
      startIdx = i;
    }
    // The section ends with the Tabernacle/Temple note
    // Note: PDF uses Unicode right single quotation mark (') not ASCII apostrophe
    if (
      startIdx !== -1 &&
      lines[i].includes("The Tabernacle") &&
      (lines[i].includes("Solomon's Temple") ||
        lines[i].includes("Solomon\u2019s Temple"))
    ) {
      endIdx = i;
      break;
    }
  }

  if (startIdx === -1 || endIdx === -1) {
    throw new Error("Could not find duplicate card section in ORDIR PDF");
  }

  const section = lines.slice(startIdx, endIdx).join("\n");
  console.log(
    `  Found section: lines ${startIdx + 1} to ${endIdx + 1} (${endIdx - startIdx} lines)`
  );
  return section;
}

// --- Step 2: Parse the duplicate section into groups ---

function parseDuplicateGroups(rawSection: string): DuplicateGroup[] {
  const lines = rawSection.split("\n");

  // Step 1: Strip junk lines (bullets, page numbers, headers) and join into one blob.
  // Each card entry in the PDF ends with a closing ")" for the set list,
  // so we can reconstruct lines that were split across PDF pages.
  const contentLines: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines, bullet-only lines, page numbers, and header text
    if (!trimmed) continue;
    if (trimmed === "•") continue;
    if (/^\d+$/.test(trimmed)) continue; // page numbers like "27", "28"
    if (trimmed === "Duplicate Card") continue;
    if (trimmed.startsWith("Duplicate cards are")) continue;
    if (trimmed.startsWith("The following are unique")) continue;
    if (trimmed.includes("Duplicate Card") && (trimmed.includes('"') || trimmed.includes('\u201c') || trimmed.includes('\u201d'))) continue;
    if (
      trimmed.startsWith("card names.") ||
      trimmed.startsWith("The rules that")
    )
      continue;

    contentLines.push(trimmed);
  }

  // Join everything into one big string, then split into individual entries.
  // Each entry is one duplicate group separated by newlines in the original,
  // but wraps can make a single group span multiple lines.
  // Strategy: join all lines with " ", then use a regex to find entry boundaries.
  const blob = contentLines.join(" ");

  // Each entry looks like:
  //   "Aaron (G, Pa, Pi, Di) or Aaron, God's Mediator (PoC) or ..."
  // Entries are separated by the END of one group (closing paren + space)
  // followed by the START of the next group (a capitalized name that is NOT preceded by "or ").
  //
  // We'll split the blob by finding positions where ") " is followed by a new
  // card name (uppercase letter) that is NOT preceded by "or ".
  const entries: string[] = [];
  // Use a regex: split after a closing paren+space, before a capital letter,
  // but NOT if preceded by "or "
  const entryRegex = /\)\s+(?!or )(?=[A-Z])/g;
  let lastIdx = 0;
  let match;

  while ((match = entryRegex.exec(blob)) !== null) {
    // Include the closing paren in the current entry
    entries.push(blob.slice(lastIdx, match.index + 1).trim());
    lastIdx = match.index + 1;
    // Skip whitespace
    while (lastIdx < blob.length && blob[lastIdx] === " ") lastIdx++;
  }
  // Don't forget the last entry
  if (lastIdx < blob.length) {
    entries.push(blob.slice(lastIdx).trim());
  }

  // Now parse each entry into a duplicate group
  const groups: DuplicateGroup[] = [];
  const usedCanonicalNames = new Map<string, number>();

  for (const entry of entries) {
    // Each entry has the format: "Name1 (Sets) or Name2 (Sets) or Name3 (Sets)"
    const members = splitOnOr(entry);
    if (members.length < 2) continue; // Not a duplicate group

    const parsedMembers = members.map((m) => parseCardEntry(m.trim()));

    // Canonical name: use the shortest/simplest name (usually first)
    let canonicalName = getCanonicalName(parsedMembers);

    // Handle duplicate canonical names (e.g., two different "Eleazar" groups)
    // by appending the first member's distinguishing epithet
    const count = usedCanonicalNames.get(canonicalName) || 0;
    if (count > 0) {
      // Use the first member's full name as disambiguator
      const firstMember = parsedMembers[0].cardName;
      if (firstMember !== canonicalName) {
        canonicalName = firstMember;
      } else {
        canonicalName = `${canonicalName} (${count + 1})`;
      }
    }
    usedCanonicalNames.set(
      getCanonicalName(parsedMembers),
      count + 1
    );

    groups.push({
      canonicalName,
      members: parsedMembers,
    });
  }

  return groups;
}

/**
 * Split a line on " or " boundaries, but only where it separates card names.
 * Card names start with uppercase or "The ".
 */
function splitOnOr(line: string): string[] {
  const parts: string[] = [];
  let current = "";

  // Use regex to find " or " followed by a pattern that looks like a new card name
  // Card names typically: start with uppercase, "The ", digits are not card names
  const regex =
    / or (?=[A-Z]|The |Saint |Faithful |Father |Hadassah |Herodias)/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(line)) !== null) {
    parts.push(line.slice(lastIndex, match.index));
    lastIndex = match.index + match[0].length;
  }
  parts.push(line.slice(lastIndex));

  return parts.filter((p) => p.trim());
}

/**
 * Parse a single card entry like "Aaron (G, Pa, Pi, Di)" or "Aaron, God's Mediator (PoC)"
 * Returns { cardName, ordirSets }
 */
function parseCardEntry(entry: string): {
  cardName: string;
  ordirSets: string;
} {
  // Match the sets in parentheses at the end
  // Be careful: some card names have parentheses, e.g., "Bartholomew (Nathaniel) (Ap)"
  // The sets are always the LAST parenthesized group
  const setsMatch = entry.match(/\s*\(([^)]+)\)\s*$/);

  if (setsMatch) {
    const sets = setsMatch[1];
    const cardName = entry.slice(0, setsMatch.index).trim();
    return { cardName, ordirSets: sets };
  }

  // No sets found — the whole thing is the card name
  return { cardName: entry.trim(), ordirSets: "" };
}

/**
 * Derive a canonical name for the group (shortest base name)
 */
function getCanonicalName(
  members: { cardName: string; ordirSets: string }[]
): string {
  // Usually the first member has the simplest name
  // Strip common prefixes/suffixes to find the base person name
  const firstName = members[0].cardName;

  // For kings, strip "King " prefix
  const withoutTitle = firstName
    .replace(/^King /, "")
    .replace(/^Queen /, "")
    .replace(/^Prince /, "")
    .replace(/^Governor /, "")
    .replace(/^High Priest /, "")
    .replace(/^Chief Captain /, "");

  // For names with comma suffix like "Aaron, God's Mediator", take just the first part
  const baseName = withoutTitle.split(",")[0].trim();

  // For names with bracket variants like "David [Green]", take just the name
  return baseName.replace(/\s*\[.*?\]\s*/, "").trim();
}

// --- Step 3: Fetch carddata.txt and build name index ---

interface CardDataNames {
  /** Exact full names as they appear in carddata.txt (e.g. "Aaron (G)") */
  fullNames: Set<string>;
  /** Base names (set suffix stripped) → list of full names */
  baseToFull: Map<string, string[]>;
}

async function fetchCardNames(): Promise<CardDataNames> {
  console.log("Loading card names from generated module...");

  const fullNames = new Set<string>();
  const baseToFull = new Map<string, string[]>();

  function addBaseName(baseName: string, fullName: string) {
    if (!baseToFull.has(baseName)) {
      baseToFull.set(baseName, []);
    }
    baseToFull.get(baseName)!.push(fullName);
  }

  for (const card of CARDS) {
    const name = card.name;
    if (!name) continue;

    fullNames.add(name);

    // Strip set suffix first
    const baseName = stripSetSuffix(name);

    // Many LC/GC cards have dual names: "Father Abraham / Faithful Abraham (LoC)"
    // After stripping set: "Father Abraham / Faithful Abraham"
    // We need to register BOTH halves as base names
    if (baseName.includes(" / ")) {
      const parts = baseName.split(" / ").map((p) => p.trim());
      for (const part of parts) {
        addBaseName(part, name);
      }
      // Also register the full dual name
      addBaseName(baseName, name);
    } else {
      addBaseName(baseName, name);
    }

    // Some cards use slash WITHOUT spaces: "Abram/Abraham"
    if (baseName.includes("/") && !baseName.includes(" / ")) {
      const parts = baseName.split("/").map((p) => p.trim());
      for (const part of parts) {
        if (part.length > 1) {
          addBaseName(part, name);
        }
      }
    }
  }

  console.log(
    `  Loaded ${fullNames.size} card entries, ${baseToFull.size} unique base names`
  );
  return { fullNames, baseToFull };
}

/**
 * Strip the trailing set abbreviation in parentheses from a carddata.txt name.
 * "Aaron (G)" → "Aaron"
 * "Aaron, God's Mediator" → "Aaron, God's Mediator"  (no set suffix)
 * "Bartholomew (Nathaniel) (Ap)" → "Bartholomew (Nathaniel)"
 * "Abed-nego (Azariah) (PoC)" → "Abed-nego (Azariah)"
 * "Father Abraham / Faithful Abraham (LoC)" → "Father Abraham / Faithful Abraham"
 * "Pharaoh Ramses II (1st Print - K)" → "Pharaoh Ramses II"
 */
function stripSetSuffix(name: string): string {
  // First strip square-bracket set suffixes: "David, Giant Slayer [K]" → "David, Giant Slayer"
  // "[Fundraiser]", "[2025 - Seasonal]", "[K]", "[T2C]", etc.
  let stripped = name.replace(/\s+\[[^\]]+\]\s*$/, "");

  // Then strip parenthesized set suffixes: "Aaron (G)" → "Aaron"
  const match = stripped.match(
    /\s+\(([A-Za-z0-9][A-Za-z0-9 .''\-]*)\)\s*$/
  );
  if (match) {
    const candidate = match[1];
    // Verify it looks like a set, not part of the card name
    // Card name parens typically contain words like "Nathaniel", "Azariah", "Man"
    // Set parens contain abbreviations or "Print", "Edition", "Starter" etc.
    // Heuristic: if it's short (<=15 chars) or contains known set patterns
    if (
      candidate.length <= 15 ||
      /\b(Print|Edition|Starter|AB|UL|Plus|Alternate|Border)\b/i.test(
        candidate
      )
    ) {
      stripped = stripped.slice(0, match.index).trim();
    }
  }
  return stripped;
}

// --- Step 4: Match ORDIR names to carddata.txt ---

interface MatchResult {
  ordirName: string;
  matchedName: string | null;
  matchType: "exact" | "case-insensitive" | "normalized" | "none";
}

function normalizeForMatching(name: string): string {
  return name
    .toLowerCase()
    .replace(/['']/g, "'") // normalize curly quotes
    .replace(/[–—]/g, "-") // normalize dashes
    .replace(/\s+/g, " ")
    .trim();
}

function matchCardName(
  ordirName: string,
  cardData: CardDataNames,
  baseNamesLower: Map<string, string>,
  baseNamesNormalized: Map<string, string>
): MatchResult {
  // 0. Check manual mappings first
  if (MANUAL_MAPPINGS[ordirName]) {
    const mapped = MANUAL_MAPPINGS[ordirName];
    // Verify the mapped name exists in carddata
    const lMapped = mapped.toLowerCase();
    if (
      cardData.baseToFull.has(mapped) ||
      cardData.fullNames.has(mapped) ||
      baseNamesLower.has(lMapped)
    ) {
      return { ordirName, matchedName: mapped, matchType: "normalized" };
    }
    // Mapping exists but target not in carddata — still use it but mark unmatched
    return { ordirName, matchedName: mapped, matchType: "none" };
  }

  // 1. Exact match against base names
  if (cardData.baseToFull.has(ordirName)) {
    return { ordirName, matchedName: ordirName, matchType: "exact" };
  }

  // 2. Case-insensitive match against base names
  const lowerName = ordirName.toLowerCase();
  if (baseNamesLower.has(lowerName)) {
    return {
      ordirName,
      matchedName: baseNamesLower.get(lowerName)!,
      matchType: "case-insensitive",
    };
  }

  // 3. Normalized match (handles unicode quotes, dashes, etc.)
  const normalized = normalizeForMatching(ordirName);
  if (baseNamesNormalized.has(normalized)) {
    return {
      ordirName,
      matchedName: baseNamesNormalized.get(normalized)!,
      matchType: "normalized",
    };
  }

  // 4. Also check full names (some ORDIR names include the set as part of the name)
  if (cardData.fullNames.has(ordirName)) {
    return { ordirName, matchedName: ordirName, matchType: "exact" };
  }

  // 5. Try common variants
  const variants = [
    // Handle unicode curly quotes
    ordirName.replace(/[\u2018\u2019]/g, "'"),
    ordirName.replace(/'/g, "\u2019"),
    // Possessive variants: "Outcast's" vs "Outcasts'"
    ordirName.replace(/(\w)'s\b/g, "$1s'"),
    ordirName.replace(/(\w)s'\b/g, "$1's"),
    // Square brackets to parens: "David [Green]" → "David (Green)"
    ordirName.replace(/\[/g, "(").replace(/\]/g, ")"),
    // "James (half-brother of Jesus" -> "James (half-brother of Jesus)"
    ordirName.includes("(") && !ordirName.includes(")")
      ? ordirName + ")"
      : null,
    // "the Vindicated" vs "the Vindicator" — try common suffix swaps
    ordirName.replace(/ed$/, "or"),
    ordirName.replace(/or$/, "ed"),
  ].filter(Boolean) as string[];

  for (const variant of variants) {
    if (cardData.baseToFull.has(variant)) {
      return { ordirName, matchedName: variant, matchType: "normalized" };
    }
    const vLower = variant.toLowerCase();
    if (baseNamesLower.has(vLower)) {
      return {
        ordirName,
        matchedName: baseNamesLower.get(vLower)!,
        matchType: "normalized",
      };
    }
    const vNorm = normalizeForMatching(variant);
    if (baseNamesNormalized.has(vNorm)) {
      return {
        ordirName,
        matchedName: baseNamesNormalized.get(vNorm)!,
        matchType: "normalized",
      };
    }
  }

  return { ordirName, matchedName: null, matchType: "none" };
}

// --- Step 5: Sync to Supabase ---

async function syncToSupabase(
  groups: DuplicateGroup[],
  matchResults: Map<string, MatchResult>
) {
  if (DRY_RUN) {
    console.log("\n[DRY RUN] Would sync to Supabase. Skipping.");
    return;
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  console.log("\nSyncing to Supabase...");

  // Clear only ORDIR-sourced data (preserve manually-created groups)
  const { data: ordirGroups } = await supabase
    .from("duplicate_card_groups")
    .select("id")
    .eq("source", "ordir");

  if (ordirGroups && ordirGroups.length > 0) {
    const ordirGroupIds = ordirGroups.map((g) => g.id);
    await supabase.from("duplicate_card_group_members").delete().in("group_id", ordirGroupIds);
    await supabase.from("duplicate_card_groups").delete().in("id", ordirGroupIds);
    console.log(`  Cleared ${ordirGroupIds.length} existing ORDIR groups`);
  }

  let groupCount = 0;
  let memberCount = 0;

  for (const group of groups) {
    // Insert group
    const { data: groupData, error: groupError } = await supabase
      .from("duplicate_card_groups")
      .insert({ canonical_name: group.canonicalName, source: "ordir" })
      .select("id")
      .single();

    let groupId: number;
    if (groupError?.code === "23505") {
      // A manually-created group already owns this canonical name (it holds the
      // same-name printings). Add the ORDIR members to it rather than dropping
      // them, or a differently-named printing ("Abel, the Accepted") is never
      // linked to the older "Abel" cards.
      const { data: existing, error: existingError } = await supabase
        .from("duplicate_card_groups")
        .select("id")
        .eq("canonical_name", group.canonicalName)
        .single();
      if (existingError) {
        console.error(
          `  Error reading existing group "${group.canonicalName}":`,
          existingError.message
        );
        continue;
      }
      groupId = existing.id;
      console.log(`  Merging into existing group "${group.canonicalName}"`);
    } else if (groupError) {
      console.error(
        `  Error inserting group "${group.canonicalName}":`,
        groupError.message
      );
      continue;
    } else {
      groupCount++;
      groupId = groupData.id;
    }

    // Insert members
    for (const member of group.members) {
      const match = matchResults.get(member.cardName);
      const cardName = match?.matchedName || member.cardName;
      const matched = match?.matchType !== "none";

      const { error: memberError } = await supabase
        .from("duplicate_card_group_members")
        .insert({
          group_id: groupId,
          card_name: cardName,
          ordir_sets: member.ordirSets,
          matched,
        });

      if (memberError) {
        // Might be a duplicate within the same group (e.g. Job's Three Friends appears 3 times)
        if (memberError.code === "23505") {
          // unique violation — skip
          continue;
        }
        console.error(
          `  Error inserting member "${cardName}" in group "${group.canonicalName}":`,
          memberError.message
        );
      } else {
        memberCount++;
      }
    }

    // Add any post-PDF printings registered for this group (see EXTRA_MEMBERS)
    const extras = EXTRA_MEMBERS[group.canonicalName];
    if (extras) {
      for (const cardName of extras) {
        const { error: extraError } = await supabase
          .from("duplicate_card_group_members")
          .insert({ group_id: groupId, card_name: cardName, ordir_sets: "", matched: true });

        if (extraError) {
          if (extraError.code === "23505") continue;
          console.error(
            `  Error inserting extra member "${cardName}" in group "${group.canonicalName}":`,
            extraError.message
          );
        } else {
          memberCount++;
          console.log(`  + Added extra member "${cardName}" to "${group.canonicalName}"`);
        }
      }
    }
  }

  console.log(`  Synced ${groupCount} groups with ${memberCount} members`);
}

// --- Main ---

async function main() {
  console.log(
    "=== Duplicate Card Group Sync ===" + (DRY_RUN ? " [DRY RUN]" : "")
  );
  console.log();

  // Step 1: Extract from PDF
  const rawSection = extractDuplicateSection();

  // Step 2: Parse groups
  const groups = parseDuplicateGroups(rawSection);
  console.log(`\nParsed ${groups.length} duplicate groups`);

  // Step 3: Fetch card names
  const cardData = await fetchCardNames();

  // Build lookup indices from base names
  const baseNamesLower = new Map<string, string>();
  const baseNamesNormalized = new Map<string, string>();
  for (const baseName of cardData.baseToFull.keys()) {
    baseNamesLower.set(baseName.toLowerCase(), baseName);
    baseNamesNormalized.set(normalizeForMatching(baseName), baseName);
  }

  // Step 4: Match
  console.log("\nMatching ORDIR names to carddata.txt...");
  const matchResults = new Map<string, MatchResult>();
  let exactCount = 0;
  let caseInsensitiveCount = 0;
  let normalizedCount = 0;
  let unmatchedCount = 0;
  const unmatched: string[] = [];

  for (const group of groups) {
    for (const member of group.members) {
      const result = matchCardName(
        member.cardName,
        cardData,
        baseNamesLower,
        baseNamesNormalized
      );
      matchResults.set(member.cardName, result);

      switch (result.matchType) {
        case "exact":
          exactCount++;
          break;
        case "case-insensitive":
          caseInsensitiveCount++;
          break;
        case "normalized":
          normalizedCount++;
          break;
        case "none":
          unmatchedCount++;
          unmatched.push(
            `  "${member.cardName}" (group: ${group.canonicalName})`
          );
          break;
      }
    }
  }

  // Report
  const totalMembers = Array.from(matchResults.values()).length;
  console.log(`\n--- Match Results ---`);
  console.log(`Total card names:       ${totalMembers}`);
  console.log(
    `Exact matches:          ${exactCount} (${((exactCount / totalMembers) * 100).toFixed(1)}%)`
  );
  console.log(
    `Case-insensitive:       ${caseInsensitiveCount} (${((caseInsensitiveCount / totalMembers) * 100).toFixed(1)}%)`
  );
  console.log(
    `Normalized:             ${normalizedCount} (${((normalizedCount / totalMembers) * 100).toFixed(1)}%)`
  );
  console.log(
    `Unmatched:              ${unmatchedCount} (${((unmatchedCount / totalMembers) * 100).toFixed(1)}%)`
  );

  if (unmatched.length > 0) {
    console.log(`\n--- Unmatched Names ---`);
    unmatched.forEach((u) => console.log(u));
  }

  // Show some example groups
  console.log(`\n--- Sample Groups ---`);
  const samples = groups.slice(0, 5);
  for (const g of samples) {
    const memberStrs = g.members.map((m) => {
      const match = matchResults.get(m.cardName);
      const status =
        match?.matchType === "none"
          ? "UNMATCHED"
          : match?.matchType === "exact"
            ? "exact"
            : match?.matchType || "";
      const displayName = match?.matchedName || m.cardName;
      return `    "${displayName}" [${status}]`;
    });
    console.log(`  ${g.canonicalName}:`);
    memberStrs.forEach((s) => console.log(s));
  }

  // Special: Temple group
  console.log(`\n--- Special Groups ---`);
  console.log(
    "  Note: Temples (Tabernacle, Solomon's Temple, Zerubbabel's Temple,"
  );
  console.log(
    "  Herod's Temple, Heavenly Temple) share a unique Fortress limit"
  );
  console.log("  but are handled separately in the ORDIR.");

  // Step 5: Sync
  await syncToSupabase(groups, matchResults);

  console.log("\nDone!");
}

main().catch(console.error);
