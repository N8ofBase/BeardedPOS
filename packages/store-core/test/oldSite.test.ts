import { describe, expect, it } from "vitest";
import { gameSlugs, oldSite, oldSiteItemIds, oldSiteRedirect, oldSiteRedirects } from "../src/index.ts";

describe("old Squarespace site", () => {
  it("gives every item its own id", () => {
    const ids = oldSite.flatMap((p) => p.items.map((i) => i.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(oldSiteItemIds.size).toBe(ids.length);
  });

  it("sends each old game page to its new one", () => {
    for (const to of Object.values(oldSiteRedirects).filter((t) => t.startsWith("/games/")))
      expect(gameSlugs).toContain(to.slice("/games/".length));
    expect(oldSiteRedirect("/mine-find")).toBe("/games/mine-and-find");
    expect(oldSiteRedirect("/For-Retailers/")).toBe("/wholesale");
    expect(oldSiteRedirect("/shop/locked-out")).toBe("/games/locked-out");
    expect(oldSiteRedirect("/nowhere")).toBeUndefined();
  });

  it("lists every page from the old site's map", () => {
    const listed = new Set(oldSite.map((p) => p.path));
    for (const path of Object.keys(oldSiteRedirects).filter((p) => !p.startsWith("/shop/")))
      expect(listed.has(path) || ["/home", "/home-alt-bedford", "/ushabti-1"].includes(path)).toBe(true);
  });
});
