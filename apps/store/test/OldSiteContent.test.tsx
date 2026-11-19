// What the team kept from the old Squarespace site, in its new places.
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildSite } from "../src/content/editable.ts";
import { renderStore } from "./render.tsx";

beforeEach(() => localStorage.clear());
afterEach(cleanup);

const section = (name: string) => screen.getByRole("heading", { level: 2, name }).closest("section")!;

describe("game pages", () => {
  it("shows the Fences photos, reviewer quotes and free downloads", async () => {
    renderStore("/games/fences");
    await screen.findByRole("heading", { level: 1, name: "Fences" });
    const photos = screen.getByRole("list", { name: "Fences photos" });
    expect(within(photos).getAllByRole("img")).toHaveLength(5);
    expect(within(photos).getByText("Photo by Daniel Blackbourne")).toBeTruthy();

    const press = section("What reviewers say");
    expect(within(press).getByText("The Farmer Profile is where it’s at.")).toBeTruthy();
    expect(within(press).getByRole("link", { name: "Father Geek" }).getAttribute("href")).toBe(
      "https://fathergeek.com/fences/",
    );
    expect(within(press).getByRole("link", { name: "Meeple Mountain" })).toBeTruthy();

    const files = section("Free downloads");
    // Served from this site, so they keep working after Squarespace is cancelled.
    for (const a of within(files).getAllByRole("link"))
      expect(a.getAttribute("href")).toMatch(/^\/old-site\/.+\.pdf$/);
    expect(within(files).getByRole("link", { name: "Black-and-white print and play" })).toBeTruthy();
  });

  it("shows the Locked Out cards and Pack Lash photos", async () => {
    renderStore("/games/locked-out");
    await screen.findByRole("heading", { level: 1, name: "Locked Out" });
    expect(within(screen.getByRole("list", { name: "Locked Out photos" })).getAllByRole("img")).toHaveLength(
      7,
    );
    cleanup();
    renderStore("/games/pack-lash");
    await screen.findByRole("heading", { level: 1, name: "Pack Lash" });
    expect(within(screen.getByRole("list", { name: "Pack Lash photos" })).getAllByRole("img")).toHaveLength(
      10,
    );
  });

  it("links Soccer Blocker to its rules sheet at the old address", async () => {
    renderStore("/games/soccer-blocker");
    await screen.findByRole("heading", { level: 1, name: "Soccer Blocker" });
    expect(screen.getByRole("link", { name: "Rules sheet" }).getAttribute("href")).toBe("/soccerblocker");
  });
});

describe("old addresses", () => {
  it("keeps /soccerblocker as the rules sheet, for QR codes on boxes", () => {
    renderStore("/soccerblocker");
    expect(screen.getByRole("heading", { level: 1, name: "Soccer Blocker rules" })).toBeTruthy();
    expect(screen.getByAltText("Soccer Blocker rules, front of the sheet")).toBeTruthy();
    expect(screen.getByAltText("Soccer Blocker rules, back of the sheet")).toBeTruthy();
  });

  it("sends /adam-collins and /nate-sloan to their own pages", async () => {
    renderStore("/adam-collins");
    expect(await screen.findByRole("heading", { level: 1, name: "Adam Collins" })).toBeTruthy();
    expect(screen.getByText(/Project Manager at a local university/)).toBeTruthy();
    cleanup();
    renderStore("/nate-sloan");
    expect(await screen.findByRole("heading", { level: 1, name: "Nate “N8” Sloan" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Hear N8’s board game songs" }).getAttribute("href")).toBe(
      "/videos",
    );
  });
});

describe("the beards", () => {
  it("links a card to its own page only when there's a full bio", () => {
    renderStore("/");
    const beards = document.getElementById("beards")!;
    expect(within(beards).getByRole("link", { name: "More about Adam" }).getAttribute("href")).toBe(
      "/beards/adam",
    );
    expect(within(beards).getByRole("link", { name: "More about Nate" })).toBeTruthy();
    expect(within(beards).queryByRole("link", { name: "More about Tim" })).toBeNull();
  });

  it("has no page for someone without a full bio", () => {
    renderStore("/beards/tim");
    expect(screen.getByRole("heading", { name: "Rolled a 1." })).toBeTruthy();
  });

  it("takes a full bio from Site content, and an empty one removes the page", () => {
    const site = buildSite({ "team.tim.story": "One.\n\nTwo.", "team.adam.story": "" });
    expect(site.team.find((m) => m.id === "tim")!.story).toEqual(["One.", "Two."]);
    expect(site.team.find((m) => m.id === "adam")!.story).toEqual([]);
  });
});

describe("footer and wholesale", () => {
  it("shows the GAMA badge and the Indie Game Alliance link on every page", () => {
    renderStore("/shop");
    expect(screen.getByAltText("GAMA member")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Indie Game Alliance" }).getAttribute("href")).toBe(
      "https://www.indiegamealliance.com/",
    );
  });

  it("shows a picture for each game's sell sheet", () => {
    renderStore("/wholesale");
    const sheets = section("Sell sheets");
    expect(within(sheets).getAllByRole("img")).toHaveLength(4);
    expect(within(sheets).getByRole("link", { name: /Soccer Blocker sell sheet/ })).toBeTruthy();
  });
});
