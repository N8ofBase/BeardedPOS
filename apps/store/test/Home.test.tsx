import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoreApi } from "../src/api/store.ts";
import { brand, games, videos } from "../src/content/site.ts";
import { renderStore } from "./render.tsx";

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
    expect(shelfNames()).toEqual(["Soccer Blocker", "Mine & Find"]);
    fireEvent.click(within(shelf()).getByRole("button", { name: "Coming soon" }));
    expect(shelfNames()).toEqual(["Pack Lash", "Fences: The Roll & Write"]);
    expect(within(shelf()).getByRole("button", { name: "Coming soon" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    fireEvent.click(within(shelf()).getByRole("button", { name: "All" }));
    expect(shelfNames()).toHaveLength(games.length);
  });

  it("lists the games for sale with prices from Square", async () => {
    renderHome();
    const shop = document.getElementById("shop")!;
    await within(shop).findByText("Soccer Blocker Version Zero (Limited)");
    expect(within(shop).getByText("Mine & Find (Pre-order)")).toBeTruthy();
    expect(within(shop).queryByText("Math Force 5")).toBeNull();
    const sb = within(shop).getByText("Soccer Blocker Version Zero (Limited)").closest("article")!;
    expect(within(sb).getByText("$30")).toBeTruthy();
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

describe("VIP signup", () => {
  it("joins with a valid email and shows the code", async () => {
    const joinVip = vi.fn(async () => {});
    renderHome({ joinVip });
    fireEvent.change(screen.getByLabelText("Join the VIP list"), { target: { value: " sam@example.com " } });
    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    expect(await screen.findByText(brand.vipThanks)).toBeTruthy();
    expect(joinVip).toHaveBeenCalledWith("sam@example.com", "band");
  });

  it("catches a mistyped email before sending it", () => {
    const joinVip = vi.fn(async () => {});
    renderHome({ joinVip });
    fireEvent.change(screen.getByLabelText("Join the VIP list"), { target: { value: "sam@example" } });
    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    expect(screen.getByText(/Check the email address/)).toBeTruthy();
    expect(joinVip).not.toHaveBeenCalled();
  });

  it("lets the visitor try again when the signup fails", async () => {
    renderHome({ joinVip: () => Promise.reject(new Error("down")) });
    fireEvent.change(screen.getByLabelText("Join the VIP list"), { target: { value: "sam@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    await waitFor(() => expect(screen.getByText(/didn’t go through/)).toBeTruthy());
    expect(screen.getByRole("button", { name: "Join" })).toBeTruthy();
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

describe("other pages", () => {
  it("shows a friendly page for a bad link", () => {
    renderHome({}, "/nope");
    expect(screen.getByRole("heading", { name: "Rolled a 1." })).toBeTruthy();
  });
});
