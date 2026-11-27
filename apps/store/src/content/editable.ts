// Turns published site content (only the fields staff changed) into the site's wording, starting
// from the original wording in site.ts. Everything here is plain text; React escapes it.
import {
  isImageId,
  lines,
  NOTICE_ALIGNS,
  NOTICE_SPACINGS,
  paragraphs,
  siteImageUrl,
  SITE_GAMES,
  SITE_TEAM,
  type NoticeAlign,
  type NoticeSpacing,
  type SiteContent,
} from "@bearded/store-core";
import bridges from "../assets/banner-bridges.webp";
import {
  about,
  brand,
  bundle,
  games,
  pageText,
  team,
  type Bundle,
  type Game,
  type GameStatus,
  type TeamMember,
} from "./site.ts";

export interface Site {
  brand: typeof brand;
  games: Game[];
  team: TeamMember[];
  about: string;
  text: typeof pageText & { heroTitle: string; retailBanner: string };
  /** The Bearded Bundle page. `art` is empty when the page should use Square's picture. */
  bundle: Bundle & { art: string };
  /** The announcement bar, or null when there isn't one. */
  notice: { text: string; link: string | null; align: NoticeAlign; spacing: NoticeSpacing } | null;
}

/** Every editable field's original value, as the editor shows it. Pictures are their address. */
export function originals(): SiteContent {
  const out: SiteContent = {
    "notice.text": "",
    "notice.link": "",
    "notice.align": "center",
    "notice.spacing": "regular",
    "hero.title": brand.motto,
    "hero.lede": pageText.heroLede,
    "shelf.lede": pageText.shelfLede,
    "team.heading": pageText.teamHeading,
    "team.about": about,
    "retail.banner": bridges,
    "retail.playHeading": pageText.playHeading,
    "retail.playText": pageText.playText,
    "retail.sellHeading": pageText.sellHeading,
    "retail.sellText": pageText.sellText,
    "brand.retailEmail": brand.retailEmail,
    "brand.city": brand.city,
    ...Object.fromEntries(Object.entries(brand.socials).map(([k, v]) => [`brand.socials.${k}`, v])),
    "bundle.name": bundle.name,
    "bundle.tagline": bundle.tagline,
    "bundle.blurb": bundle.blurb,
    "bundle.buddyPrice": bundle.buddyPrice,
    "bundle.when": bundle.when,
    "bundle.howItWorks": bundle.howItWorks.join("\n"),
    "bundle.note": bundle.note,
    "bundle.art": "",
  };
  for (const m of team) {
    out[`team.${m.id}.name`] = m.name;
    out[`team.${m.id}.role`] = m.role;
    out[`team.${m.id}.beard`] = m.beard;
    out[`team.${m.id}.bio`] = m.bio;
    out[`team.${m.id}.story`] = (m.story ?? []).join("\n\n");
    out[`team.${m.id}.photo`] = m.art ?? "";
  }
  for (const g of games) {
    const k = (f: string) => `game.${g.slug}.${f}`;
    out[k("status")] = g.status;
    out[k("when")] = g.when ?? "";
    out[k("badge")] = g.badge ?? "";
    out[k("tagline")] = g.tagline;
    out[k("blurb")] = g.blurb;
    out[k("story")] = (g.story ?? []).join("\n\n");
    out[k("facts")] = g.facts.join("\n");
    out[k("designer")] = g.designer ?? "";
    out[k("artist")] = g.artist ?? "";
    out[k("art")] = g.art;
  }
  return out;
}

/** A picture field's address: an uploaded picture's, else the original. */
export const pictureUrl = (value: string | undefined, original: string) =>
  value && isImageId(value) ? siteImageUrl(value) : original;

const orNone = (v: string | undefined) => (v ? v : undefined);

const pick = <T extends string>(options: readonly { value: T }[], v: string | undefined, fallback: T): T =>
  options.find((o) => o.value === v)?.value ?? fallback;

/** The site as shoppers see it with this content published. */
export function buildSite(content: SiteContent): Site {
  const get = (key: string, original: string) => content[key] ?? original;
  const socials = Object.fromEntries(
    Object.entries(brand.socials).map(([k, v]) => [k, get(`brand.socials.${k}`, v)]),
  ) as typeof brand.socials;
  const noticeText = content["notice.text"]?.trim();
  return {
    brand: {
      ...brand,
      motto: get("hero.title", brand.motto),
      city: get("brand.city", brand.city),
      retailEmail: get("brand.retailEmail", brand.retailEmail),
      socials,
    },
    about: get("team.about", about),
    text: {
      heroTitle: get("hero.title", brand.motto),
      heroLede: get("hero.lede", pageText.heroLede),
      shelfLede: get("shelf.lede", pageText.shelfLede),
      teamHeading: get("team.heading", pageText.teamHeading),
      playHeading: get("retail.playHeading", pageText.playHeading),
      playText: get("retail.playText", pageText.playText),
      sellHeading: get("retail.sellHeading", pageText.sellHeading),
      sellText: get("retail.sellText", pageText.sellText),
      retailBanner: pictureUrl(content["retail.banner"], bridges),
    },
    bundle: {
      ...bundle,
      name: get("bundle.name", bundle.name),
      tagline: get("bundle.tagline", bundle.tagline),
      blurb: get("bundle.blurb", bundle.blurb),
      buddyPrice: get("bundle.buddyPrice", bundle.buddyPrice),
      when: get("bundle.when", bundle.when),
      howItWorks:
        content["bundle.howItWorks"] !== undefined ? lines(content["bundle.howItWorks"]) : bundle.howItWorks,
      note: get("bundle.note", bundle.note),
      art: pictureUrl(content["bundle.art"], ""),
    },
    notice: noticeText
      ? {
          text: noticeText,
          link: orNone(content["notice.link"]?.trim()) ?? null,
          align: pick(NOTICE_ALIGNS, content["notice.align"], "center"),
          spacing: pick(NOTICE_SPACINGS, content["notice.spacing"], "regular"),
        }
      : null,
    team: team.map((m) => {
      const k = (f: string) => content[`team.${m.id}.${f}`];
      return {
        ...m,
        name: k("name") ?? m.name,
        role: k("role") ?? m.role,
        beard: k("beard") ?? m.beard,
        bio: k("bio") ?? m.bio,
        story: k("story") !== undefined ? paragraphs(k("story")!) : m.story,
        art: pictureUrl(k("photo"), m.art ?? "") || undefined,
      };
    }),
    games: games.map((g) => {
      const k = (f: string) => content[`game.${g.slug}.${f}`];
      const has = (f: string) => k(f) !== undefined;
      return {
        ...g,
        status: (k("status") as GameStatus | undefined) ?? g.status,
        when: has("when") ? orNone(k("when")) : g.when,
        badge: has("badge") ? orNone(k("badge")) : g.badge,
        tagline: k("tagline") ?? g.tagline,
        blurb: k("blurb") ?? g.blurb,
        story: has("story") ? paragraphs(k("story")!) : g.story,
        facts: has("facts") ? lines(k("facts")!) : g.facts,
        designer: has("designer") ? orNone(k("designer")) : g.designer,
        artist: has("artist") ? orNone(k("artist")) : g.artist,
        art: pictureUrl(k("art"), g.art),
      };
    }),
  };
}

/** The ids @bearded/store-core knows must be the site's own, or the editor would offer the wrong fields. */
export const editableIdsMatch = () =>
  SITE_GAMES.map((g) => g.slug).join() === games.map((g) => g.slug).join() &&
  SITE_TEAM.map((m) => m.id).join() === team.map((m) => m.id).join();
