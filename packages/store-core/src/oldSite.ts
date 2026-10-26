// Everything on the old Squarespace site (beardedboardgames.com), copied on 2026-10-26 so the team
// can decide what to keep before the domain moves to this store. Text is as it was on the old site,
// typos included. Its images and PDFs were downloaded on 2026-10-26 and are served from the store's
// public/old-site folder, so they keep working after Squarespace is cancelled.

const OLD = "/old-site";

export type OldSiteDecision = "keep" | "update" | "drop";
export const OLD_SITE_DECISIONS: OldSiteDecision[] = ["keep", "update", "drop"];

export interface OldSiteItem {
  id: string;
  title: string;
  text?: string;
  images?: { src: string; alt: string }[];
  links?: { label: string; href: string }[];
  /** Where it would go on the new site. */
  suggestion: string;
}

export interface OldSitePage {
  /** The page's path on the old site. */
  path: string;
  title: string;
  items: OldSiteItem[];
}

/** A staff member's call on one item. */
export interface OldSiteChoice {
  itemId: string;
  decision: OldSiteDecision;
  note: string;
  by: string;
  /** ISO time. */
  at: string;
}

export const NOTE_MAX = 1000;

const gallery = (paths: string[], alt: (i: number) => string) =>
  paths.map((p, i) => ({ src: `${OLD}/${p}`, alt: alt(i + 1) }));

