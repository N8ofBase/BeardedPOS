// The Bearded Bundle page: the games inside, the price from Square and the pre-order button.
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadSnapshot } from "@bearded/store-api";
import type { SquareCatalog } from "@bearded/store-core";
import { CART_KEY } from "../src/cart/CartProvider.tsx";
import { renderStore } from "./render.tsx";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  // Pre-orders are open (they open Saturday, Nov 28, 2026).
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-28T10:00:00-06:00"));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const BUNDLE_ID = "QQP3FQLB2ZSUOTOHHZYTKSN3";

function withBundle(): SquareCatalog {
  const catalog = loadSnapshot();
  catalog.items.push({
    itemId: "COKAOJBTWQB3UHZQTUF625ZE",
    variationId: BUNDLE_ID,
    name: "Bearded Bundle(pre-order)",
    variationName: "Regular",
    productType: "REGULAR",
    priceCents: 5000,
    tracksStock: false,
    stock: null,
    imageUrl: "https://example.com/bundle.png",
  });
  return catalog;
}

describe("Bearded Bundle page", () => {
  it("describes each game, shows Square's price and pre-orders into the cart", async () => {
    renderStore("/bundle", { catalog: async () => withBundle() });
    expect(screen.getByRole("heading", { level: 1, name: "The Bearded Bundle" })).toBeTruthy();
    for (const name of ["Soccer Blocker", "Mine & Find", "Pack Lash"])
      expect(screen.getByRole("heading", { level: 3, name })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "How pre-orders work" })).toBeTruthy();
    const button = await screen.findByRole("button", { name: "Pre-order Bearded Bundle (Pre-order)" });
    const price = document.querySelector(".bundle-buy .price")!.textContent;
    expect(price).toContain("$50");
    expect(price).toContain("$45 for Beard Buddies with 200 Bucks");
    fireEvent.click(button);
    const drawer = screen.getByRole("dialog", { name: "Your cart" });
    expect(within(drawer).getByText("Bearded Bundle (Pre-order)", { selector: "strong" })).toBeTruthy();
    expect(JSON.parse(localStorage.getItem(CART_KEY)!)).toEqual([{ productId: BUNDLE_ID, qty: 1 }]);
  });

  it("shows the bundle but keeps the button off until pre-orders open", async () => {
    vi.setSystemTime(new Date("2026-11-27T23:59:00-06:00"));
    renderStore("/bundle", { catalog: async () => withBundle() });
    const button = await screen.findByRole("button", {
      name: "Bearded Bundle (Pre-order): Opens Saturday, Nov 28",
    });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.textContent).toBe("Opens Saturday, Nov 28");
  });

  it("says pre-orders aren't open when Square has no bundle", async () => {
    renderStore("/bundle");
    expect(await screen.findByText(/Pre-orders aren’t open yet/)).toBeTruthy();
  });

  it("shows the wording staff publish", async () => {
    renderStore("/bundle", {
      catalog: async () => withBundle(),
      site: async () => ({
        content: {
          "bundle.tagline": "Three games, one bow on top.",
          "bundle.howItWorks": "Pay now.\nShips in December.",
          "bundle.when": "",
        },
        publishedAt: null,
      }),
    });
    expect(await screen.findByText("Three games, one bow on top.")).toBeTruthy();
    expect(screen.getByText("Ships in December.")).toBeTruthy();
    await screen.findByRole("button", { name: /^Pre-order/ });
    expect(document.querySelector(".bundle-buy .when")).toBeNull();
  });

  it("sits right after Fences in the shop and links to its page", async () => {
    renderStore("/shop", { catalog: async () => withBundle() });
    await screen.findByRole("link", { name: "See what’s inside" });
    const groups = screen.getAllByRole("heading", { level: 2 });
    const names = groups.map((h) => h.textContent);
    expect(names.indexOf("The Bearded Bundle")).toBe(names.indexOf("Fences") + 1);
    expect(screen.getByRole("link", { name: "See what’s inside" }).getAttribute("href")).toBe("/bundle");
  });
});

describe("Bearded Bundle on the home page", () => {
  it("sits just before the shelf with the games, Square's price and a link to the bundle page", async () => {
    vi.setSystemTime(new Date("2026-11-25T10:00:00-06:00"));
    renderStore("/", { catalog: async () => withBundle() });
    const band = document.getElementById("bundle")!;
    expect(band.nextElementSibling?.id).toBe("games");
    expect(within(band).getByRole("heading", { level: 2, name: "The Bearded Bundle" })).toBeTruthy();
    expect(band.textContent).toContain("Soccer Blocker, Mine & Find, Pack Lash");
    expect(await within(band).findByText(/\$45 for Beard Buddies/)).toBeTruthy();
    expect(within(band).getByText("Opens Saturday, Nov 28")).toBeTruthy();
    expect(within(band).getByRole("link", { name: "See what’s inside" }).getAttribute("href")).toBe(
      "/bundle",
    );
  });
});
