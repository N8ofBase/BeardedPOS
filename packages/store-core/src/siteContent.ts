// Site content: the words and pictures staff change from Behind the Beard without a redeploy.
// The site's own wording (apps/store/src/content/site.ts) is the starting point; what staff save is
// only the fields they changed, keyed like "game.fences.tagline". The store server checks every
// key and value here, and the site renders it all as plain text (never as HTML).
//
// Game items, prices and stock still come from Square, never from here.

export type SiteFieldKind =
  /** One line of text. */
  | "line"
  /** A paragraph or more; blank lines start a new paragraph. */
  | "text"
  /** One item per line, like "2–6 players". */
  | "lines"
  /** A link: https://… or a page on this site, like /videos. */
  | "url"
  | "email"
  /** A picture uploaded in the editor (its id). */
  | "image"
  /** Out now, Pre-order or Coming soon. */
  | "status"
  /** One of a few set options, like where text sits (see `choices`). */
  | "choice";

export interface SiteField {
  key: string;
  label: string;
  kind: SiteFieldKind;
  /** Most characters allowed. */
  max: number;
  /** May be left empty (then that part of the page is hidden). */
  optional?: boolean;
  hint?: string;
  /** For a "choice" field: the options, in the order the editor shows them. */
  choices?: readonly { value: string; label: string }[];
}

export interface SiteGroup {
  id: string;
  title: string;
  /** The page to look at for this group, for the preview link. */
  page: string;
  fields: SiteField[];
}

/** Changed fields only, by key. A key that's missing shows the site's original wording. */
export type SiteContent = Record<string, string>;

export const SITE_STATUSES = ["available", "preorder", "coming-soon"] as const;
export const SITE_STATUS_LABELS: Record<(typeof SITE_STATUSES)[number], string> = {
  available: "Out now",
  preorder: "Pre-order",
  "coming-soon": "Coming soon",
};

/** Where the announcement sits across the bar. Center unless staff pick another. */
export const NOTICE_ALIGNS = [
  { value: "left", label: "Left" },
  { value: "center", label: "Center" },
  { value: "right", label: "Right" },
] as const;
export type NoticeAlign = (typeof NOTICE_ALIGNS)[number]["value"];

/** How much room the announcement bar has around its words. Regular unless staff pick another. */
export const NOTICE_SPACINGS = [
  { value: "slim", label: "Slim" },
  { value: "regular", label: "Regular" },
  { value: "roomy", label: "Roomy" },
] as const;
export type NoticeSpacing = (typeof NOTICE_SPACINGS)[number]["value"];

/** The games on the site, in shelf order. Adding a game is still a code change (apps/store content). */
export const SITE_GAMES = [
  { slug: "fences", name: "Fences" },
  { slug: "locked-out", name: "Locked Out" },
  { slug: "soccer-blocker", name: "Soccer Blocker" },
  { slug: "mine-and-find", name: "Mine & Find" },
  { slug: "pack-lash", name: "Pack Lash" },
  { slug: "fences-roll-and-write", name: "Fences: The Roll & Write" },
] as const;

export const SITE_TEAM = [
  { id: "adam", name: "Adam Collins" },
  { id: "edward", name: "Edward" },
  { id: "tim", name: "Tim Forbis" },
  { id: "n8", name: "Nate “N8” Sloan" },
] as const;

/** Biggest picture the server keeps, after the editor shrinks it. */
export const SITE_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
export const SITE_IMAGE_TYPES = ["image/webp", "image/jpeg", "image/png"] as const;
export type SiteImageType = (typeof SITE_IMAGE_TYPES)[number];

const line = (key: string, label: string, max = 120, more: Partial<SiteField> = {}): SiteField => ({
  key,
  label,
  kind: "line",
  max,
  ...more,
});
const text = (key: string, label: string, max = 1500, more: Partial<SiteField> = {}): SiteField => ({
  key,
  label,
  kind: "text",
  max,
  ...more,
});

