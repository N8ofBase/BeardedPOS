// The Bearded Bundle pre-order goes through the shop's usual Square checkout: Beard Bucks come off
// it and are earned on it like any other order.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Account, CheckoutResponse, SquareCatalog } from "@bearded/store-core";
import type { Database } from "../src/db.ts";
import { loadSnapshot, SnapshotStore } from "../src/square/snapshot.ts";
import { freshDb, makeStore, type TestStore } from "./helpers.ts";

const BUNDLE_ID = "QQP3FQLB2ZSUOTOHHZYTKSN3";

/** The saved catalog plus the bundle, named the way the live Square spells it. */
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

let db: Database;
beforeAll(async () => {
  db = await freshDb();
});

async function signIn(store: TestStore, email: string) {
  const code = (await store.call("POST", "/api/account/code", { email })).body as { devCode: string };
  const res = await store.call("POST", "/api/account/session", { email, code: code.devCode });
  return { bbg_buddy: /bbg_buddy=([^;]+)/.exec(res.headers!["Set-Cookie"]!)![1]! };
}

afterEach(() => {
  vi.useRealTimers();
});

const at = (iso: string) => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(iso));
};

describe("Bearded Bundle pre-order", () => {
  it("is refused at checkout before pre-orders open on Saturday", async () => {
    at("2026-11-27T23:59:00-06:00");
    const store = makeStore(db, { square: new SnapshotStore(withBundle()) });
    const res = await store.call("POST", "/api/checkout", { lines: [{ productId: BUNDLE_ID, qty: 1 }] });
    expect(res).toMatchObject({
      status: 409,
      body: {
        error: "Bearded Bundle (Pre-order) opens for orders Saturday, Nov 28. Remove it to check out.",
      },
    });
  });

  it("takes Beard Bucks off at checkout and earns Bucks once paid", async () => {
    at("2026-11-28T00:00:00-06:00");
    const store = makeStore(db, { square: new SnapshotStore(withBundle()) });
    const jar = await signIn(store, "bundle-fan@example.com"); // 200 welcome Bucks
    const res = await store.call(
      "POST",
      "/api/checkout",
      { lines: [{ productId: BUNDLE_ID, qty: 1 }], rewards: 1 },
      jar,
    );
    expect(res.status).toBe(200);
    const { orderId } = res.body as CheckoutResponse;
    const order = (await store.call("GET", `/api/checkout-preview/${orderId}`)).body;
    expect(order).toMatchObject({ subtotalCents: 5000, discountCents: 500 });

    await store.call("POST", `/api/checkout-preview/${orderId}/pay`, {});
    await store.call("GET", `/api/orders/${orderId}`, undefined, jar);
    const account = (await store.call("GET", "/api/account", undefined, jar)).body as Account;
    // 200 welcome − 200 redeemed + 45 earned on the $45 paid.
    expect(account).toMatchObject({ balance: 45, held: 0 });
  });
});
