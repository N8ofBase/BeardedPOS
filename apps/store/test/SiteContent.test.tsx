// Site content: staff change words and pictures in Behind the Beard, and the site shows what they publish.
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { siteFields, type SiteContent, type StaffSite } from "@bearded/store-core";
import { buildSite, editableIdsMatch, originals } from "../src/content/editable.ts";
import { about, brand, games, team } from "../src/content/site.ts";
import { PREVIEW_KEY } from "../src/content/SiteProvider.tsx";
import { fakeStore, realServer, renderStore } from "./render.tsx";

vi.setConfig({ testTimeout: 20_000 });

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(cleanup);

const published = (content: SiteContent) => ({ site: async () => ({ content, publishedAt: null }) });

describe("site content rules", () => {
  it("offers a field for exactly the games and people on the site", () => {
    expect(editableIdsMatch()).toBe(true);
    expect(Object.keys(originals()).sort()).toEqual([...siteFields.keys()].sort());
  });

  it("with nothing published, the site is the original wording", () => {
    const site = buildSite({});
    expect(site.games).toEqual(games);
    expect(site.team).toEqual(team);
    expect(site.about).toBe(about);
    expect(site.brand).toEqual(brand);
    expect(site.notice).toBeNull();
  });

  it("an empty optional field hides that part, and paragraphs split on blank lines", () => {
    const site = buildSite({
      "game.fences.badge": "",
      "game.fences.story": "First.\n\nSecond.",
      "game.fences.facts": "2–6 players\n\n40 min\n",
    });
    const fences = site.games.find((g) => g.slug === "fences")!;
    expect(fences.badge).toBeUndefined();
    expect(fences.story).toEqual(["First.", "Second."]);
    expect(fences.facts).toEqual(["2–6 players", "40 min"]);
  });
});

describe("the site with published content", () => {
  it("shows the new headline, the announcement and a game's changes", async () => {
    renderStore(
      "/",
      published({
        "hero.title": "Roll for it.",
        "notice.text": "Closed Thanksgiving Day.",
        "notice.link": "/shop",
        "game.fences.tagline": "Sheep. Fences. Feelings.",
        "game.locked-out.status": "coming-soon",
      }),
    );
    expect(await screen.findByRole("heading", { level: 1, name: "Roll for it." })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Closed Thanksgiving Day." }).getAttribute("href")).toBe("/shop");
    expect(screen.getByText("Sheep. Fences. Feelings.")).toBeTruthy();
    const lockedOut = document.getElementById("game-locked-out")!;
    expect(within(lockedOut).getByText("Coming soon")).toBeTruthy();
  });

  it("keeps the original wording when the server can't be reached", async () => {
    renderStore("/", { site: () => Promise.reject(new Error("offline")) });
    expect(screen.getByRole("heading", { level: 1, name: brand.motto })).toBeTruthy();
  });

  it("shows staff the draft in preview, with a bar that says so", async () => {
    const draft = { "hero.title": "Draft headline." };
    const base = fakeStore(published({ "hero.title": "Live headline." }));
    renderStore("/?preview=draft", {
      ...base,
      staff: { ...base.staff, site: async () => ({ draft, published: {} }) as unknown as StaffSite },
    });
    expect(await screen.findByRole("heading", { level: 1, name: "Draft headline." })).toBeTruthy();
    expect(screen.getByText(/Only you see this/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Stop previewing" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Live headline." })).toBeTruthy();
    expect(sessionStorage.getItem(PREVIEW_KEY)).toBeNull();
  });

  it("drops preview for someone who isn't signed in as staff", async () => {
    sessionStorage.setItem(PREVIEW_KEY, "draft");
    renderStore("/", published({ "hero.title": "Live headline." }));
    expect(await screen.findByRole("heading", { level: 1, name: "Live headline." })).toBeTruthy();
    expect(screen.queryByText(/Only you see this/)).toBeNull();
  });
});

async function signIn(email = "adam@beardedboardgames.com") {
  fireEvent.change(await screen.findByLabelText("Work email"), { target: { value: email } });
  fireEvent.click(screen.getByRole("button", { name: "Email me a code" }));
  const code = (await screen.findByText(/here is the code/)).querySelector("strong")!.textContent!;
  fireEvent.change(screen.getByLabelText("Code"), { target: { value: code } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  await screen.findByText(email);
}

describe("Behind the Beard: Site content", () => {
  it("saves a draft, publishes it, and the live site shows it", async () => {
    const { store } = await realServer();
    const staff = renderStore("/behind-the-beard", store);
    await signIn();
    fireEvent.click(screen.getByRole("tab", { name: "Site content" }));
    expect(await screen.findByText(/the original wording/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Part of the site"), { target: { value: "hero" } });

    const headline = screen.getByLabelText("Big headline") as HTMLInputElement;
    expect(headline.value).toBe(brand.motto);
    fireEvent.change(headline, { target: { value: "" } });
    expect(screen.getAllByText(/Big headline can’t be empty/).length).toBeGreaterThan(0);
    expect((screen.getByRole("button", { name: "Save draft" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(headline, { target: { value: "Games build bridges." } });
    expect(screen.getByText("1 change not live yet, some not saved.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(await screen.findByText("Draft saved. Shoppers don’t see it yet.")).toBeTruthy();

    // Not live yet.
    expect((await store.site()).content).toEqual({});

    fireEvent.click(screen.getByRole("button", { name: "Publish…" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, publish" }));
    expect(await screen.findByText(/^Published\./)).toBeTruthy();
    expect(screen.getByText(/the same as the live site/)).toBeTruthy();
    expect(screen.getByText(/\(live now\)/)).toBeTruthy();
    staff.unmount();

    renderStore("/", store);
    expect(await screen.findByRole("heading", { level: 1, name: "Games build bridges." })).toBeTruthy();
  });

  it("puts a field back to the original wording", async () => {
    const { store } = await realServer();
    renderStore("/behind-the-beard", store);
    await signIn();
    fireEvent.click(screen.getByRole("tab", { name: "Site content" }));
    fireEvent.change(await screen.findByLabelText("Part of the site"), { target: { value: "game-fences" } });
    const tagline = screen.getByLabelText("Tagline") as HTMLInputElement;
    const original = tagline.value;
    fireEvent.change(tagline, { target: { value: "Sheep drama." } });
    fireEvent.click(screen.getByRole("button", { name: "Use the original" }));
    await waitFor(() => expect((screen.getByLabelText("Tagline") as HTMLInputElement).value).toBe(original));
    expect(screen.getByText("the same as the live site.", { exact: false })).toBeTruthy();
  });
});
