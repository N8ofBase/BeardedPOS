// The hero's d20: what a roll says. Pure, so tests can pass their own random numbers.
import { brand, games, videos } from "./content/site.ts";

export type Random = () => number;

const GAME_ROLLS: Record<string, string[]> = {
  fences: [
    "You rolled Fences. Go build a farm and passive-aggressively finish your neighbor’s.",
    "You rolled Fences. Somewhere, a sheep is about to be fenced in.",
    "You rolled Fences. Good fences make good neighbors. Great fences make rivals.",
    "You rolled Fences. Time to find out who in your family hoards cows.",
  ],
  "locked-out": [
    "You rolled Locked Out. Trust your crew. Then check your pockets.",
    "You rolled Locked Out. The ship’s computer says no.",
    "You rolled Locked Out. Fuel is low, oxygen is lower, loyalty is lowest.",
    "You rolled Locked Out. Remember: if the gang fails, the least greedy thief wins.",
  ],
  "soccer-blocker": [
    "You rolled Soccer Blocker. Chant accordingly.",
    "You rolled Soccer Blocker. Fake left, shoot right.",
    "You rolled Soccer Blocker. Only 50 Version Zero copies exist. Move fast.",
    "You rolled Soccer Blocker. First to three goals buys the next round.",
  ],
  "mine-and-find": [
    "You rolled Mine & Find. Bring the kids. Bring snacks.",
    "You rolled Mine & Find. Gems first, snacks second.",
    "You rolled Mine & Find. Hop a mine cart and beat the kids to the gems.",
    "You rolled Mine & Find. Every gem you find is one they don’t.",
  ],
  "pack-lash": [
    "You rolled Pack Lash. It isn’t out yet, so go join the VIP list.",
    "You rolled Pack Lash. Two players, two ways to win, zero mercy.",
    "You rolled Pack Lash. It isn’t out yet, but your VIP spot can be.",
  ],
  "fences-roll-and-write": [
    "You rolled Fences: The Roll & Write. Sharpen a pencil and wait for 2027.",
    "You rolled Fences: The Roll & Write. Pencils at the ready for 2027.",
    "You rolled Fences: The Roll & Write. Draft a die, plan a farm, keep the eraser handy.",
  ],
};

// Ordinary rolls sometimes land on a social account or one of N8's songs instead of a game.
export const SOCIAL_CHANCE = 0.2;
export const VIDEO_CHANCE = 0.15;
const SOCIAL_ROLLS = [
  {
    name: "TikTok",
    url: brand.socials.tiktok,
    rolls: [
      "You rolled TikTok. Watch the beards playtest, panic and occasionally win.",
      "You rolled TikTok. Short videos, long beards.",
    ],
  },
  {
    name: "Instagram",
    url: brand.socials.instagram,
    rolls: [
      "You rolled Instagram. Box art, prototypes and beard pics before anyone else sees them.",
      "You rolled Instagram. Double-tap a meeple. It makes their day.",
    ],
  },
  {
    name: "Facebook",
    url: brand.socials.facebook,
    rolls: [
      "You rolled Facebook. Market days and game nights, posted before they happen.",
      "You rolled Facebook. Your aunt already follows us. Catch up.",
    ],
  },
  {
    name: "LinkedIn",
    url: brand.socials.linkedin,
    rolls: [
      "You rolled LinkedIn. Yes, board game companies have LinkedIn. Endorse us for dice rolling.",
      "You rolled LinkedIn. Professionally unprofessional since 2018.",
    ],
  },
];

const VIDEO_ROLLS: Record<string, string[]> = {
  "bearded-board-games": [
    "You rolled our theme song. Turn it up and sing along.",
    "You rolled “Bearded Board Games”. Bass, beards and a meeple on the guitar.",
  ],
  "everybody-loves-some-board-games": [
    "You rolled “Everybody Loves Some Board Games”. Dean Martin would understand.",
    "You rolled a crooner. Everybody loves some board games, sometime.",
  ],
  "my-games": [
    "You rolled “My Games”. One minute. Plenty of bass.",
    "You rolled a song. N8 wrote it about our games, so you have to listen.",
  ],
};

export const videoPath = (slug: string) => `/videos#${slug}`;

const BOTCH = [
  "The die rolled off the table and the dog ate it. Roll again.",
  "You tripped over the box lid and scattered every meeple. Roll again.",
  "Your beard got caught in the dice tower. Roll again.",
  "Somewhere, a game designer felt a disturbance. Roll again.",
];

const CRIT = [
  "The dice gods smile upon you. Play them all.",
  "Your luck is so good you should buy a lottery ticket. Or every game.",
  "The beards are impressed, and that takes a lot.",
];

export interface Link {
  label: string;
  href: string;
  external?: boolean;
}

export type RollResult =
  | { kind: "botch"; face: 1; text: string }
  | { kind: "crit"; face: 20; text: string; links: Link[] }
  | { kind: "game" | "social" | "video"; face: number; text: string; link: Link; name: string };

const pick = <T>(list: T[], random: Random): T => list[Math.floor(random() * list.length)]!;

export const gamePath = (slug: string) => `/games/${slug}`;

/** Rolls the die. `last` is the name the previous roll landed on, so the same game doesn't come up twice running. */
export function roll(random: Random = Math.random, last?: string): RollResult {
  const face = 1 + Math.floor(random() * 20);
  if (face === 1) return { kind: "botch", face, text: pick(BOTCH, random) };
  if (face === 20) {
    return {
      kind: "crit",
      face,
      text: pick(CRIT, random),
      links: games.map((g) => ({ label: g.name, href: gamePath(g.slug) })),
    };
  }
  const detour = random();
  if (detour < SOCIAL_CHANCE) {
    const choices = SOCIAL_ROLLS.filter((s) => s.name !== last);
    const s = pick(choices, random);
    return {
      kind: "social",
      face,
      name: s.name,
      text: pick(s.rolls, random),
      link: { label: `Follow us on ${s.name}`, href: s.url, external: true },
    };
  }
  if (detour < SOCIAL_CHANCE + VIDEO_CHANCE) {
    const v = pick(
      videos.filter((v) => v.title !== last),
      random,
    );
    return {
      kind: "video",
      face,
      name: v.title,
      text: pick(VIDEO_ROLLS[v.slug] ?? [`You rolled “${v.title}”.`], random),
      link: { label: `Watch “${v.title}”`, href: videoPath(v.slug) },
    };
  }
  const choices = games.filter((g) => g.name !== last);
  const g = pick(choices, random);
  return {
    kind: "game",
    face,
    name: g.name,
    text: pick(GAME_ROLLS[g.slug] ?? [`You rolled ${g.name}.`], random),
    link: { label: `Meet ${g.name}`, href: gamePath(g.slug) },
  };
}
