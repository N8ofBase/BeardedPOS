import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoreApi } from "../src/api/store.ts";
import { games, videos } from "../src/content/site.ts";
import { fakeAccount, fakeStore, renderStore } from "./render.tsx";

afterEach(cleanup);

function renderHome(store: Partial<StoreApi> = {}, path = "/") {
  localStorage.clear();
  return renderStore(path, store);
}

const shelf = () => document.getElementById("games")!;
const shelfNames = () =>
  within(shelf())
    .getAllByRole("heading", { level: 3 })
    .map((h) => h.textContent);

describe("home page", () => {
  it("shows every game on the shelf with box art and alt text", () => {
    renderHome();
    expect(shelfNames()).toEqual(games.map((g) => g.name));
    for (const g of games) expect(within(shelf()).getByAltText(`${g.name} box art`)).toBeTruthy();
  });

  it("filters the shelf by Out now, Pre-order and Coming soon", () => {
    renderHome();
    fireEvent.click(within(shelf()).getByRole("button", { name: "Out now" }));
    expect(shelfNames()).toEqual(["Fences", "Locked Out"]);
    fireEvent.click(within(shelf()).getByRole("button", { name: "Pre-order" }));
    expect(shelfNames()).toEqual(["Mine & Find"]);
    fireEvent.click(within(shelf()).getByRole("button", { name: "Coming soon" }));
    expect(shelfNames()).toEqual(["Soccer Blocker", "Pack Lash", "Fences: The Roll & Write"]);
    expect(within(shelf()).getByRole("button", { name: "Coming soon" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    fireEvent.click(within(shelf()).getByRole("button", { name: "All" }));
    expect(shelfNames()).toHaveLength(games.length);
  });

  it("says Coming 2027 for Fences: The Roll & Write", () => {
    renderHome();
    const card = document.getElementById("game-fences-roll-and-write")!;
    expect(within(card).getByText("Coming 2027", { selector: ".tag" })).toBeTruthy();
    expect(within(card).queryByText("Coming soon", { selector: ".tag" })).toBeNull();
  });

  it("lists the games for sale with prices from Square", async () => {
    renderHome();
    const shop = document.getElementById("shop")!;
    await within(shop).findByRole("heading", { name: "Locked Out" });
    expect(within(shop).getByText("Mine & Find (Pre-order)")).toBeTruthy();
    expect(within(shop).queryByText("Math Force 5")).toBeNull();
    expect(within(shop).queryByText(/Version Zero/)).toBeNull();
    const lo = within(shop).getByRole("heading", { name: "Locked Out" }).closest("article")!;
    expect(within(lo).getByText("$20")).toBeTruthy();
  });

  it("says so when the shop can't load", async () => {
    renderHome({ catalog: () => Promise.reject(new Error("down")) });
    expect(await screen.findByText(/couldn’t load the shop/)).toBeTruthy();
  });

  it("rolls the d20 and announces the result", async () => {
    vi.useFakeTimers();
    try {
      renderHome();
      fireEvent.click(screen.getByRole("button", { name: /Roll the die/ }));
      await act(async () => {
        vi.advanceTimersByTime(700);
      });
      expect(document.getElementById("roll-result")!.textContent).not.toContain("Tap it to roll");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Beard Buddy band", () => {
  const buddy = (over: Partial<StoreApi["buddy"]>) => ({ ...fakeStore().buddy, ...over });
  const band = () => document.getElementById("buddy")!;

  it("signs up with an email code and shows the welcome Bucks", async () => {
    const requestCode = vi.fn(async () => ({ sent: true as const, devCode: "123456" }));
    const signIn = vi.fn(async () => fakeAccount({ balance: 100, welcomeBucks: 100 }));
    renderHome({ buddy: buddy({ requestCode, signIn }) });
    expect(within(band()).getByRole("heading", { name: "Join Beard Buddy. Get $5 off now." })).toBeTruthy();
    fireEvent.change(within(band()).getByLabelText("Email"), { target: { value: " sam@example.com " } });
    fireEvent.click(within(band()).getByRole("button", { name: "Email me a code" }));
    fireEvent.change(await within(band()).findByLabelText("Code"), { target: { value: "123456" } });
    fireEvent.click(within(band()).getByRole("button", { name: "Sign in" }));
    expect(await within(band()).findByText(/You’re a Beard Buddy with 100 Beard Bucks/)).toBeTruthy();
    expect(requestCode).toHaveBeenCalledWith("sam@example.com");
    expect(signIn).toHaveBeenCalledWith("sam@example.com", "123456");
  });

  it("catches a mistyped email before sending it", () => {
    const requestCode = vi.fn(async () => ({ sent: true as const }));
    renderHome({ buddy: buddy({ requestCode }) });
    fireEvent.change(within(band()).getByLabelText("Email"), { target: { value: "sam@example" } });
    fireEvent.click(within(band()).getByRole("button", { name: "Email me a code" }));
    expect(within(band()).getByText(/Check the email address/)).toBeTruthy();
    expect(requestCode).not.toHaveBeenCalled();
  });

  it("lets the visitor try again when sending the code fails", async () => {
    renderHome({ buddy: buddy({ requestCode: () => Promise.reject(new Error("down")) }) });
    fireEvent.change(within(band()).getByLabelText("Email"), { target: { value: "sam@example.com" } });
    fireEvent.click(within(band()).getByRole("button", { name: "Email me a code" }));
    await waitFor(() => expect(within(band()).getByText(/didn’t go through/)).toBeTruthy());
    expect(within(band()).getByRole("button", { name: "Email me a code" })).toBeTruthy();
  });

  it("shows a signed-in shopper their Bucks instead of the form", async () => {
    renderHome({ buddy: buddy({ account: async () => fakeAccount({ balance: 240 }) }) });
    expect(await within(band()).findByText(/You’re a Beard Buddy with 240 Beard Bucks/)).toBeTruthy();
    expect(within(band()).queryByLabelText("Email")).toBeNull();
  });
});

describe("videos", () => {
  it("plays N8's songs on the home page and links to the Videos page", () => {
    renderHome();
    const songs = document.getElementById("songs")!;
    for (const v of videos.slice(0, 3)) {
      const player = within(songs).getByLabelText(new RegExp(`^${v.title}, \\d+:\\d\\d$`));
      expect(player.getAttribute("src")).toBe(v.src);
      expect(player.getAttribute("preload")).toBe("none");
    }
    fireEvent.click(within(songs).getByRole("link", { name: "All the videos" }));
    expect(screen.getByRole("heading", { level: 1, name: "Songs from the shop." })).toBeTruthy();
  });

  it("lists every song on /videos, each with its own anchor for the d20 to link to", () => {
    renderHome({}, "/videos");
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(
      videos.map((v) => v.title),
    );
    for (const v of videos) expect(document.getElementById(v.slug)?.querySelector("video")).toBeTruthy();
    expect(screen.getByLabelText("My Games, 1:04")).toBeTruthy();
  });

  it("pauses the other songs when one starts", () => {
    renderHome({}, "/videos");
    const players = [...document.querySelectorAll<HTMLVideoElement>("video.song")];
    const paused = players.map((p) => vi.spyOn(p, "pause").mockImplementation(() => {}));
    fireEvent.play(players[1]!);
    expect(paused.map((p) => p.mock.calls.length)).toEqual([1, 0, 1]);
  });

  it("has a Videos link in the main menu", () => {
    renderHome();
    const nav = screen.getByRole("navigation", { name: "Main" });
    fireEvent.click(within(nav).getByRole("link", { name: "Videos" }));
    expect(screen.getByRole("heading", { level: 1, name: "Songs from the shop." })).toBeTruthy();
  });
});

describe("old Squarespace links", () => {
  it("land on the matching new page", async () => {
    renderHome({}, "/mine-find");
    expect(await screen.findByRole("heading", { level: 1, name: "Mine & Find" })).toBeTruthy();
    cleanup();
    renderHome({}, "/for-retailers");
    expect(screen.queryByRole("heading", { name: "Rolled a 1." })).toBeNull();
  });
});

describe("other pages", () => {
  it("shows a friendly page for a bad link", () => {
    renderHome({}, "/nope");
    expect(screen.getByRole("heading", { name: "Rolled a 1." })).toBeTruthy();
  });
});
