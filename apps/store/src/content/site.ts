// Store wording: brand, games, team. Moved from the "bearded-square-preview" content.js so the copy
// written for the Square Online preview stays in one place. Edit words here, not in the sections.
import coverFences from "../assets/cover-fences.webp";
import coverLockedOut from "../assets/cover-locked-out.webp";
import coverMineAndFind from "../assets/cover-mine-and-find.webp";
import coverPackLash from "../assets/cover-pack-lash.webp";
import coverSoccerBlocker from "../assets/cover-soccer-blocker.webp";
import teamAdam from "../assets/team-adam.webp";
import teamEdward from "../assets/team-edward.webp";
import teamN8 from "../assets/team-n8.webp";

const SQ = "https://images.squarespace-cdn.com/content/v1/5a4d3057f6576ef69d4c551d";

export const brand = {
  name: "Bearded Board Games",
  city: "St. Louis, MO",
  motto: "Board games build bridges.",
  retailEmail: "adam@beardedboardgames.com",
  socials: {
    tiktok: "https://www.tiktok.com/@beardedboardgamesstl",
    instagram: "https://www.instagram.com/beardedboardgames/",
    facebook: "https://www.facebook.com/BeardedBoardGames/",
    linkedin: "https://www.linkedin.com/company/28644556/",
  },
  sellSheets: [
    {
      label: "All sell sheets",
      url: "https://drive.google.com/uc?export=download&id=1a_upWFmpcKtbBF-aEk8H21BUqQTi_PQE",
    },
    {
      label: "Fences",
      url: "https://drive.google.com/uc?export=download&id=1FfvXH4uF-uC2kbcace0HziArKI-gc20B",
    },
    {
      label: "Locked Out",
      url: "https://drive.google.com/uc?export=download&id=1jAimgA9tk2Wi6RDCoVidAmq-RXwSobu5",
    },
    {
      label: "Mine & Find",
      url: "https://drive.google.com/uc?export=download&id=1DWE10g_flxQtQqZCUMcd1wAf0Ahh_E7K",
    },
    {
      label: "Soccer Blocker",
      url: "https://drive.google.com/uc?export=download&id=1KBapTt5Wh4aRkpt-V9quUUgsU2C9gK6q",
    },
  ],
  vipThanks: "You’re in. Use code BEARDED10 for 10% off.",
};

export type GameStatus = "available" | "preorder" | "coming-soon";
export type ProductKind = "game" | "expansion" | "preorder" | "digital" | "merch";

/** A Square item that belongs in the store. `square` is the item's name in Square, which is how we match it. */
export interface StoreItem {
  square: string;
  kind: ProductKind;
  /** Shown instead of the Square name, when the Square name reads badly on a shelf. */
  name?: string;
}

export interface Game {
  slug: string;
  name: string;
  labels: string[];
  status: GameStatus;
  tagline: string;
  blurb: string;
  color: string;
  /** Box art: a local brochure crop when we have one, else the image on the old Squarespace site. */
  art: string;
  facts: string[];
  badge?: string;
  designer?: string;
  links: { rules?: string; bgg?: string };
  items: StoreItem[];
}