export const siteGroups: SiteGroup[] = [
  {
    id: "notice",
    title: "Announcement bar",
    page: "/",
    fields: [
      text("notice.text", "Announcement", 200, {
        optional: true,
        hint: "A short note across the top of every page, like holiday hours or a sale. Press Enter for a new line. Leave it empty to hide the bar.",
      }),
      {
        key: "notice.align",
        label: "Where the words sit",
        kind: "choice",
        max: 10,
        choices: NOTICE_ALIGNS,
      },
      {
        key: "notice.spacing",
        label: "Room around the words",
        kind: "choice",
        max: 10,
        choices: NOTICE_SPACINGS,
        hint: "Slim keeps the bar thin; Roomy gives a big sale more space.",
      },
      {
        key: "notice.link",
        label: "Announcement link",
        kind: "url",
        max: 300,
        optional: true,
        hint: "Where the note goes when tapped, like /shop or https://… Leave empty for no link.",
      },
    ],
  },
  {
    id: "hero",
    title: "Home page: top",
    page: "/",
    fields: [line("hero.title", "Big headline", 80), text("hero.lede", "Words under the headline", 400)],
  },
  {
    id: "shelf",
    title: "Home page: On the shelf",
    page: "/#games",
    fields: [text("shelf.lede", "Words under “On the shelf”", 300)],
  },
  {
    id: "beards",
    title: "Meet the beards",
    page: "/#beards",
    fields: [line("team.heading", "Heading", 60), text("team.about", "About us", 800)],
  },
  ...SITE_TEAM.map((m): SiteGroup => ({
    id: `team-${m.id}`,
    title: `Team: ${m.name}`,
    page: "/#beards",
    fields: [
      line(`team.${m.id}.name`, "Name", 60),
      line(`team.${m.id}.role`, "Role", 80),
      line(`team.${m.id}.beard`, "Beard status", 120),
      text(`team.${m.id}.bio`, "Bio", 600),
      text(`team.${m.id}.story`, "Full bio", 3000, {
        optional: true,
        hint: "On their own page, linked from their card. Leave a blank line between paragraphs. Leave empty for no page.",
      }),
      {
        key: `team.${m.id}.photo`,
        label: "Photo",
        kind: "image",
        max: 64,
        hint: "A square photo looks best.",
      },
    ],
  })),
  {
    id: "retail",
    title: "Come play with us and wholesale",
    page: "/wholesale",
    fields: [
      { key: "retail.banner", label: "Banner picture", kind: "image", max: 64, hint: "A wide picture." },
      line("retail.playHeading", "Events heading", 60),
      text("retail.playText", "Events words", 500),
      line("retail.sellHeading", "Wholesale heading", 80),
      text("retail.sellText", "Wholesale words", 500),
      { key: "brand.retailEmail", label: "Wholesale email", kind: "email", max: 120 },
    ],
  },
  {
    id: "brand",
    title: "City and social links",
    page: "/",
    fields: [
      line("brand.city", "City (in the footer)", 60),
      { key: "brand.socials.tiktok", label: "TikTok", kind: "url", max: 300 },
      { key: "brand.socials.instagram", label: "Instagram", kind: "url", max: 300 },
      { key: "brand.socials.facebook", label: "Facebook", kind: "url", max: 300 },
      { key: "brand.socials.linkedin", label: "LinkedIn", kind: "url", max: 300 },
    ],
  },
  {
    id: "bundle",
    title: "The Bearded Bundle",
    page: "/bundle",
    fields: [
      line("bundle.name", "Name", 60),
      line("bundle.tagline", "Tagline", 200),
      text("bundle.blurb", "About the bundle", 1500),
      line("bundle.buddyPrice", "Beard Buddy price words", 80, {
        optional: true,
        hint: "Shown after the Buddy price (Square's price less $5), like “$45 for new Beard Buddies”. Leave empty to hide it.",
      }),
      line("bundle.when", "When it ships", 120, {
        optional: true,
        hint: "Shown next to the price, like “Ships in December”. Leave empty to hide it.",
      }),
      {
        key: "bundle.howItWorks",
        label: "How pre-orders work",
        kind: "lines",
        max: 1000,
        optional: true,
        hint: "One point per line. Leave empty to hide the list.",
      },
      text("bundle.note", "Small print", 500, {
        optional: true,
        hint: "Under the games, like “artwork may change”. Leave empty for none.",
      }),
      {
        key: "bundle.art",
        label: "Bundle picture",
        kind: "image",
        max: 64,
        optional: true,
        hint: "Leave empty to use the picture from Square.",
      },
    ],
  },
  ...SITE_GAMES.map((g): SiteGroup => ({
    id: `game-${g.slug}`,
    title: `Game: ${g.name}`,
    page: `/games/${g.slug}`,
    fields: [
      { key: `game.${g.slug}.status`, label: "Status", kind: "status", max: 20 },
      line(`game.${g.slug}.when`, "Status note", 40, {
        optional: true,
        hint: "Shown instead of the status, like “Coming 2027”. Leave empty to show the status.",
      }),
      line(`game.${g.slug}.badge`, "Badge", 30, {
        optional: true,
        hint: "A small tag like “Best seller” or “New”. Leave empty for none.",
      }),
      line(`game.${g.slug}.tagline`, "Tagline", 200),
      text(`game.${g.slug}.blurb`, "How it plays", 1500),
      text(`game.${g.slug}.story`, "More about the game", 3000, {
        optional: true,
        hint: "Under “How it plays” on the game’s page. Leave a blank line between paragraphs.",
      }),
      {
        key: `game.${g.slug}.facts`,
        label: "Quick facts",
        kind: "lines",
        max: 300,
        optional: true,
        hint: "One per line, like “2–6 players”. The shelf shows the first three.",
      },
      line(`game.${g.slug}.designer`, "Designed by", 120, { optional: true }),
      line(`game.${g.slug}.artist`, "Art by", 120, { optional: true }),
      { key: `game.${g.slug}.art`, label: "Box art", kind: "image", max: 64 },
    ],
  })),
];

