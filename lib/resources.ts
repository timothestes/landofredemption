import type { IconType } from "react-icons";
import { FaBookOpen } from "react-icons/fa6";
import { PiPencilLineBold } from "react-icons/pi";
import { TbCardsFilled, TbFileTypePdf, TbListNumbers } from "react-icons/tb";

// Single source of truth for the documents surfaced in the nav "Resources"
// dropdown and on the /resources page. Update a link here and both change.
// The dropdown shows `label` only; `description` and `version` are for the page.

export type ResourceLink = {
  href: string;
  label: string;
  description: string;
  /** Version/edition the publisher stamps on the document, when there is one. */
  version?: string;
  /** Publish date printed on the document's title page, when it prints one. */
  published?: string;
  /** Internal routes render as next/link; everything else opens in a new tab. */
  internal?: boolean;
  icon?: IconType;
};

export type ResourceSection = {
  id: string;
  title: string;
  description: string;
  links: ResourceLink[];
};

// Official documents that used to be served from landofredemption.com. They are mirrored to
// Vercel Blob under the same pathname the WordPress import used for article media
// (`wp/wp-content/uploads/...`), so an article link and a tracker link to the same file
// resolve to one object. Mirror a new file with `scripts/mirror-lor-files.ts`.
const LOR_UPLOADS =
  "https://qrpnuz0u6exnvyt8.public.blob.vercel-storage.com/wp/wp-content/uploads";

export const DOCS = {
  reg: `${LOR_UPLOADS}/2026/03/REG_PDF_11.0.0.pdf`,
  ordir: `${LOR_UPLOADS}/2026/03/ORDIR_PDF_7.0.0.pdf`,
  deckBuildingRules: `${LOR_UPLOADS}/2026/08/Deck_Building_Rules_2.0.pdf`,
  paragonRules: `${LOR_UPLOADS}/2026/07/Redemption-Paragon-Format-Rules.pdf`,
  paragonCards: `${LOR_UPLOADS}/2025/11/Paragon-Format-Paragons-v1.pdf`,
  paragonLostSoulsColor: `${LOR_UPLOADS}/2025/11/Paragon-Format-Lost-Souls-Color-v1.pdf`,
  paragonLostSoulsBw: `${LOR_UPLOADS}/2025/11/Paragon-Format-Lost-Souls-BW-v1.pdf`,
  t1DeckCheck: `${LOR_UPLOADS}/2026/07/t1_deck_check_v2.pdf`,
  t1Reserve: `${LOR_UPLOADS}/2025/03/Reserve-List-T1.pdf`,
  t2DeckCheck: `${LOR_UPLOADS}/2026/07/t2_deck_check_v2.pdf`,
  t2Reserve: `${LOR_UPLOADS}/2026/07/T2-Reserve-list.pdf`,
} as const;

