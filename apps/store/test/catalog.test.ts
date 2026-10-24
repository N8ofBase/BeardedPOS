import { describe, expect, it } from "vitest";
import {
  formatCents,
  matchKey,
  missingItems,
  stockLabel,
  stockStatus,
  storeProducts,
  type SquareCatalog,
  type SquareItem,
} from "../src/catalog/catalog.ts";
import snapshot from "../src/catalog/square-snapshot.json";
import { extraItems, games, lowStockAt } from "../src/content/site.ts";

const item = (over: Partial<SquareItem>): SquareItem => ({
  itemId: "I1",
  variationId: "V1",
  name: "Locked Out",
  variationName: "Regular",
  productType: "REGULAR",
  priceCents: 2000,
  tracksStock: false,
  stock: null,
  imageUrl: null,
  ...over,
});
const catalog = (...items: SquareItem[]): SquareCatalog => ({
  capturedAt: "2026-10-24T00:00:00Z",
  locationId: "L1",
  currency: "USD",
  items,
});

describe("store products from the Square catalog", () => {
  it("shows only items listed in the store content, in listed order", () => {
    const products = storeProducts(
      catalog(
        item({ itemId: "A", variationId: "VA", name: "Math Force 5" }),
        item({ itemId: "B", variationId: "VB", name: "Locked Out" }),
        item({ itemId: "C", variationId: "VC", name: "Fences" }),
      ),
    );
    expect(products.map((p) => p.name)).toEqual(["Fences", "Locked Out"]);
  });

  it("checkout ids are Square variation ids", () => {
    const [p] = storeProducts(catalog(item({ itemId: "ITEM", variationId: "VAR" })));
    expect(p).toMatchObject({ id: "VAR", itemId: "ITEM", game: "locked-out", kind: "game" });
  });

  it("matches names ignoring case, spacing and dash style", () => {
    expect(matchKey("Fences 5-6  Player expansion")).toBe(matchKey("Fences 5–6 Player Expansion"));
    const [p] = storeProducts(catalog(item({ name: "fences 5-6 player expansion" })));
    expect(p?.game).toBe("fences");
    expect(p?.kind).toBe("expansion");
  });

  it("uses the store's display name where one is set", () => {
    const [p] = storeProducts(catalog(item({ name: "Mine Find" })));
    expect(p?.name).toBe("Mine & Find (Pre-order)");
  });

  it("keeps prices in integer cents and skips items without a fixed price", () => {
    const products = storeProducts(
      catalog(
        item({ variationId: "V1", priceCents: 2000 }),
        item({ itemId: "I2", variationId: "V2", name: "Fences", priceCents: null }),
        item({ itemId: "I3", variationId: "V3", name: "Fences: Seasons", priceCents: 4.5 }),
      ),
    );
    expect(products.map((p) => p.priceCents)).toEqual([2000]);
  });

  it("names each variation when an item has several", () => {
    const products = storeProducts(
      catalog(
        item({ variationId: "V1", variationName: "Regular" }),
        item({ variationId: "V2", variationName: "Signed", priceCents: 2500 }),
      ),
    );
    expect(products.map((p) => p.name)).toEqual(["Locked Out (Regular)", "Locked Out (Signed)"]);
  });

  it("ignores stock counts Square isn't tracking", () => {
    const [p] = storeProducts(catalog(item({ tracksStock: false, stock: 3 })));
    expect(p?.stock).toBeNull();
    expect(p?.stockStatus).toBe("untracked");
  });
});

describe("stock", () => {
  it("is low at or below the threshold and sold out at zero", () => {
    expect(stockStatus(null)).toBe("untracked");
    expect(stockStatus(0)).toBe("sold-out");
    expect(stockStatus(-2)).toBe("sold-out");
    expect(stockStatus(lowStockAt)).toBe("low");
    expect(stockStatus(lowStockAt + 1)).toBe("in-stock");
  });

  it("labels what a shopper needs to know", () => {
    const [p] = storeProducts(catalog(item({ tracksStock: true, stock: 2 })));
    expect(stockLabel(p!)).toBe("Only 2 left");
    const [q] = storeProducts(catalog(item({ tracksStock: true, stock: 0 })));
    expect(stockLabel(q!)).toBe("Sold out");
    const [r] = storeProducts(catalog(item({ name: "Pack Lash VIP Reservation" })));
    expect(stockLabel(r!)).toBe("Pre-order");
  });
});

describe("money", () => {
  it("formats cents for display", () => {
    expect(formatCents(2500)).toBe("$25");
    expect(formatCents(850)).toBe("$8.50");
    expect(formatCents(50)).toBe("$0.50");
    expect(formatCents(123456)).toBe("$1,234.56");
  });
});

describe("the saved Square snapshot", () => {
  const snap = snapshot as SquareCatalog;

  it("has every item the store lists", () => {
    expect(missingItems(snap)).toEqual([]);
  });

  it("gives every listed item a product", () => {
    const listed = [...games.flatMap((g) => g.items), ...extraItems].length;
    expect(storeProducts(snap)).toHaveLength(listed);
  });

  it("keeps Prism Cortex-only items and donations off the store", () => {
    const names = storeProducts(snap).map((p) => p.name);
    expect(names).not.toContain("Math Force 5");
    expect(names).not.toContain("Donation");
    expect(names.some((n) => n.includes("Market"))).toBe(false);
  });
});
