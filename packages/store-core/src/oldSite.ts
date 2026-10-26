// Everything on the old Squarespace site (beardedboardgames.com), copied on 2026-10-26 so the team
// can decide what to keep before the domain moves to this store. Text is as it was on the old site,
// typos included. Images and files still load from Squarespace until they're downloaded.

const SQ = "https://images.squarespace-cdn.com/content/v1/5a4d3057f6576ef69d4c551d";
const SQ_FILES = "https://beardedboardgames.com/s";

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
  paths.map((p, i) => ({ src: `${SQ}/${p}`, alt: alt(i + 1) }));

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
            "1774467681418-PNKLMWPWI8WN298ZYUR6/IMG_0901.JPG",
            "1774467664573-Y1927AWCWAPD9TYCH21B/IMG_0905.JPG",
            "1774467664385-LRPW8IPA3TW64SOSKH8U/IMG_0907.JPG",
            "1774467669405-V80N8PMBV35W1U6T8PDA/IMG_0918.JPG",
            "1774467669726-CNMWX2SCB5REGXGQLPI2/IMG_0935.JPG",
            "1774467672834-B8DTSVOF72X8C7HJVUK4/IMG_0936.JPG",
            "1774467673174-9VZPBE24XVWP7C3DAZQ7/IMG_0937.JPG",
            "1774467676824-OKEIW9DQGCR4WEA7ST1C/IMG_0939.JPG",
            "1774467677168-51XCPC53NVSH9C3GVGFY/IMG_0940.JPG",
            "1774467680873-6EM36M8WWABH7U0SGUO9/IMG_0941.JPG",
          ],
          (i) => `Pack Lash photo ${i}`,
        ),
        suggestion: "A photo gallery on the Pack Lash game page.",
      },
      {
        id: "footer-badges",
        title: "Member badges in the footer",
        text: "Every page ends with a GAMA member icon and an Indie Game Alliance logo that links to indiegamealliance.com.",
        images: [
          { src: `${SQ}/731dc39c-863d-4d89-bb5b-86574cc195bf/gama_member_icon.png`, alt: "GAMA member" },
        ],
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
        images: [
          { src: `${SQ}/1625753652499-ZVJHG7D339MPAQ5FVMG2/Adam+-+Shark+Hunt.PNG`, alt: "Adam - Shark Hunt" },
        ],
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
        suggestion: "The Fences game page, under “How it plays”.",
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
          { label: "Instructions", href: `${SQ_FILES}/Fences-Instructions.pdf` },
          { label: "B&W Print&play", href: `${SQ_FILES}/pnp_bw_fences.pdf` },
          { label: "Farmer Cards", href: `${SQ_FILES}/Farmer-Cards.pdf` },
          { label: "Instructions - The Ranch", href: `${SQ_FILES}/Tha-Ranch-Rules.pdf` },
        ],
        suggestion: "Downloads on the Fences game page. The rules link is already on the site.",
      },
      {
        id: "fences-gallery",
        title: "Fences photos",
        images: [
          { src: `${SQ}/1605540054950-5376EW4FY90FFADBJDQ2/Fences.jpg`, alt: "Photo by Daniel Blackbourne" },
          { src: `${SQ}/1605475747795-LGCSFGF6IQSW4I7RMB2L/gameplay.jpg`, alt: "4-player finished game" },
          { src: `${SQ}/1605475808037-T3Q8BYVY0X3AK4Q7331W/steep.jpg`, alt: "Painted wooden components" },
          { src: `${SQ}/1605476059942-FAV3507RAI91S2FZBZUJ/zoom.jpg`, alt: "High-quality artwork" },
          {
            src: `${SQ}/1605476170914-MB427U4R3SAH9VYDQGR8/IMG_2117.png`,
            alt: "The Ranch - Kickstarter expected Spring 2021",
          },
          { src: `${SQ}/1579623253324-SESLKQHJYQTN0WD11GNN/Review+Top.png`, alt: "Review Top" },
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
        suggestion:
          "The Locked Out game page. Its story differs from the new site’s, which says the crew robbed a bank.",
      },
      {
        id: "locked-out-gallery",
        title: "Locked Out tin, board and cards",
        images: [
          { src: `${SQ}/bf196b96-523c-43cb-b98e-042b32935650/sticker-0.20a-tin-top.jpg`, alt: "Tin top" },
          {
            src: `${SQ}/cd6a8264-41ab-4445-a423-736def21afaa/Screenshot+2023-09-15+162420.png`,
            alt: "Board",
          },
          {
            src: `${SQ}/1694814101493-O21RTUQ7RSBW4363P37V/card-A-programmable-keycard.png`,
            alt: "Programmable keycard",
          },
          { src: `${SQ}/1694814101493-PQXU4A5L4XODJZTC6YUO/card-E-fuel.png`, alt: "Fuel" },
          { src: `${SQ}/1694814102409-OSEO8KQ6ECPWKKJB4OWL/card-H-memory-module.png`, alt: "Memory module" },
          { src: `${SQ}/1694814339677-RPR7STZE3AMOARBRPFAV/card-E-oxygen.png`, alt: "Oxygen" },
          { src: `${SQ}/1694814102573-G0VEX8CMEX6MYQDZ47UI/card-M-plasma-gun.png`, alt: "Plasma gun" },
          {
            src: `${SQ}/1694814103445-KO5QT587W15XPV83QR1Y/card-M-share-of-the-booty-3.png`,
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
        images: [{ src: `${SQ}/54d043c8-ee85-44cc-9195-5df0380ae3a7/packlash.png`, alt: "Pack Lash" }],
        links: [{ label: "BGG page", href: "https://boardgamegeek.com/boardgame/407307/pack-lash" }],
        suggestion: "Already on the Pack Lash game page in new words.",
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
        images: [{ src: `${SQ}/bbeac02c-d9b8-4b09-a6f2-818b7e3f9c40/MFLogo.png`, alt: "Mine & Find logo" }],
        suggestion:
          "The Mine & Find game page. Its rules differ from the new site’s (gems and carts, not helmet and cart).",
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
        images: [
          { src: `${SQ}/189a7658-1e58-44bd-a461-e7e0e2f3cc50/SBBoxLogo.png`, alt: "Soccer Blocker box" },
        ],
        suggestion: "Already on the Soccer Blocker game page in new words.",
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
          { src: `${SQ}/1789706068856-N87QFIQCQTQ0NBKXFQPI/RulesFront2.png`, alt: "Rules, front" },
          { src: `${SQ}/1789706068852-B4CG81AT503ZYRRHSD8J/RulesBack2.png`, alt: "Rules, back" },
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
            src: `${SQ}/438619b3-3536-4a20-8824-702e8097c809/Rolling+Acres+Mock+Up+Web_2.jpg`,
            alt: "Rolling Acres mock-up",
          },
        ],
        suggestion:
          "The game page. The old site says both “Winter of 2026” and “Coming 2027”; the new site says 2027. The mock-up is the new site’s cover for now.",
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
          { src: `${SQ}/1776873479919-RU5JMHPLTHYZMDACDETL/Fences+Box+Art.jpg`, alt: "Fences box art" },
          { src: `${SQ}/1776873492340-9ZK9JNSF046OSKCG2EVF/lockedoutbox.png`, alt: "Locked Out box" },
          { src: `${SQ}/1776876544035-P0VB3FAN0MYYYAT5EBTN/MFLogo.png`, alt: "Mine & Find logo" },
          { src: `${SQ}/1776876553762-GSBN5FWGNCN8VCPZ12TK/SBBoxLogo.png`, alt: "Soccer Blocker box" },
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
            src: `${SQ}/b5d96166-2bd1-47b0-b738-73990b768da6/BB2026+VIP+LP+Hero+Image.jpg`,
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
