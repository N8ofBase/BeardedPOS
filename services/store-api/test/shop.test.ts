import { beforeAll, describe, expect, it } from "vitest";
import { missingItems, storeProducts, type CheckoutResponse, type OrderView } from "@bearded/store-core";
import type { Database } from "../src/db.ts";
import { loadSnapshot, SnapshotStore } from "../src/square/snapshot.ts";
import type { SquareStore } from "../src/square/types.ts";
import { freshDb, makeStore } from "./helpers.ts";

const LOCKED_OUT = "NJ65T37BVFHTAAFBCEXI7KNX"; // $20, stock untracked
const RANCH = "CODAYIOIDBKGQPILID7GDBIT"; // $25
const MATH_FORCE = "5DME2NIAOQZAHO3ARGBN4AYG"; // in Square, not in the store

let db: Database;
beforeAll(async () => {
  db = await freshDb();
});

describe("the saved Square snapshot", () => {
  const snap = loadSnapshot();
  it("has every item the store lists", () => {
    expect(missingItems(snap)).toEqual([]);
  });
  it("keeps Prism Cortex-only items, donations and market items off the store", () => {
    const names = storeProducts(snap).map((p) => p.name);
    expect(names).not.toContain("Math Force 5");
    expect(names).not.toContain("Donation");
    expect(names.some((n) => n.includes("Market"))).toBe(false);
  });
});

describe("checkout", () => {
  it("prices the order on the server and ignores any price from the browser", async () => {
    const store = makeStore(db);
    const res = await store.call("POST", "/api/checkout", {
      lines: [
        { productId: LOCKED_OUT, qty: 2, priceCents: 1 },
        { productId: RANCH, qty: 1 },
        { productId: LOCKED_OUT, qty: 1 },
      ],
      visitorId: "v-1",
      subtotalCents: 1,
    });
    expect(res.status).toBe(200);
    const { url, orderId } = res.body as CheckoutResponse;
    expect(url).toBe(`/checkout-preview/${orderId}`);
    const order = (await store.call("GET", url.replace("/checkout-preview", "/api/checkout-preview")))
      .body as OrderView;
    expect(order.lines).toEqual([
      { productId: LOCKED_OUT, name: "Locked Out", qty: 3, priceCents: 2000 },
      { productId: RANCH, name: "Fences: The Ranch", qty: 1, priceCents: 2500 },
    ]);
    expect(order.subtotalCents).toBe(8500);
    expect(order.status).toBe("open");
  });

  it("refuses items the store doesn't sell", async () => {
    const res = await makeStore(db).call("POST", "/api/checkout", {
      lines: [{ productId: MATH_FORCE, qty: 1 }],
    });
    expect(res).toMatchObject({
      status: 409,
      body: { error: expect.stringContaining("no longer in the shop") },
    });
  });

  it("refuses more than Square has, and sold-out items, by name", async () => {
    const snap = loadSnapshot();
    const tight = snap.items.map((i) =>
      i.variationId === RANCH
        ? { ...i, tracksStock: true, stock: 2 }
        : i.variationId === LOCKED_OUT
          ? { ...i, tracksStock: true, stock: 0 }
          : i,
    );
    const store = makeStore(db, { square: new SnapshotStore({ ...snap, items: tight }) });
    expect(
      (await store.call("POST", "/api/checkout", { lines: [{ productId: RANCH, qty: 3 }] })).body,
    ).toEqual({
      error: "Only 2 of Fences: The Ranch available. Lower the quantity to check out.",
    });
    expect(
      (await store.call("POST", "/api/checkout", { lines: [{ productId: LOCKED_OUT, qty: 1 }] })).body,
    ).toEqual({
      error: "Locked Out just sold out. Remove it to check out.",
    });
  });

  it("refuses empty carts and nonsense quantities", async () => {
    const store = makeStore(db);
    for (const lines of [
      [],
      [{ productId: RANCH, qty: 0 }],
      [{ productId: RANCH, qty: 1.5 }],
      [{ productId: RANCH }],
      "x",
    ])
      expect((await store.call("POST", "/api/checkout", { lines })).status).toBe(400);
  });

  it("marks the order paid from the preview page, once", async () => {
    const store = makeStore(db);
    const { orderId } = (await store.call("POST", "/api/checkout", { lines: [{ productId: RANCH, qty: 1 }] }))
      .body as CheckoutResponse;
    const paid = await store.call("POST", `/api/checkout-preview/${orderId}/pay`, {});
    expect((paid.body as OrderView).status).toBe("paid");
    const again = await store.call("POST", `/api/checkout-preview/${orderId}/pay`, {});
    expect((again.body as OrderView).status).toBe("paid");
  });

  it("has no preview page once Square is connected", async () => {
    const live: SquareStore = Object.assign(new SnapshotStore(), { mode: "sandbox" as const });
    const store = makeStore(db, { square: live });
    expect(
      (await store.call("GET", "/api/checkout-preview/00000000-0000-4000-8000-000000000000")).status,
    ).toBe(404);
  });

  it("answers unknown orders and routes plainly", async () => {
    const store = makeStore(db);
    expect((await store.call("GET", "/api/checkout-preview/nope")).status).toBe(404);
    expect((await store.call("GET", "/api/nothing")).status).toBe(404);
    expect((await store.call("GET", "/api/checkout")).status).toBe(405);
  });

  it("only takes JSON", async () => {
    const store = makeStore(db);
    const res = await (
      await import("../src/router.ts")
    ).handle(store.ctx, {
      method: "POST",
      path: "/api/vip",
      query: new URLSearchParams(),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      cookies: {},
      body: "email=a@b.co",
    });
    expect(res.status).toBe(415);
  });
});
