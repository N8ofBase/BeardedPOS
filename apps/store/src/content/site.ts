// Store wording: brand, games, team. Moved from the "bearded-square-preview" content.js so the copy
// written for the Square Online preview stays in one place. Edit words here, not in the sections.
// This is the original wording. Staff can change most of it from Behind the Beard (Site content);
// what they publish is layered on top by content/SiteProvider.tsx, so read it there with useSite().
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
import posterLearnMineAndFind from "../assets/video-learn-mine-and-find.webp";
import posterLearnSoccerBlocker from "../assets/video-learn-soccer-blocker.webp";
import posterSoccerBlockerPrototype from "../assets/video-soccer-blocker-prototype.webp";

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
      picture: "/old-site/web/1776873479919-Fences-Box-Art.webp",
      alt: "Fences box art",
      url: "https://drive.google.com/uc?export=download&id=1FfvXH4uF-uC2kbcace0HziArKI-gc20B",
    },
    {
      label: "Locked Out",
      picture: "/old-site/web/1776873492340-lockedoutbox.webp",
      alt: "Locked Out box",
      url: "https://drive.google.com/uc?export=download&id=1jAimgA9tk2Wi6RDCoVidAmq-RXwSobu5",
    },
    {
      label: "Mine & Find",
      picture: "/old-site/web/1776876544035-MFLogo.webp",
      alt: "Mine & Find logo",
      url: "https://drive.google.com/uc?export=download&id=1DWE10g_flxQtQqZCUMcd1wAf0Ahh_E7K",
    },
    {
      label: "Soccer Blocker",
      picture: "/old-site/web/1776876553762-SBBoxLogo.webp",
      alt: "Soccer Blocker box",
      url: "https://drive.google.com/uc?export=download&id=1KBapTt5Wh4aRkpt-V9quUUgsU2C9gK6q",
    },
  ],
  /** Memberships shown in the footer of every page, as on the old site. */
  memberships: {
    gama: { label: "GAMA member", src: "/old-site/web/731dc39c-863d-gama_member_icon.webp" },
    // The logo was cut from N8's screenshot of the old footer (Nov 19); swap in a sharper file when there is one.
    iga: {
      label: "Indie Game Alliance",
      src: "/old-site/web/iga-logo.webp",
      href: "https://www.indiegamealliance.com/",
    },
  },
};

export type GameStatus = "available" | "preorder" | "coming-soon";

/** A picture from the old Squarespace site: a web-size copy, and the original to open full size. */
export interface Picture {
  src: string;
  full: string;
  alt: string;
  caption?: string;
}

/** `file` is in public/old-site; its web-size copy (tools: see public/old-site/web) is the same name as .webp. */
const old = (file: string, alt: string, caption?: string): Picture => ({
  src: `/old-site/web/${file.replace(/\.[^.]+$/, "")}.webp`,
  full: `/old-site/${file}`,
  alt,
  caption,
});

export interface PressQuote {
  quote: string;
  who: string;
  href: string;
}