export const RESOURCE_SECTIONS: ResourceSection[] = [
  {
    id: "tools",
    title: "Deck Tools",
    description: "Turn a deck or a pile of cards into something you can print or share.",
    links: [
      {
        href: "/decklist/card-search/tier-list",
        label: "Tier List Maker",
        description:
          "Rank any cards into tiers and export the board as a shareable image.",
        internal: true,
        icon: TbListNumbers,
      },
      {
        href: "/decklist/generate",
        label: "Deck Check PDF",
        description:
          "Turn a saved deck into a printable deck check sheet for a tournament.",
        internal: true,
        icon: TbFileTypePdf,
      },
    ],
  },
  {
    id: "rules",
    title: "Tournament Resources",
    description: "The rules of the game and how decks are built.",
    links: [
      {
        href: DOCS.reg,
        label: "REG (Official Rulebook)",
        description:
          "The Redemption Exegesis Guide — special ability structure, timing, and how the rules of the game actually resolve.",
        version: "v11.0.0",
        published: "March 13, 2026",
        icon: PiPencilLineBold,
      },
      {
        href: DOCS.ordir,
        label: "ORDIR (Dictionary)",
        description:
          "The Official Redemption Dictionary of Identifiers and References — set abbreviations, errata, and the glossary of terms.",
        version: "v7.0.0",
        published: "March 13, 2026",
        icon: FaBookOpen,
      },
      {
        href: DOCS.deckBuildingRules,
        label: "Deck Building Rules",
        description:
          "Deck construction and format-specific rules — deck size, Lost Soul counts, reserve, and card limits.",
        version: "v2.0.0",
        published: "August 13, 2026",
        icon: TbCardsFilled,
      },
      {
        href: "/rulings",
        label: "Card Rulings",
        description:
          "Searchable archive of official card rulings, kept in sync with the rules discussion on Discord.",
        internal: true,
        icon: FaBookOpen,
      },
    ],
  },
  {
    id: "paragon",
    title: "Paragon Resources",
    description: "Everything needed to play the Paragon format.",
    links: [
      {
        href: DOCS.paragonRules,
        label: "Paragon Rules",
        description: "The official rules for the Paragon format.",
      },
      {
        href: DOCS.paragonCards,
        label: "Paragon Cards",
        description: "Printable sheet of the Paragon cards themselves.",
        version: "v1",
      },
      {
        href: DOCS.paragonLostSoulsColor,
        label: "Lost Souls (Color)",
        description: "Printable Paragon Lost Souls, full color.",
        version: "v1",
      },
      {
        href: DOCS.paragonLostSoulsBw,
        label: "Lost Souls (B&W)",
        description: "Printable Paragon Lost Souls, black & white for cheaper printing.",
        version: "v1",
      },
    ],
  },
  {
    id: "hosting",
    title: "Host Resources",
    description:
      "Applications, guides and printable forms for running a sanctioned tournament.",
    links: [
      {
        href: "https://www.cactusgamedesign.com/wp-content/uploads/2026/08/Redemption_Host_Guide_2026-1.pdf",
        label: "Hosting Guide",
        description: "How to run a sanctioned Redemption tournament, start to finish.",
        version: "v26.0.0",
        published: "August 13, 2026",
      },
      {
        href: "https://www.cactusgamedesign.com/wp-content/uploads/2026/08/host_instructions.pdf",
        label: "Host Instructions",
        description: "Quick-reference instructions that ship with the host kit.",
      },
      {
        href: "https://www.cactusgamedesign.com/wp-content/uploads/2026/08/Redemption-Tournament-Host-Application-2027_With_Prize_Pack_Support.pdf",
        label: "Hosting Application (with Prize Packs)",
        description: "Apply to host an event with prize pack support.",
        version: "2027",
      },
      {
        href: "https://www.cactusgamedesign.com/wp-content/uploads/2026/08/Redemption-Tournament-Host-Application-2027_WITHOUT_Prize_Pack_Support.pdf",
        label: "Hosting Application (Promos Only)",
        description: "Apply to host at the lower fee, with promos instead of prize packs.",
        version: "2027",
      },
      {
        href: "https://www.cactusgamedesign.com/wp-content/uploads/2026/08/host_sign_in_sheets-1.pdf",
        label: "Sign In Sheet",
        description: "Printable sheet for signing players in at the door.",
      },
      {
        href: DOCS.t1DeckCheck,
        label: "T1 Deck Check Sheet",
        description: "Printable deck check sheet for Type 1 decks.",
        version: "v2",
      },
      {
        href: DOCS.t1Reserve,
        label: "T1 Reserve List",
        description: "Printable reserve list for Type 1 decks.",
      },
      {
        href: DOCS.t2DeckCheck,
        label: "T2 Deck Check Sheet",
        description: "Printable deck check sheet for Type 2 decks.",
        version: "v2",
      },
      {
        href: DOCS.t2Reserve,
        label: "T2 Reserve List",
        description: "Printable reserve list for Type 2 decks.",
      },
      {
        href: "https://www.cactusgamedesign.com/wp-content/uploads/2026/08/host_winners_list-2.pdf",
        label: "Winners Form",
        description: "Report the winners of a completed event back to Cactus Game Design.",
      },
    ],
  },
];

/** Site tools worth pointing a first-time visitor at, shown at the foot of /resources. */
export const RESOURCE_APP_TOOLS: { href: string; label: string; description: string }[] = [
  {
    href: "/decklist/card-search?new=true",
    label: "Deck Builder",
    description: "Search every card and build a legal deck.",
  },
  {
    href: "/decklist/community",
    label: "Community Decks",
    description: "Browse decks shared by other players.",
  },
  {
    href: "/tournaments",
    label: "Upcoming Events",
    description: "Find a sanctioned tournament near you.",
  },
  {
    href: "/tournaments/results",
    label: "Tournament Results",
    description: "Standings and decklists from completed events.",
  },
];
