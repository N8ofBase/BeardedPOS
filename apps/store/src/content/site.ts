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
import posterBeardedBoardGames from "../assets/video-bearded-board-games.webp";
import posterEverybodyLoves from "../assets/video-everybody-loves-some-board-games.webp";
import posterMyGames from "../assets/video-my-games.webp";

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

export interface Game {
  slug: string;
  name: string;
  labels: string[];
  status: GameStatus;
  tagline: string;
  blurb: string;
  color: string;
  /** Box art: the official cover art when we have it, else the image on the old Squarespace site. */
  art: string;
  facts: string[];
  badge?: string;
  designer?: string;
  artist?: string;
  /** Shown instead of the status label, e.g. "Coming 2027". */
  when?: string;
  /** More about the game, under the blurb on its page. */
  story?: string[];
  links: { rules?: string; bgg?: string };
}

export const statusText = (g: Game) => g.when ?? statusLabel[g.status];

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
      "Farmers compete to build fields for their animals. Each tile you lay expands your farm, but also your neighbor’s, so play strategically. Every player has a unique Farmer Profile that changes how they score points, so every game is very different.",
    color: "#7BAE4E",
    art: coverFences,
    facts: ["2–6 players", "40–60 min", "Ages 8+"],
    badge: "Best seller",
    story: [
      "Fences was funded on Kickstarter in January 2019. Every Farmer Profile card in the game is a real backer from the campaign who pledged at that level.",
    ],
    links: {
      rules: "/old-site/Fences-Instructions.pdf",
      bgg: "https://boardgamegeek.com/boardgame/246409/fences",
    },
  },
  {
    slug: "locked-out",
    name: "Locked Out",
    labels: ["Bearded Board Games"],
    status: "available",
    tagline: "A co-petitive game of trust and betrayal. Mostly betrayal.",
    blurb:
      "It is the year 2368. You and your gang stole a spacecraft to get your latest score of loot back to the hideout, but the on-board computer caught the tampering and locked you out. Regain control of the ship before the fuel and oxygen run out. Your gang wins together, but you also want the biggest cut, and if the gang fails to escape, the player who pocketed the least wins.",
    color: "#3B5BA9",
    art: coverLockedOut,
    facts: ["3–6 players", "30–45 min", "Ages 12+"],
    badge: "Hidden gem",
    designer: "René Uittenbogaard",
    story: [
      "Winner of The Game Crafter’s design competition, sponsored by Eat Lunch and Board Game and Bearded Board Games.",
      "Make your way through the ship gathering resources, tools and loot. Use the tools to open new areas and get closer to the control room. Search the rooms for more items, share some with your gang, and accuse your teammates of hoarding all the good stuff.",
    ],
    links: {},
  },
  {
    slug: "soccer-blocker",
    name: "Soccer Blocker",
    labels: ["Bearded Board Games", "Prism Cortex"],
    status: "coming-soon",
    tagline: "A 1-v-1 soccer duel. First to three goals or three saves wins. No flopping.",
    blurb:
      "A 2-player tactical card game that delivers the tension of a soccer match in about 20 minutes. Each round, both players secretly pick an action card at the same time, then roll to see who wins the clash and where the ball goes on a 10-space field. The first to 3 goals or 3 saves takes the match. Inspired by St. Louis CITY SC.",
    color: "#C8102E",
    art: coverSoccerBlocker,
    facts: ["2 players", "About 20 min", "Ages 12+"],
    badge: "New",
    story: [
      "Each player has four offense cards (Pass, Strike, Fake, Break) and four defense cards (Block, Steal, Tackle, Wait). Pick one face down, flip together, and resolve the clash with d10 rolls that move the ball across five zones. Even when you pick the right card, your dice roll may betray you.",
      "Possession shifts constantly, building toward goalie showdowns: back-to-back d20 rolls where a player must win twice in a row to score or save. Crowd cards drawn at the start of each possession add bonuses to your rolls.",
      "It’s easy to teach, quick to play, and has the kind of bluff-and-counter depth that keeps players coming back for “one more round.”",
    ],
    links: { bgg: "https://boardgamegeek.com/boardgame/466697/soccer-blocker" },
  },
  {
    slug: "mine-and-find",
    name: "Mine & Find",
    labels: ["Bearded Board Games", "Prism Cortex"],
    status: "preorder",
    tagline: "Dig for gems. Ride the mine carts. Yell “mine!” a lot.",
    blurb:
      "A quick and easy card game for all ages, the game where you mine and find! Each Miner searches the mine for treasure in their own color and shape. Flip the face-down cards in the mine, pick up a Lamp and a Cart to move faster, and the player with the most treasure wins.",
    color: "#8E5BC2",
    art: coverMineAndFind,
    facts: ["1–4 players", "20–30 min", "Ages 8+"],
    badge: "New",
    story: [
      "Miners start in the four corners with the treasure chests down the middle. On your turn, move one space (never diagonally) and flip the card there. If it matches your Miner, it goes under your treasure chest. Land on another Miner and you bump them back to their starting corner.",
      "Find your Miner’s Lamp and you can move diagonally. Find your Cart and you can roll any distance in a straight line. Collect both for 3 bonus points, and everyone else gets one last move.",
      "Play with 4 players, team up 2 against 2, or try Solo Mode and collect every treasure before a Lamp and Cart set turns up. Advanced Mode flips cards back face down, so you have to remember where everything is.",
    ],
    links: { bgg: "https://boardgamegeek.com/boardgame/468088/mine-and-find" },
  },
  {
    slug: "pack-lash",
    name: "Pack Lash",
    labels: ["Bearded Board Games"],
    status: "coming-soon",
    tagline: "Head-to-head, asymmetric, and a little bit feral. Every deck wins a different way.",
    blurb:
      "A fast-paced, head-to-head, asymmetric card game where each player has a different way to win. Chase your own victory condition while stopping your opponent from reaching theirs.",
    color: "#2E9C8F",
    art: coverPackLash,
    facts: ["2 players", "5–15 min", "Ages 10+"],
    badge: "New",
    designer: "Craig Hughes",
    artist: "Hailey Fetting",
    links: { bgg: "https://boardgamegeek.com/boardgame/407307/pack-lash" },
  },
  {
    slug: "fences-roll-and-write",
    name: "Fences: The Roll & Write",
    labels: ["Bearded Board Games"],
    status: "coming-soon",
    tagline: "All the farm drama, none of the tiles to lose under the couch.",
    blurb:
      "A new game in the Fences universe. Roll the dice, draft one and mark your sheet. Plan your farm by grouping the results in just the right ways.",
    color: "#B5832F",
    art: "/old-site/438619b3-3536-Rolling-Acres-Mock-Up-Web_2.jpg",
    facts: ["Coming 2027"],
    when: "Coming 2027",
    designer: "Darren Reckner and Jason Hager of Durdle Games",
    links: {},
  },
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

export interface Video {
  slug: string;
  title: string;
  blurb: string;
  /** In public/videos, so it streams as it plays instead of being bundled. */
  src: string;
  poster: string;
  seconds: number;
}

/** N8's board game parody songs, the shop's commercials. Upright phone videos, 720×1280. */
export const videos: Video[] = [
  {
    slug: "bearded-board-games",
    title: "Beer-ded Board Games",
    blurb: "A parody of “Beer” by Reel Big Fish.",
    src: "/videos/bearded-board-games.mp4",
    poster: posterBeardedBoardGames,
    seconds: 156,
  },
  {
    slug: "everybody-loves-some-board-games",
    title: "Everybody Loves Some Board Games",
    blurb: "A parody of “Everybody Loves Somebody” by Dean Martin.",
    src: "/videos/everybody-loves-some-board-games.mp4",
    poster: posterEverybodyLoves,
    seconds: 121,
  },
  {
    slug: "my-games",
    title: "My Games",
    blurb: "A parody of “My Girl” by The Temptations.",
    src: "/videos/my-games.mp4",
    poster: posterMyGames,
    seconds: 64,
  },
];