export interface Download {
  label: string;
  href: string;
  /** Like "PDF, 5 MB". */
  size: string;
}

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
  /** A short silent clip that loops on the game's page, from public/videos. */
  clip?: { src: string; poster: string; caption: string };
  /** A how-to-play video, shown under "Learn to play" on the game's page. */
  tutorial?: Video;
  /** Photos under "How it plays". */
  gallery?: Picture[];
  /** "What reviewers say" on the game's page, with more reviews to read. */
  press?: { quotes: PressQuote[]; more: { label: string; href: string }[] };
  /** Free files on the game's page, besides the rules. */
  downloads?: Download[];
  /** `rules` is a PDF (opens in a new tab) or a page here, like /soccerblocker. */
  links: { rules?: string; rulesLabel?: string; bgg?: string };
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
    gallery: [
      old("1605540054950-Fences.jpg", "Fences on the table", "Photo by Daniel Blackbourne"),
      old("1605475747795-gameplay.jpg", "A finished 4-player farm", "A 4-player finished game"),
      old("1605475808037-steep.jpg", "Painted wooden animals and farmers", "Painted wooden components"),
      old("1605476059942-zoom.jpg", "Close-up of the tile art", "High-quality artwork"),
      old(
        "1605476170914-IMG_2117.png",
        "Fences and The Ranch boxes with all the pieces",
        "Fences and The Ranch",
      ),
    ],
    press: {
      quotes: [
        {
          quote: "The Farmer Profile is where it’s at.",
          who: "Father Geek",
          href: "https://fathergeek.com/fences/",
        },
        {
          quote: "The most common thing heard after finishing a game of Fences: “Can we play again?”",
          who: "Dastardly Design",
          href: "https://www.dastardlydesignco.com/post/fences-a-dastardly-review",
        },
        {
          quote: "…a nice title for beginners and easily digested by the little ones…",
          who: "Sandro Sacchini",
          href: "https://www.instagram.com/p/BpeES4tB94C/",
        },
        {
          quote:
            "Huge amount of replayability due to mixing Farmer Powers from Fences and the 9 expansions in The Ranch.",
          who: "Dastardly Design, on The Ranch",
          href: "https://www.dastardlydesignco.com/post/the-ranch-dastardly-review-136",
        },
        {
          quote:
            "The expansions do provide the next level of depth you would want to experience after you are familiar…",
          who: "Father Geek, on The Ranch",
          href: "https://fathergeek.com/fences-the-ranch_prepub/",
        },
      ],
      more: [
        { label: "The Pawn’s Perspective", href: "https://pawnsperspective.com/fences-preview/" },
        {
          label: "Meeple Mountain",
          href: "https://www.meeplemountain.com/reviews/fences-review-good-fences-make-good-neighbors/",
        },
        { label: "BoardGameGeek", href: "https://boardgamegeek.com/boardgame/246409/fences" },
      ],
    },
    downloads: [
      { label: "The Ranch rules", href: "/old-site/Tha-Ranch-Rules.pdf", size: "PDF, 0.9 MB" },
      { label: "Black-and-white print and play", href: "/old-site/pnp_bw_fences.pdf", size: "PDF, 5 MB" },
      { label: "Farmer cards", href: "/old-site/Farmer-Cards.pdf", size: "PDF, 20 KB" },
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
    gallery: [
      old("bf196b96-523c-sticker-0.20a-tin-top.jpg", "The Locked Out tin lid", "The tin"),
      old("1694814101493-card-A-programmable-keycard.png", "Programmable keycard card"),
      old("1694814101493-card-E-fuel.png", "Fuel card"),
      old("1694814339677-card-E-oxygen.png", "Oxygen card"),
      old("1694814102409-card-H-memory-module.png", "Memory module card"),
      old("1694814102573-card-M-plasma-gun.png", "Plasma gun card"),
      old("1694814103445-card-M-share-of-the-booty-3.png", "Share of the booty card"),
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
    facts: ["2 players", "15–30 min", "Ages 12+"],
    badge: "New",
    story: [
      "Each player has four offense cards (Pass, Strike, Fake, Break) and four defense cards (Block, Steal, Tackle, Wait). Pick one face down, flip together, and resolve the clash with d10 rolls that move the ball across five zones. Even when you pick the right card, your dice roll may betray you.",
      "Possession shifts constantly, building toward goalie showdowns: back-to-back d20 rolls where a player must win twice in a row to score or save. Crowd cards drawn at the start of each possession add bonuses to your rolls.",
      "It’s easy to teach, quick to play, and has the kind of bluff-and-counter depth that keeps players coming back for “one more round.”",
    ],
    clip: {
      src: "/videos/soccer-blocker-prototype.mp4",
      poster: posterSoccerBlockerPrototype,
      caption: "Our homemade prototype, out of the box.",
    },
    tutorial: {
      slug: "learn-soccer-blocker",
      title: "Learn Soccer Blocker",
      blurb: "A Lettuce Talk Games tutorial.",
      src: "/videos/learn-soccer-blocker.mp4",
      poster: posterLearnSoccerBlocker,
      seconds: 318,
    },
    links: {
      rules: "/soccerblocker",
      rulesLabel: "Rules sheet",
      bgg: "https://boardgamegeek.com/boardgame/466697/soccer-blocker",
    },
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
    tutorial: {
      slug: "learn-mine-and-find",
      title: "Learn Mine & Find",
      blurb: "A Lettuce Talk Games tutorial.",
      src: "/videos/learn-mine-and-find.mp4",
      poster: posterLearnMineAndFind,
      seconds: 142,
    },
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
    gallery: [
      "1774467681418-IMG_0901.JPG",
      "1774467664573-IMG_0905.JPG",
      "1774467664385-IMG_0907.JPG",
      "1774467669405-IMG_0918.JPG",
      "1774467669726-IMG_0935.JPG",
      "1774467672834-IMG_0936.JPG",
      "1774467673174-IMG_0937.JPG",
      "1774467676824-IMG_0939.JPG",
      "1774467677168-IMG_0940.JPG",
      "1774467680873-IMG_0941.JPG",
    ].map((f, i) => old(f, `Playing Pack Lash, photo ${i + 1}`)),
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

/**
 * The Bearded Bundle page (/bundle). The price, picture and pre-order button come from the
 * "Bearded Bundle" item in Square; each game's own words come from its entry in `games` above.
 */
export interface Bundle {
  name: string;
  tagline: string;
  blurb: string;
  /** Slugs from `games`, in the order the page shows them. */
  games: string[];
  /** When it ships, shown by the price. */
  when: string;
  /** How a pre-order works, one point per line. */
  howItWorks: string[];
  /** Small print under the games. */
  note: string;
}

export const bundle: Bundle = {
  name: "The Bearded Bundle",
  tagline: "Three new games in one bundle. Pre-order now and be first to the table.",
  blurb:
    "Our newest games, together for the 2026 holiday season: a soccer duel, a gem hunt for the whole family, and a head-to-head card brawl. Quick to teach, hard to put down, and perfect under a tree.",
  games: ["soccer-blocker", "mine-and-find", "pack-lash"],
  when: "Ships for the 2026 holidays (hopefully — we all have day jobs)",
  howItWorks: [
    "You pay when you pre-order, through Square’s secure checkout.",
    "We email you when the bundle is ready, then ship it or set it aside for free pickup in St. Louis.",
    "Beard Buddies earn Beard Bucks on a pre-order, and can use their Bucks on it too.",
    "Changed your mind before it ships? Email us and we’ll refund you in full.",
  ],
  note: "These are not the final versions of the games. Gameplay, artwork, components and rules may still change before they ship.",
};

export const statusLabel: Record<GameStatus, string> = {
  available: "Out now",
  preorder: "Pre-order",
  "coming-soon": "Coming soon",
};

export interface TeamMember {
  /** Stable id for site content (SITE_TEAM in @bearded/store-core). */
  id: string;
  name: string;
  role: string;
  beard: string;
  bio: string;
  art?: string;
  /** The full bio from the old site, on the person's own page (/beards/<id>). No story, no page. */
  story?: string[];
  /** Links on their own page. */
  links?: { label: string; href: string }[];
}

export const team: TeamMember[] = [
  {
    id: "adam",
    name: "Adam Collins",
    role: "Owner, designer and podcaster",
    art: teamAdam,
    beard: "Long-standing. Grayed steadily by two kids.",
    bio: "Lifelong gamer turned designer and reviewer. Co-hosts a podcast and YouTube channel with his son, Edward, which mostly means arguing about game mechanics on camera. Project manager by day.",
    story: [
      "Adam Collins, Chief Creative Officer. Adam has proudly sported a beard for years—its length and style evolving with time, though his son and daughter have played a key role in ensuring it turns steadily grey.",
      "A lifelong gamer, Adam’s love for tabletop and video games runs deep, fueling countless late-night sessions and friendly debates over mechanics, strategy, and storytelling. In recent years, he’s taken his passion to the next level, diving into game design and reviewing. Through his podcast and YouTube channel (co-hosted with The Son), he explores what makes games great, offering insights, critiques, and the occasional heated father-son discussion. Whether breaking down the latest releases or reminiscing about classics, Adam brings a mix of expertise, humor, and genuine enthusiasm to his content.",
      "Until his gaming empire takes off, Adam pays the bills as a Project Manager at a local university, where he applies his strategic thinking and problem-solving skills in a slightly different arena. When he’s not gaming, designing, or wrangling projects, you can probably find him enjoying a good book, indulging in nerdy pop culture, or engaging in a spirited debate over the superiority of various RPG systems.",
    ],
  },
  {
    id: "edward",
    name: "Edward",
    role: "Designer and tester",
    art: teamEdward,
    beard: "Hereditary. Pending.",
    bio: "Adam’s son and his co-host on their podcast and YouTube channel, so the debates about game mechanics never really end. Designs games, tests everyone else’s, and is, by the team’s own description, also a board game crazy person.",
  },
  {
    id: "tim",
    name: "Tim Forbis",
    role: "Engineer of fun",
    beard: "Only four years old. Still in its awkward phase.",
    bio: "Engineer for over a decade who discovered board game design and never looked back. Runs gaming simulations for fun. Wife and three daughters keep him outnumbered.",
  },
  {
    id: "n8",
    name: "Nate “N8” Sloan",
    role: "Designer, promoter and master musician",
    art: teamN8,
    beard: "Varies by tour schedule.",
    bio: "Debuted I Crit You Not! at Protospiel STL in 2023 and joined the beards soon after. Plays trumpet and drums in Fluer de Noise, the St. Louis CITY SC supporters band. Runs the farmers market demo table.",
    story: [
      "Nate (N8) met Adam and Edward at Protospiel STL in 2023 debuting his first game “I Crit You Not!” with his design company PRISMCORTEX. They became fast friends and have started developing many new games and entertaining people at the local farmer’s markets.",
      "He plays many instruments, including trumpet and drums for the St. Louis City Soccer Team supporters band: Fluer de Noise!",
    ],
    links: [{ label: "Hear N8’s board game songs", href: "/videos" }],
  },
];

/** The Soccer Blocker rules sheet, at its old address /soccerblocker (a QR code on the box may point there). */
export const soccerBlockerRules: Picture[] = [
  old("1789706068856-RulesFront2.png", "Soccer Blocker rules, front of the sheet", "Front"),
  old("1789706068852-RulesBack2.png", "Soccer Blocker rules, back of the sheet", "Back"),
];

/** Wording on the home page and wholesale page that isn't about one game or person. */
export const pageText = {
  heroLede:
    "We make quick, fun games that are easy to teach and hard to put down. Made by people who play WAY too many games. Your next game night starts here.",
  shelfLede:
    "Bearded classics, a couple of Prism Cortex collaborations, and some things still cooling off the printer.",
  teamHeading: "Meet the beards.",
  playHeading: "Come play with us.",
  playText:
    "Find us demoing at St. Louis farmers markets, Protospiel and game stores around town. Follow along for event dates and playtest calls.",
  sellHeading: "Sell our games in your store",
  sellText: "Email us and we’ll reply within 1–3 business days with a wholesale order form.",
};

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