// The order here is the order on the shelf. I Crit You Not! and D20 On The Money are left out,
// as in the preview; they are still in the preview folder's content.js.
export const games: Game[] = [
  {
    slug: "fences",
    name: "Fences",
    labels: ["Bearded Board Games"],
    status: "available",
    tagline: "A tile-laying game about farmers who are extremely territorial about sheep.",
    blurb:
      "Lay tiles to grow your farm and herd animals into it. Every tile you place also grows your neighbor’s farm, so placement gets spicy fast. A unique Farmer Profile changes how you score, so no two games play alike.",
    color: "#7BAE4E",
    art: coverFences,
    facts: ["2–6 players", "40–60 min", "Ages 8+"],
    badge: "Best seller",
    links: {
      rules: "https://beardedboardgames.com/s/Fences-Instructions.pdf",
      bgg: "https://boardgamegeek.com/boardgame/246409/fences",
    },
    items: [
      { square: "Fences", kind: "game" },
      { square: "Fences 5–6 Player Expansion", kind: "expansion" },
      { square: "Fences: The Ranch", kind: "expansion" },
      { square: "Fences: Seasons", kind: "expansion" },
      { square: "Fences Premium Print & Play", kind: "digital" },
    ],
  },
  {
    slug: "locked-out",
    name: "Locked Out",
    labels: ["Bearded Board Games"],
    status: "available",
    tagline: "A co-petitive game of trust and betrayal. Mostly betrayal.",
    blurb:
      "Your crew robbed a bank and stole a spaceship, but you’ve been locked out of the controls. Search the rooms for the pieces that unlock the ship’s computer before the authorities arrive. If the crew escapes, the highest score wins. If you’re caught, the lowest score wins.",
    color: "#3B5BA9",
    art: coverLockedOut,
    facts: ["3–6 players", "30–45 min", "Ages 12+"],
    badge: "Hidden gem",
    designer: "René Uittenbogaard",
    links: {},
    items: [{ square: "Locked Out", kind: "game" }],
  },
  {
    slug: "soccer-blocker",
    name: "Soccer Blocker",
    labels: ["Bearded Board Games", "Prism Cortex"],
    status: "preorder",
    tagline: "A 1-v-1 soccer duel. First to three goals or three saves. No flopping.",
    blurb:
      "A head-to-head, card-flipping, dice-rolling game with all the tension of a soccer match in about 20 minutes. Easy to teach, quick to play, and full of bluff-and-counter moments that keep you coming back for one more round. Inspired by St. Louis CITY SC.",
    color: "#C8102E",
    art: coverSoccerBlocker,
    facts: ["2 players", "15–30 min", "Ages 12+"],
    badge: "New",
    links: { bgg: "https://boardgamegeek.com/boardgame/466697/soccer-blocker" },
    items: [
      {
        square: "Soccer Blocker Version Zero Limited Edition",
        kind: "game",
        name: "Soccer Blocker Version Zero (Limited)",
      },
    ],
  },
  {
    slug: "mine-and-find",
    name: "Mine & Find",
    labels: ["Bearded Board Games", "Prism Cortex"],
    status: "preorder",
    tagline: "Dig for gems. Ride the mine carts. Yell “mine!” a lot.",
    blurb:
      "A quick, easy card game for all ages. Move your miner around the mine, revealing cards to find the most treasure. The last round starts when a miner finds both their helmet and their mine cart. Built for 4 players, with modes for 2 and solo play.",
    color: "#8E5BC2",
    art: coverMineAndFind,
    facts: ["1–4 players", "20–30 min", "Ages 8+"],
    badge: "New",
    links: { bgg: "https://boardgamegeek.com/boardgame/468088/mine-and-find" },
    items: [{ square: "Mine Find", kind: "preorder", name: "Mine & Find (Pre-order)" }],
  },
  {
    slug: "pack-lash",
    name: "Pack Lash",
    labels: ["Bearded Board Games"],
    status: "coming-soon",
    tagline: "Head-to-head, asymmetric, and a little bit feral. Every deck wins a different way.",
    blurb:
      "A fast card duel where each player chases a different win condition while stopping the other from reaching theirs. Designed by Craig Hughes, art by Hailey Fetting.",
    color: "#2E9C8F",
    art: coverPackLash,
    facts: ["2 players", "5–15 min", "Ages 10+"],
    badge: "New",
    links: { bgg: "https://boardgamegeek.com/boardgame/407307/pack-lash" },
    items: [{ square: "Pack Lash VIP Reservation", kind: "preorder" }],
  },
  {
    slug: "fences-roll-and-write",
    name: "Fences: The Roll & Write",
    labels: ["Bearded Board Games"],
    status: "coming-soon",
    tagline: "All the farm drama, none of the tiles to lose under the couch.",
    blurb:
      "Roll, draft a die, mark your sheet. Plan your farm by grouping results just right. Designed by Darren Reckner and Jason Hager of Durdle Games.",
    color: "#B5832F",
    art: `${SQ}/438619b3-3536-4a20-8824-702e8097c809/Rolling+Acres+Mock+Up+Web_2.jpg`,
    facts: ["Coming 2027"],
    links: {},
    items: [],
  },
];

/** Square items sold in the store that don't belong to one game. Anything not listed here or on a game stays off the site. */
export const extraItems: StoreItem[] = [
  { square: "Jibe Card Game", kind: "game" },
  { square: "Future Board Gamer Onesie", kind: "merch" },
  { square: "Board Gamer in Training Kids Tee", kind: "merch" },
];

export const statusLabel: Record<GameStatus, string> = {
  available: "Out now",
  preorder: "Pre-order",
  "coming-soon": "Coming soon",
};

export interface TeamMember {
  name: string;
  role: string;
  beard: string;
  bio: string;
  art?: string;
}

export const team: TeamMember[] = [
  {
    name: "Adam Collins",
    role: "Owner, designer and podcaster",
    art: teamAdam,
    beard: "Long-standing. Grayed steadily by two kids.",
    bio: "Lifelong gamer turned designer and reviewer. Co-hosts a podcast and YouTube channel with his son, Edward, which mostly means arguing about game mechanics on camera. Project manager by day.",
  },
  {
    name: "Edward",
    role: "Designer and tester",
    art: teamEdward,
    beard: "Hereditary. Pending.",
    bio: "Adam’s son and his co-host on their podcast and YouTube channel, so the debates about game mechanics never really end. Designs games, tests everyone else’s, and is, by the team’s own description, also a board game crazy person.",
  },
  {
    name: "Tim Forbis",
    role: "Engineer of fun",
    beard: "Only four years old. Still in its awkward phase.",
    bio: "Engineer for over a decade who discovered board game design and never looked back. Runs gaming simulations for fun. Wife and three daughters keep him outnumbered.",
  },
  {
    name: "Nate “N8” Sloan",
    role: "Designer, promoter and master musician",
    art: teamN8,
    beard: "Varies by tour schedule.",
    bio: "Debuted I Crit You Not! at Protospiel STL in 2023 and joined the beards soon after. Plays trumpet and drums in Fluer de Noise, the St. Louis CITY SC supporters band. Runs the farmers market demo table.",
  },
];

export const about =
  "We are firm in our belief that board games build bridges, so we publish games that are quick, fun and easy for everyone to enjoy. Help the board game community grow by supporting us and other independent designers, publishers and retailers.";

/** "Only N left" shows at or below this count. */
export const lowStockAt = 5;
