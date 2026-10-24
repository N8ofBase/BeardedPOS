import { describe, expect, it } from "vitest";
import type { Product } from "../src/catalog/catalog.ts";
import {
  addToCart,
  MAX_PER_LINE,
  maxQty,
  parseCart,
  removeFromCart,
  setQty,
  summarize,
} from "../src/cart/cart.ts";

const product = (over: Partial<Product> = {}): Product => ({
  id: "V1",
  itemId: "I1",
  name: "Locked Out",
  priceCents: 2000,
  kind: "game",
  game: "locked-out",
  stock: null,
  stockStatus: "untracked",
  imageUrl: null,
  ...over,
});

describe("cart", () => {
  it("adds, increases and removes lines", () => {
    const p = product();
    let lines = addToCart([], p);
    lines = addToCart(lines, p, 2);
    expect(lines).toEqual([{ productId: "V1", qty: 3 }]);
    lines = setQty(lines, p, 0);
    expect(lines).toEqual([]);
    expect(removeFromCart([{ productId: "V1", qty: 1 }], "V1")).toEqual([]);
  });

  it("keeps line order when a quantity changes", () => {
    const a = product({ id: "A" }),
      b = product({ id: "B" });
    const lines = setQty(addToCart(addToCart([], a), b), a, 4);
    expect(lines.map((l) => l.productId)).toEqual(["A", "B"]);
  });

  it("never holds more than Square has in stock", () => {
    const p = product({ stock: 2, stockStatus: "low" });
    expect(addToCart([], p, 5)).toEqual([{ productId: "V1", qty: 2 }]);
    expect(addToCart([], product({ stock: 0, stockStatus: "sold-out" }))).toEqual([]);
  });

  it("caps untracked items at the per-line limit", () => {
    expect(maxQty(product())).toBe(MAX_PER_LINE);
    expect(setQty([], product(), 99)).toEqual([{ productId: "V1", qty: MAX_PER_LINE }]);
  });

  it("ignores fractional and nonsense quantities", () => {
    expect(setQty([], product(), 2.7)).toEqual([{ productId: "V1", qty: 2 }]);
    expect(setQty([{ productId: "V1", qty: 2 }], product(), Number.NaN)).toEqual([]);
    expect(setQty([], product(), -3)).toEqual([]);
  });
});

describe("cart summary", () => {
  it("prices lines from the catalog in integer cents", () => {
    const products = [product({ id: "A", priceCents: 2500 }), product({ id: "B", priceCents: 500 })];
    const s = summarize(
      [
        { productId: "A", qty: 2 },
        { productId: "B", qty: 3 },
      ],
      products,
    );
    expect(s.subtotalCents).toBe(6500);
    expect(s.count).toBe(5);
    expect(s.lines.map((l) => l.lineCents)).toEqual([5000, 1500]);
    expect(s.changes).toEqual([]);
  });

  it("uses today's price, not the price when it was added", () => {
    const s = summarize([{ productId: "A", qty: 1 }], [product({ id: "A", priceCents: 1800 })]);
    expect(s.subtotalCents).toBe(1800);
  });

  it("drops gone and sold-out items and trims to stock, saying so", () => {
    const s = summarize(
      [
        { productId: "gone", qty: 1 },
        { productId: "A", qty: 1 },
        { productId: "B", qty: 4 },
      ],
      [
        product({ id: "A", name: "Fences", stock: 0, stockStatus: "sold-out" }),
        product({ id: "B", name: "Fences: Seasons", stock: 2, stockStatus: "low" }),
      ],
    );
    expect(s.lines).toHaveLength(1);
    expect(s.lines[0]).toMatchObject({ qty: 2 });
    expect(s.changes).toEqual([
      "An item in your cart is no longer in the shop, so we took it out.",
      "Fences sold out, so we took it out of your cart.",
      "Only 2 of Fences: Seasons available, so your cart now has 2.",
    ]);
  });
});

describe("saved cart", () => {
  it("reads back what was saved and drops anything malformed", () => {
    expect(parseCart(JSON.stringify([{ productId: "A", qty: 2 }]))).toEqual([{ productId: "A", qty: 2 }]);
    expect(
      parseCart(
        JSON.stringify([
          { productId: "A", qty: 1.5 },
          { productId: 3, qty: 1 },
          null,
          { productId: "B", qty: 0 },
        ]),
      ),
    ).toEqual([]);
    expect(parseCart("not json")).toEqual([]);
    expect(parseCart(null)).toEqual([]);
    expect(parseCart('{"productId":"A"}')).toEqual([]);
  });
});