export const oldSite: OldSitePage[] = [
  {
    path: "/",
    title: "Home",
    items: [
      {
        id: "home-pack-lash-gallery",
        title: "Pack Lash photo gallery",
        images: gallery(
          [
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
          ],
          (i) => `Pack Lash photo ${i}`,
        ),
        suggestion: "A photo gallery on the Pack Lash game page.",
      },
      {
        id: "footer-badges",
        title: "Member badges in the footer",
        text: "Every page ends with a GAMA member icon and an Indie Game Alliance logo that links to indiegamealliance.com.",
        images: [{ src: `${OLD}/731dc39c-863d-gama_member_icon.png`, alt: "GAMA member" }],
        links: [{ label: "Indie Game Alliance", href: "https://www.indiegamealliance.com/" }],
        suggestion: "The new site's footer.",
      },
    ],
  },
  {
    path: "/adam-collins",
    title: "Adam Collins",
    items: [
      {
        id: "adam-bio",
        title: "Adam’s full bio",
        text: "Adam Collins, Chief Creative Officer. Adam has proudly sported a beard for years—its length and style evolving with time, though his son and daughter have played a key role in ensuring it turns steadily grey. A lifelong gamer, Adam’s love for tabletop and video games runs deep, fueling countless late-night sessions and friendly debates over mechanics, strategy, and storytelling. In recent years, he’s taken his passion to the next level, diving into game design and reviewing. Through his podcast and YouTube channel (co-hosted with The Son), he explores what makes games great, offering insights, critiques, and the occasional heated father-son discussion. Whether breaking down the latest releases or reminiscing about classics, Adam brings a mix of expertise, humor, and genuine enthusiasm to his content. Until his gaming empire takes off, Adam pays the bills as a Project Manager at a local university, where he applies his strategic thinking and problem-solving skills in a slightly different arena. When he's not gaming, designing, or wrangling projects, you can probably find him enjoying a good book, indulging in nerdy pop culture, or engaging in a spirited debate over the superiority of various RPG systems.",
        suggestion: "“Meet the beards” has a short version. Could become Adam’s own page.",
      },
      {
        id: "adam-photo",
        title: "Adam’s photo",
        images: [{ src: `${OLD}/1625753652499-Adam---Shark-Hunt.PNG`, alt: "Adam - Shark Hunt" }],
        suggestion: "“Meet the beards” already has a photo of Adam. Use this one instead?",
      },
    ],
  },
  {
    path: "/tim-forbis",
    title: "Tim Forbis",
    items: [
      {
        id: "tim-bio",
        title: "Tim’s bio",
        text: "Tim has been an engineer for over ten years, but only had a beard for four. He started making board games recently, but really enjoys it. When not running gaming simulations, he spends his off days with his wife and three daughters.",
        suggestion: "“Meet the beards” has a version of this. Tim has no photo there yet.",
      },
    ],
  },
  {
    path: "/nate-sloan",
    title: "Nate Sloan",
    items: [
      {
        id: "nate-bio",
        title: "N8’s bio",
        text: "Nate (N8) met Adam and Edward at Protospiel STL in 2023 debuting his first game “I Crit You Not!” with his design company PRISMCORTEX. They became fast friends and have started developing many new games and entertaining people at the local farmer’s markets. He plays many instruments, including trumpet and drums for the St. Louis City Soccer Team supporters band: Fluer de Noise!",
        suggestion: "“Meet the beards” has a version of this. Could link to the Videos page.",
      },
    ],
  },
  {
    path: "/fences",
    title: "Fences",
    items: [
      {
        id: "fences-story",
        title: "About Fences",
        text: "In Fences: Farmers compete to build fields for their animals. Each tile will expand your farm, but also your neighbors, so play strategically. Each player has a unique farmer profile that can change how they score points, so every game is very different! The game was funded on Kickstarter in January of 2019. Each of the Farmer Profile cards in the game are actual backers from the campaign who donated at that level.",
        suggestion: "Done: the new game page now uses this description (Oct 26).",
      },
      {
        id: "fences-press",
        title: "What reviewers said",
        text: "“The Farmer Profile is where it's at.” (Father Geek) · “The most common thing heard after finishing a game of Fences - “Can we play again?”” (Dastardly Design) · “...a nice title for beginners and easliy digested by the little ones...” (Sandro Sacchini) · “Huge amount of replayability due to mixing Farmer Powers from Fences and the 9 expansions in The Ranch.” (Dastardly Designs, on The Ranch) · “The expansions do provide the next level of depth you would want to experience after you are familiar…” (Father Geek, on The Ranch)",
        links: [
          { label: "Father Geek", href: "https://fathergeek.com/fences/" },
          {
            label: "Dastardly Design",
            href: "https://www.dastardlydesignco.com/post/fences-a-dastardly-review",
          },
          { label: "Sandro Sacchini", href: "https://www.instagram.com/p/BpeES4tB94C/" },
          { label: "The Pawn’s Perspective", href: "https://pawnsperspective.com/fences-preview/" },
          {
            label: "Meeple Mountain",
            href: "https://www.meeplemountain.com/reviews/fences-review-good-fences-make-good-neighbors/",
          },
          {
            label: "Dastardly Design on The Ranch",
            href: "https://www.dastardlydesignco.com/post/the-ranch-dastardly-review-136",
          },
          { label: "Father Geek on The Ranch", href: "https://fathergeek.com/fences-the-ranch_prepub/" },
          { label: "BoardGameGeek", href: "https://boardgamegeek.com/boardgame/246409/fences" },
        ],
        suggestion: "A “What reviewers say” list on the Fences game page.",
      },
      {
        id: "fences-files",
        title: "Rules and print-and-play files",
        text: "PDFs hosted on Squarespace. They stop working when Squarespace is cancelled.",
        links: [
          { label: "Instructions", href: `${OLD}/Fences-Instructions.pdf` },
          { label: "B&W Print&play", href: `${OLD}/pnp_bw_fences.pdf` },
          { label: "Farmer Cards", href: `${OLD}/Farmer-Cards.pdf` },
          { label: "Instructions - The Ranch", href: `${OLD}/Tha-Ranch-Rules.pdf` },
        ],
        suggestion: "Downloads on the Fences game page. The rules link is already on the site.",
      },
      {
        id: "fences-gallery",
        title: "Fences photos",
        images: [
          { src: `${OLD}/1605540054950-Fences.jpg`, alt: "Photo by Daniel Blackbourne" },
          { src: `${OLD}/1605475747795-gameplay.jpg`, alt: "4-player finished game" },
          { src: `${OLD}/1605475808037-steep.jpg`, alt: "Painted wooden components" },
          { src: `${OLD}/1605476059942-zoom.jpg`, alt: "High-quality artwork" },
          {
            src: `${OLD}/1605476170914-IMG_2117.png`,
            alt: "The Ranch - Kickstarter expected Spring 2021",
          },
          { src: `${OLD}/1579623253324-Review-Top.png`, alt: "Review Top" },
        ],
        suggestion: "A photo gallery on the Fences game page.",
      },
    ],
  },
  {
    path: "/locked-out",
    title: "Locked Out",
    items: [
      {
        id: "locked-out-story",
        title: "About Locked Out",
        text: "Locked Out is the winner of the Game Crafter's competition sponsered by Eat Lunch and Board Game and Bearded Board Games. It is the year 2368. You and your gang of criminals stole a spacecraft to return to your hideout with your latest score of loot. Unfortunately, the on-board computer detected the tampering and has locked you out. You will surely get caught unless you regain control of the ship and escape; and your resources are running out. There are tools on board to help, but if greedy companions steal these, will you be able to make it? Your Gang's objective is to gain access to the on-board computer before any resources run out. Your personal objective is to get the biggest financial gain, but beware: this may jeopardize the gang's objective. If the gang fails to escape, the player who pocketed the smallest amount wins! Make your way through the ship gathering resources, tools, and loot. Make sure that you find enough resources (like Fuel and Oxygen) to keep the ship working. Use the tools to access new areas of the ship and get closer to regaining control of the ship. Search the rooms to find more items. Share some of the items with your gang. Accuse your teammates of hoarding all the good stuff. Can you make it to the control room before running out of resources?",
        suggestion: "Done: the new game page now uses this description (Oct 26).",
      },
      {
        id: "locked-out-gallery",
        title: "Locked Out tin, board and cards",
        images: [
          { src: `${OLD}/bf196b96-523c-sticker-0.20a-tin-top.jpg`, alt: "Tin top" },
          {
            src: `${OLD}/cd6a8264-41ab-Screenshot-2023-09-15-162420.png`,
            alt: "Board",
          },
          {
            src: `${OLD}/1694814101493-card-A-programmable-keycard.png`,
            alt: "Programmable keycard",
          },
          { src: `${OLD}/1694814101493-card-E-fuel.png`, alt: "Fuel" },
          { src: `${OLD}/1694814102409-card-H-memory-module.png`, alt: "Memory module" },
          { src: `${OLD}/1694814339677-card-E-oxygen.png`, alt: "Oxygen" },
          { src: `${OLD}/1694814102573-card-M-plasma-gun.png`, alt: "Plasma gun" },
          {
            src: `${OLD}/1694814103445-card-M-share-of-the-booty-3.png`,
            alt: "Share of the booty",
          },
        ],
        suggestion: "A photo gallery on the Locked Out game page.",
      },
    ],
  },
  {
    path: "/pack-lash",
    title: "Pack Lash",
    items: [
      {
        id: "pack-lash-text",
        title: "About Pack Lash",
        text: "COMING SOON! A fast paced, head to head, assymetric card game with variable player winning conditions. Try to achieve your victory condition while preventhing your opponent from achieving theirs. Designed by Craig Hughes with art by Hailey Fetting.",
        images: [{ src: `${OLD}/54d043c8-ee85-packlash.png`, alt: "Pack Lash" }],
        links: [{ label: "BGG page", href: "https://boardgamegeek.com/boardgame/407307/pack-lash" }],
        suggestion: "Done: the new game page now uses this description (Oct 26).",
      },
    ],
  },
  {
    path: "/mine-find",
    title: "Mine & Find",
    items: [
      {
        id: "mine-and-find-text",
        title: "About Mine & Find",
        text: "COMING SOON! A quick and easy card game for all ages. Search the mine for your color and shape. Find carts to help you traverse the mine quicker. Be the first to find all your gems to win!",
        images: [{ src: `${OLD}/bbeac02c-d9b8-MFLogo.png`, alt: "Mine & Find logo" }],
        suggestion: "Done: the new game page now uses this description (Oct 26).",
      },
    ],
  },
  {
    path: "/soccer-blocker",
    title: "Soccer Blocker",
    items: [
      {
        id: "soccer-blocker-text",
        title: "About Soccer Blocker",
        text: "COMING SOON! A 1 v 1 soccer duel. try to out guess, out think, out maneuver your opponent to work the ball down the field to take a shot on goal. First player to score three points in this fast-paced game is the winner!",
        images: [{ src: `${OLD}/189a7658-1e58-SBBoxLogo.png`, alt: "Soccer Blocker box" }],
        suggestion: "Done: the new game page now uses this description (Oct 26).",
      },
    ],
  },
  {
    path: "/soccerblocker",
    title: "Soccer Blocker rules",
    items: [
      {
        id: "soccer-blocker-rules",
        title: "Rules sheet, front and back",
        text: "This page only shows the two sides of the rules sheet. If a QR code on the box points here, the address needs to keep working.",
        images: [
          { src: `${OLD}/1789706068856-RulesFront2.png`, alt: "Rules, front" },
          { src: `${OLD}/1789706068852-RulesBack2.png`, alt: "Rules, back" },
        ],
        suggestion: "A rules page at the same address, linked from the Soccer Blocker game page.",
      },
    ],
  },
  {
    path: "/fences-the-roll-write",
    title: "Fences: The Roll & Write",
    items: [
      {
        id: "roll-and-write-text",
        title: "About Fences: The Roll & Write",
        text: "A new game in the Fences universe! Roll the dice, draft one, mark your sheet. Try to plan your farm by grouping outcomes in specific ways! From designers Darren Reckner and Jason Hager of Durdle Games. Coming in the Winter of 2026!",
        images: [
          {
            src: `${OLD}/438619b3-3536-Rolling-Acres-Mock-Up-Web_2.jpg`,
            alt: "Rolling Acres mock-up",
          },
        ],
        suggestion: "Done: new description, and “Coming 2027” everywhere, as N8 decided (Oct 26).",
      },
    ],
  },
  {
    path: "/for-retailers",
    title: "For Retailers",
    items: [
      {
        id: "retailers-text",
        title: "Retailer page text",
        text: "For Retailers. Are you interested in carrying our games in your store? Download All Sell Sheets. Click the image to download the game sell sheets. If interested, reach out to us at adam@beardedboardgames.com. I will provide a response within 1-3 business day providing more details and order form.",
        links: [
          {
            label: "All sell sheets (Google Drive)",
            href: "https://drive.google.com/uc?export=download&id=1a_upWFmpcKtbBF-aEk8H21BUqQTi_PQE",
          },
        ],
        suggestion: "Already on the Wholesale page, with the same sell sheet links.",
      },
      {
        id: "retailers-images",
        title: "Sell sheet pictures",
        images: [
          { src: `${OLD}/1776873479919-Fences-Box-Art.jpg`, alt: "Fences box art" },
          { src: `${OLD}/1776873492340-lockedoutbox.png`, alt: "Locked Out box" },
          { src: `${OLD}/1776876544035-MFLogo.png`, alt: "Mine & Find logo" },
          { src: `${OLD}/1776876553762-SBBoxLogo.png`, alt: "Soccer Blocker box" },
        ],
        suggestion: "Pictures for each sell sheet on the Wholesale page.",
      },
    ],
  },
  {
    path: "/bb2026-vip",
    title: "Bearded Bundle 2026 (VIP)",
    items: [
      {
        id: "vip-text",
        title: "VIP page text",
        text: "EXCLUSIVE PERKS FOR VIPS. COMING SOON! Pre-Orders Get 10% Off! Join the community for an invitation to pre-order the complete bundle or individual games. These are not the final versions of the products. Gameplay, artwork, components, rules and other details are subject to change.",
        suggestion: "The VIP band on the home page. The “subject to change” note could go under it.",
      },
      {
        id: "vip-hero",
        title: "VIP page picture",
        images: [
          {
            src: `${OLD}/b5d96166-2bd1-BB2026-VIP-LP-Hero-Image.jpg`,
            alt: "Bearded Bundle 2026",
          },
        ],
        suggestion: "The VIP band on the home page.",
      },
    ],
  },
  {
    path: "/shop",
    title: "Shop",
    items: [
      {
        id: "shop-prices",
        title: "Products and prices on the old shop",
        text: "Fences $25 (sold out) · Fences - 5/6 Expansion (Add on) $5 · Fences - Premium Print and Play $8 · Future Board Gamer Onesie $18 · Jibe Card Game $10 · Board Gamer in Training Children's T-Shirt $15 · Fences: The Ranch (Premium Print and Play) $6 on sale from $8 · Fences: The Ranch $25 · Pack Lash VIP $1 · Locked Out $20 · Fences: Seasons $5",
        suggestion:
          "The new shop takes prices from Square. Check these match, and that the print-and-play files reach buyers.",
      },
    ],
  },
  {
    path: "/rust-forte",
    title: "Unused template pages",
    items: [
      {
        id: "template-pages",
        title: "Squarespace sample pages",
        text: "/rust-forte, /home-alt-bedford and /ushabti-1 hold Squarespace’s sample text and photos (“A better world starts with a choice”, “Nam tempor eleifend diam…”), not Bearded content.",
        suggestion: "Drop. Old links send people to the home page.",
      },
    ],
  },
];

