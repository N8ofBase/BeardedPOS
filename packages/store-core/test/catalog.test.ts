import { describe, expect, it } from "vitest";
import {
  formatCents,
  matchKey,
  missingItems,
  placeItem,
  stockLabel,
  stockStatus,
  storeProducts,
  type SquareCatalog,
  type SquareItem,
} from "../src/catalog.ts";
import { lowStockAt } from "../src/listing.ts";

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
  everyItem: true,
});

describe("store products from the Square catalog", () => {
  it("shows every Square item: listed ones first in listed order, then the rest by name", () => {
    const products = storeProducts(
      catalog(
        item({ itemId: "A", variationId: "VA", name: "Math Force 5" }),
        item({ itemId: "B", variationId: "VB", name: "Locked Out" }),
        item({ itemId: "D", variationId: "VD", name: "Beard Hat" }),
        item({ itemId: "C", variationId: "VC", name: "Fences" }),
      ),
    );
    expect(products.map((p) => p.name)).toEqual(["Fences", "Locked Out", "Beard Hat", "Math Force 5"]);
  });

  it("shows only listed items when the catalog isn't the shop's own (the Sandbox demo)", () => {
    const products = storeProducts({
      ...catalog(
        item({ itemId: "A", variationId: "VA", name: "Math Force 5" }),
        item({ itemId: "B", variationId: "VB", name: "Locked Out" }),
      ),
      everyItem: false,
    });
    expect(products.map((p) => p.name)).toEqual(["Locked Out"]);
  });

  it("keeps sold-out items, marked sold out", () => {
    const [p] = storeProducts(catalog(item({ name: "Fences", tracksStock: true, stock: 0 })));
    expect(p).toMatchObject({ game: "fences", kind: "game", stockStatus: "sold-out" });
    expect(stockLabel(p!)).toBe("Sold out");
  });

  it("leaves out hidden items, donations and other non-goods", () => {
    const products = storeProducts(
      catalog(
        item({ itemId: "A", variationId: "VA", name: "Soccer Blocker Version Zero Limited Edition" }),
        item({ itemId: "B", variationId: "VB", name: "Donation", productType: "DONATION" }),
        item({ itemId: "C", variationId: "VC", name: "Gift card", productType: "GIFT_CARD" }),
        item({ itemId: "D", variationId: "VD", name: "Fences PDF", productType: "DIGITAL" }),
      ),
    );
    expect(products.map((p) => p.name)).toEqual(["Fences PDF"]);
  });

  it("puts unlisted items on a game when the name starts with the game's name", () => {
    const products = storeProducts(
      catalog(
        item({ itemId: "A", variationId: "VA", name: "Fences: Holiday Pack" }),
        item({ itemId: "B", variationId: "VB", name: "Fences Board Game" }),
        item({ itemId: "C", variationId: "VC", name: "Fences T-Shirt" }),
        item({ itemId: "D", variationId: "VD", name: "Mine and Find" }),
        item({ itemId: "E", variationId: "VE", name: "Fencesitter" }),
        item({ itemId: "F", variationId: "VF", name: "Fences Roll & Write" }),
      ),
    );
    const by = Object.fromEntries(products.map((p) => [p.name, [p.game, p.kind]]));
    expect(by).toEqual({
      "Fences: Holiday Pack": ["fences", "expansion"],
      "Fences Board Game": ["fences", "game"],
      "Fences T-Shirt": ["fences", "merch"],
      "Mine and Find": ["mine-and-find", "game"],
      Fencesitter: [null, "merch"],
      "Fences Roll & Write": ["fences-roll-and-write", "game"],
    });
  });

  it("places other unlisted items by Square category, then by name", () => {
    expect(placeItem("Dragon Dice", "Games")).toMatchObject({ kind: "game", game: null });
    expect(placeItem("Big Box", "Expansions")).toMatchObject({ kind: "expansion", game: null });
    expect(placeItem("Logo Hoodie", null)).toMatchObject({ kind: "merch", game: null });
    expect(placeItem("Anything", "Apparel")).toMatchObject({ kind: "merch" });
    expect(placeItem("Jibe", "Card Games")).toMatchObject({ kind: "game" });
    expect(placeItem("Space Card Game", null)).toMatchObject({ kind: "game" });
    expect(placeItem("Mystery thing", null)).toMatchObject({ kind: "merch" });
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

describe("missingItems", () => {
  it("lists store items Square doesn't have, ignoring dash style", () => {
    const missing = missingItems(
      catalog(item({ name: "Locked Out" }), item({ name: "Fences 5-6 Player Expansion" })),
    );
    expect(missing).not.toContain("Locked Out");
    expect(missing).not.toContain("Fences 5–6 Player Expansion");
    expect(missing).toContain("Jibe Card Game");
  });
});