export const siteFields = new Map(siteGroups.flatMap((g) => g.fields.map((f) => [f.key, f] as const)));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const isImageId = (v: string) => UUID.test(v);
/** The address the site loads an uploaded picture from. */
export const siteImageUrl = (id: string) => `/api/site/images/${id}`;

/** Splits a "text" field into paragraphs on blank lines. */
export const paragraphs = (v: string) =>
  v
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
/** Splits a "lines" field into its items. */
export const lines = (v: string) =>
  v
    .split("\n")
    .map((p) => p.trim())
    .filter(Boolean);

/** A link the site may show: https, or a path on this site. No javascript:, data: or mailto:. */
export function isSafeLink(v: string): boolean {
  if (/\s/.test(v)) return false;
  if (v.startsWith("/")) return !v.startsWith("//") && !v.startsWith("/\\");
  return /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?([/?#]|$)/i.test(v);
}

/**
 * Why a value can't be saved for this field, or null when it's fine. The sentence names the field,
 * so the editor can show it as is.
 */
export function siteValueProblem(field: SiteField, raw: string): string | null {
  const v = raw.trim();
  if (!v) return field.optional ? null : `${field.label} can’t be empty.`;
  if (v.length > field.max) return `Keep ${field.label} under ${field.max} characters.`;
  if (field.kind === "line" && /[\r\n]/.test(v)) return `${field.label} must be one line.`;
  if (field.kind === "url" && !isSafeLink(v))
    return `${field.label} must start with https:// or be a page here, like /shop.`;
  if (field.kind === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))
    return `Check ${field.label}, like name@beardedboardgames.com.`;
  if (field.kind === "image" && !isImageId(v)) return `Upload the ${field.label.toLowerCase()} again.`;
  if (field.kind === "status" && !(SITE_STATUSES as readonly string[]).includes(v))
    return `Pick a status for ${field.label}.`;
  if (field.kind === "choice" && !field.choices?.some((c) => c.value === v))
    return `Pick one for ${field.label}.`;
  return null;
}

export class SiteContentError extends Error {}

/**
 * Checks content sent to the server and returns it cleaned up (trimmed, unknown keys refused).
 * Throws SiteContentError with a sentence to show.
 */
export function checkSiteContent(input: unknown): SiteContent {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    throw new SiteContentError("That content didn’t make sense. Refresh the page and try again.");
  const out: SiteContent = {};
  for (const [key, value] of Object.entries(input)) {
    const field = siteFields.get(key);
    if (!field) throw new SiteContentError("Part of that content isn’t on the site. Refresh the page.");
    if (typeof value !== "string")
      throw new SiteContentError("That content didn’t make sense. Refresh the page and try again.");
    const problem = siteValueProblem(field, value);
    if (problem) throw new SiteContentError(problem);
    out[key] = value.replace(/\r\n/g, "\n").trim();
  }
  return out;
}

/** The picture ids a version of the content uses. */
export const imageIds = (content: SiteContent) =>
  Object.entries(content)
    .filter(([k]) => siteFields.get(k)?.kind === "image")
    .map(([, v]) => v);

/** How many fields differ between two versions. */
export function changedKeys(a: SiteContent, b: SiteContent): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((k) => a[k] !== b[k]).sort();
}

/** What GET /api/site returns: the published content. */
export interface PublishedSite {
  content: SiteContent;
  publishedAt: string | null;
}

export interface SiteVersion {
  id: string;
  by: string;
  at: string;
  changes: number;
}

/** What GET /api/staff/site returns. */
export interface StaffSite {
  draft: SiteContent;
  published: SiteContent;
  draftBy: string | null;
  draftAt: string | null;
  publishedBy: string | null;
  publishedAt: string | null;
  /** Earlier publishes, newest first (the last 20). */
  history: SiteVersion[];
}