export const oldSiteItemIds = new Set(oldSite.flatMap((p) => p.items.map((i) => i.id)));

/** Old Squarespace addresses and where they land on the new site. */
export const oldSiteRedirects: Record<string, string> = {
  "/home": "/",
  "/adam-collins": "/#beards",
  "/tim-forbis": "/#beards",
  "/nate-sloan": "/#beards",
  "/fences": "/games/fences",
  "/locked-out": "/games/locked-out",
  "/pack-lash": "/games/pack-lash",
  "/mine-find": "/games/mine-and-find",
  "/soccer-blocker": "/games/soccer-blocker",
  "/soccerblocker": "/games/soccer-blocker",
  "/fences-the-roll-write": "/games/fences-roll-and-write",
  "/for-retailers": "/wholesale",
  "/bb2026-vip": "/#vip",
  "/shop/fences": "/games/fences",
  "/shop/fences-expansions": "/games/fences",
  "/shop/fences-seasons": "/games/fences",
  "/shop/fences-the-ranch": "/games/fences",
  "/shop/fences-the-ranch-digital-print-and-play": "/games/fences",
  "/shop/fences-premium-print-and-play": "/games/fences",
  "/shop/locked-out": "/games/locked-out",
  "/shop/pack-lash-vip": "/games/pack-lash",
  "/shop/jibe-card-game": "/shop",
  "/shop/future-board-gamer-onesie-3-months": "/shop",
  "/shop/4zyaemkotottka4wqn1dt7ogt6wlfg": "/shop",
  "/rust-forte": "/",
  "/home-alt-bedford": "/",
  "/ushabti-1": "/",
};

/** Where an old address lands, or undefined. Ignores a trailing slash and letter case, as Squarespace did. */
export function oldSiteRedirect(path: string): string | undefined {
  const p = path.toLowerCase().replace(/\/+$/, "");
  return oldSiteRedirects[p];
}
