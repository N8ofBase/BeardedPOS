// The Square connection, against fake Square answers. Nothing here reaches Square.
import { beforeAll, describe, expect, it } from "vitest";
import { storeProducts } from "@bearded/store-core";
import type { Database } from "../src/db.ts";
import { squareFromEnv } from "../src/node.ts";
import {
  CATALOG_SECONDS,
  type CatalogObject,
  orderIsPaid,
  SquareApiError,
  SquareApiStore,
  toCatalog,
} from "../src/square/live.ts";
import { applySeed, planSeed } from "../src/square/sandboxSeed.ts";
import { loadSnapshot, SnapshotStore } from "../src/square/snapshot.ts";
import type { SquareStore } from "../src/square/types.ts";
import { freshDb, makeStore } from "./helpers.ts";

interface Call {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

/** A fake Square: answers by "METHOD /path" (query string dropped) and records every call. */
function fakeSquare(routes: Record<string, (body: unknown, url: URL) => unknown>) {
  const calls: Call[] = [];
  const fetch = async (url: string, init: RequestInit) => {
    const u = new URL(url);
    const body = typeof init.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
    calls.push({
      method: init.method ?? "GET",
      path: u.pathname,
      headers: init.headers as Record<string, string>,
      body,
    });
    const route = routes[`${init.method} ${u.pathname}`];
    if (!route)
      return new Response(JSON.stringify({ errors: [{ code: "NOT_FOUND", detail: "nope" }] }), {
        status: 404,
      });
    const out = route(body, u);
    if (out instanceof Response) return out;
    return new Response(JSON.stringify(out), { status: 200 });
  };
  return { fetch, calls };
}

const LOC = "LSANDBOX1";

const item = (id: string, name: string, variations: CatalogObject[], extra: object = {}): CatalogObject => ({
  type: "ITEM",
  id,
  present_at_all_locations: true,
  item_data: { name, product_type: "REGULAR", variations, ...extra },
});
const variation = (id: string, data: object, extra: object = {}): CatalogObject => ({
  type: "ITEM_VARIATION",
  id,
  present_at_all_locations: true,
  item_variation_data: { name: "Regular", pricing_type: "FIXED_PRICING", ...data },
  ...extra,
});

describe("reading the catalog", () => {
  it("maps Square items, prices, stock and images into the store's shape", () => {
    const catalog = toCatalog(
      [
        { type: "IMAGE", id: "IMG", image_data: { url: "https://img/fences.png" } },
        item(
          "I1",
          "Fences",
          [variation("V1", { price_money: { amount: 3500, currency: "USD" }, track_inventory: true })],
          { image_ids: ["IMG"] },
        ),
        item("I2", "Donation", [variation("V2", { pricing_type: "VARIABLE_PRICING" })]),
        item("I3", "Locked Out", [
          variation("V3", {
            price_money: { amount: 2000, currency: "USD" },
            track_inventory: true,
            location_overrides: [{ location_id: LOC, track_inventory: false }],
          }),
        ]),
        {
          ...item("I4", "Elsewhere", [variation("V4", { price_money: { amount: 100 } })]),
          present_at_all_locations: false,
        },
        { ...item("I5", "Gone", [variation("V5", { price_money: { amount: 100 } })]), is_deleted: true },
        item("I6", "Seasons", [variation("V6", { price_money: { amount: 1500 }, track_inventory: true })]),
      ],
      new Map([["V1", 7]]),
      LOC,
      "2026-10-24T00:00:00.000Z",
    );
    expect(catalog.items).toEqual([
      {
        itemId: "I1",
        variationId: "V1",
        name: "Fences",
        variationName: "Regular",
        productType: "REGULAR",
        priceCents: 3500,
        tracksStock: true,
        stock: 7,
        imageUrl: "https://img/fences.png",
      },
      expect.objectContaining({ variationId: "V2", priceCents: null }),
      // The location says stock isn't tracked there.
      expect.objectContaining({ variationId: "V3", tracksStock: false, stock: null }),
      // Tracked with no count yet: nothing to sell.
      expect.objectContaining({ variationId: "V6", tracksStock: true, stock: 0 }),
    ]);
    expect(catalog.locationId).toBe(LOC);
  });

  it("follows every page, asks for stock at the store's location, and reuses the answer for a minute", async () => {
    let now = 0;
    const square = fakeSquare({
      "GET /v2/locations/main": () => ({ location: { id: LOC } }),
      "GET /v2/catalog/list": (_b, u) =>
        u.searchParams.get("cursor")
          ? { objects: [item("I2", "Locked Out", [variation("V2", { price_money: { amount: 2000 } })])] }
          : {
              objects: [
                item("I1", "Fences", [
                  variation("V1", { price_money: { amount: 3500 }, track_inventory: true }),
                ]),
              ],
              cursor: "page2",
            },
      "POST /v2/inventory/counts/batch-retrieve": () => ({
        counts: [{ catalog_object_id: "V1", state: "IN_STOCK", location_id: LOC, quantity: "4.0" }],
      }),
    });
    const store = new SquareApiStore({ mode: "sandbox", token: "t0k", fetch: square.fetch, now: () => now });
    const catalog = await store.catalog();
    expect(catalog.items.map((i) => [i.name, i.stock])).toEqual([
      ["Fences", 4],
      ["Locked Out", null],
    ]);
    const counts = square.calls.find((c) => c.path === "/v2/inventory/counts/batch-retrieve")!;
    expect(counts.body).toMatchObject({
      catalog_object_ids: ["V1", "V2"],
      location_ids: [LOC],
      states: ["IN_STOCK"],
    });
    expect(counts.headers).toMatchObject({
      Authorization: "Bearer t0k",
      "Square-Version": expect.any(String),
    });

    const before = square.calls.length;
    now += (CATALOG_SECONDS - 1) * 1000;
    await store.catalog();
    expect(square.calls.length).toBe(before);
    now += 2000;
    await store.catalog();
    expect(square.calls.length).toBeGreaterThan(before);
  });

  it("turns Square's errors into SquareApiError with their codes, and doesn't cache a failure", async () => {
    let fail = true;
    const square = fakeSquare({
      "GET /v2/catalog/list": () =>
        fail
          ? new Response(JSON.stringify({ errors: [{ code: "UNAUTHORIZED", detail: "Bad token" }] }), {
              status: 401,
            })
          : { objects: [] },
      "POST /v2/inventory/counts/batch-retrieve": () => ({}),
    });
    const store = new SquareApiStore({ mode: "sandbox", token: "t", locationId: LOC, fetch: square.fetch });
    const err = await store.catalog().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SquareApiError);
    expect(err).toMatchObject({ status: 401, codes: ["UNAUTHORIZED"] });
    fail = false;
    expect((await store.catalog()).items).toEqual([]);
  });

  it("reads the Sandbox, not the real account", async () => {
    const urls: string[] = [];
    const store = new SquareApiStore({
      mode: "sandbox",
      token: "t",
      locationId: LOC,
      fetch: async (url) => {
        urls.push(url);
        return new Response("{}");
      },
    });
    await store.catalog();
    expect(urls.every((u) => u.startsWith("https://connect.squareupsandbox.com/"))).toBe(true);
  });
});

describe("checkout through Square", () => {
  it("creates a payment link for the priced order, keyed on our order id", async () => {
    const square = fakeSquare({
      "POST /v2/online-checkout/payment-links": () => ({
        payment_link: { id: "PL1", url: "https://sandbox.square.link/u/abc", order_id: "SQ-ORDER" },
      }),
    });
    const store = new SquareApiStore({ mode: "sandbox", token: "t", locationId: LOC, fetch: square.fetch });
    const link = await store.createPaymentLink({
      id: "11111111-2222-4333-8444-555555555555",
      lines: [{ productId: "V1", qty: 2 }],
      redirectUrl: "https://store.test/thanks?order=11111111-2222-4333-8444-555555555555",
    });
    expect(link).toEqual({
      url: "https://sandbox.square.link/u/abc",
      squareOrderId: "SQ-ORDER",
      paymentLinkId: "PL1",
    });
    expect(square.calls[0]!.body).toEqual({
      idempotency_key: "11111111-2222-4333-8444-555555555555",
      order: {
        location_id: LOC,
        reference_id: "11111111-2222-4333-8444-555555555555",
        line_items: [{ catalog_object_id: "V1", quantity: "2" }],
        pricing_options: { auto_apply_taxes: true },
      },
      checkout_options: {
        redirect_url: "https://store.test/thanks?order=11111111-2222-4333-8444-555555555555",
      },
    });
  });

  it("puts a Beard Bucks reward on the order as one fixed discount, and fills in the email", async () => {
    const square = fakeSquare({
      "POST /v2/online-checkout/payment-links": () => ({
        payment_link: { id: "PL2", url: "https://x", order_id: "O2" },
      }),
    });
    const store = new SquareApiStore({ mode: "sandbox", token: "t", locationId: LOC, fetch: square.fetch });
    await store.createPaymentLink({
      id: "11111111-2222-4333-8444-666666666666",
      lines: [{ productId: "V1", qty: 1 }],
      redirectUrl: "https://store.test/thanks",
      discountCents: 1000,
      buyerEmail: "rae@example.com",
      currency: "USD",
    });
    expect(square.calls[0]!.body).toMatchObject({
      order: {
        discounts: [
          {
            uid: "beard-bucks",
            name: "Beard Bucks reward",
            type: "FIXED_AMOUNT",
            amount_money: { amount: 1000, currency: "USD" },
            scope: "ORDER",
          },
        ],
      },
      pre_populated_data: { buyer_email: "rae@example.com" },
    });
  });

  it("counts an order as paid only when Square took the money", () => {
    expect(orderIsPaid({ id: "o", state: "COMPLETED" })).toBe(true);
    expect(orderIsPaid({ id: "o", state: "OPEN", tenders: [{}], net_amount_due_money: { amount: 0 } })).toBe(
      true,
    );
    expect(orderIsPaid({ id: "o", state: "OPEN", tenders: [], net_amount_due_money: { amount: 4000 } })).toBe(
      false,
    );
    expect(orderIsPaid({ id: "o", state: "OPEN" })).toBe(false);
    expect(orderIsPaid({ id: "o", state: "CANCELED", tenders: [{}] })).toBe(false);
  });

  it("adds a VIP to Square Customers once", async () => {
    let existing: { id: string }[] = [];
    const square = fakeSquare({
      "POST /v2/customers/search": () => ({ customers: existing }),
      "POST /v2/customers": () => ({ customer: { id: "C1" } }),
    });
    const store = new SquareApiStore({ mode: "sandbox", token: "t", locationId: LOC, fetch: square.fetch });
    await store.upsertCustomer("Sam@Example.com");
    existing = [{ id: "C1" }];
    await store.upsertCustomer("sam@example.com");
    const creates = square.calls.filter((c) => c.path === "/v2/customers");
    expect(creates).toHaveLength(1);
    expect(creates[0]!.body).toMatchObject({ email_address: "Sam@Example.com" });
    expect((creates[0]!.body as { idempotency_key: string }).idempotency_key.length).toBeLessThanOrEqual(45);
  });
});

describe("the thank-you page's payment check", () => {
  let db: Database;
  beforeAll(async () => {
    db = await freshDb();
  });

  /** Offline catalog, but Square's payment links and order answers are faked. */
  let links = 0;
  function squareWith(paid: () => Promise<boolean>): SquareStore {
    const offline = new SnapshotStore();
    return {
      mode: "sandbox",
      catalog: () => offline.catalog(),
      createPaymentLink: async () => {
        links += 1;
        return {
          url: "https://sandbox.square.link/u/x",
          squareOrderId: `SQ-${links}`,
          paymentLinkId: `PL-${links}`,
        };
      },
      orderPaid: paid,
      upsertCustomer: async () => {},
      hasPaidOrder: async () => false,
    };
  }

  async function startCheckout(store: ReturnType<typeof makeStore>) {
    const productId = storeProducts(loadSnapshot()).find((p) => p.name === "Locked Out")!.id;
    const res = await store.call("POST", "/api/checkout", { lines: [{ productId, qty: 1 }] });
    return (res.body as { orderId: string }).orderId;
  }

  it("marks the order paid once Square says so", async () => {
    let paid = false;
    const store = makeStore(db, { square: squareWith(async () => paid) });
    const id = await startCheckout(store);
    expect((await store.call("GET", `/api/orders/${id}`)).body).toEqual({ status: "open" });
    paid = true;
    expect((await store.call("GET", `/api/orders/${id}`)).body).toEqual({ status: "paid" });
    // Once paid, Square isn't asked again.
    paid = false;
    expect((await store.call("GET", `/api/orders/${id}`)).body).toEqual({ status: "paid" });
  });

  it("says open, not an error, when Square can't be reached", async () => {
    const store = makeStore(db, { square: squareWith(() => Promise.reject(new Error("down"))) });
    const id = await startCheckout(store);
    const res = await store.call("GET", `/api/orders/${id}`);
    expect(res).toMatchObject({ status: 200, body: { status: "open" } });
  });

  it("doesn't find orders that don't exist or belong to another business", async () => {
    const mine = makeStore(db, { square: squareWith(async () => true) });
    const id = await startCheckout(mine);
    const other = makeStore(db, { businessId: "bbbbbbbb-0000-4000-8000-000000000009" });
    expect((await other.call("GET", `/api/orders/${id}`)).status).toBe(404);
    expect((await mine.call("GET", "/api/orders/not-an-id")).status).toBe(404);
  });
});

describe("choosing Square in development", () => {
  it("stays offline unless the Sandbox is asked for, and never uses the real account", () => {
    expect(squareFromEnv({}).mode).toBe("offline");
    expect(squareFromEnv({ SQUARE_ENV: "sandbox", SQUARE_SANDBOX_ACCESS_TOKEN: "t" }).mode).toBe("sandbox");
    expect(() => squareFromEnv({ SQUARE_ENV: "sandbox" })).toThrow(/SQUARE_SANDBOX_ACCESS_TOKEN/);
    expect(() => squareFromEnv({ SQUARE_ENV: "production", SQUARE_SANDBOX_ACCESS_TOKEN: "t" })).toThrow();
  });
});

describe("copying the store's items into the Sandbox", () => {
  const saved = loadSnapshot();
  const empty = { ...saved, items: [] };

  it("plans only items the store sells, with fixed prices and their stock", () => {
    const plan = planSeed(saved, empty);
    const names = plan.add.map((i) => i.name);
    expect(names).toContain("Fences");
    expect(names).toContain("Locked Out");
    expect(names).not.toContain("Math Force 5");
    expect(names).not.toContain("Donation");
    const fences = plan.add.find((i) => i.name === "Fences")!;
    expect(fences.variations[0]!.priceCents).toBeGreaterThan(0);
    expect(plan.skip).toEqual([]);
  });

  it("leaves items the Sandbox already has alone, so a second run adds nothing", () => {
    const first = planSeed(saved, empty);
    const sandbox = {
      ...saved,
      items: saved.items.filter((i) => first.add.some((a) => a.name === i.name)),
    };
    const second = planSeed(saved, sandbox);
    expect(second.add).toEqual([]);
    expect(second.skip.length).toBe(first.add.length);
  });

  it("creates the items and sets stock on the ids Square gives back", async () => {
    const plan = {
      add: [
        {
          name: "Fences",
          productType: "REGULAR",
          variations: [{ name: "Regular", priceCents: 3500, stock: 12 }],
        },
        {
          name: "Jibe Card Game",
          productType: "REGULAR",
          variations: [{ name: "Regular", priceCents: 1500, stock: null }],
        },
      ],
      skip: [],
    };
    const square = fakeSquare({
      "POST /v2/catalog/batch-upsert": () => ({
        id_mappings: [
          { client_object_id: "#item-0", object_id: "ITEM-F" },
          { client_object_id: "#var-0-0", object_id: "VAR-F" },
          { client_object_id: "#item-1", object_id: "ITEM-J" },
          { client_object_id: "#var-1-0", object_id: "VAR-J" },
        ],
      }),
      "POST /v2/inventory/changes/batch-create": () => ({}),
    });
    const store = new SquareApiStore({ mode: "sandbox", token: "t", locationId: LOC, fetch: square.fetch });
    expect(await applySeed(store, plan, "USD")).toBe(2);
    const stock = square.calls.find((c) => c.path === "/v2/inventory/changes/batch-create")!.body as {
      changes: { physical_count: { catalog_object_id: string; quantity: string; location_id: string } }[];
    };
    expect(stock.changes.map((c) => c.physical_count)).toEqual([
      expect.objectContaining({ catalog_object_id: "VAR-F", quantity: "12", location_id: LOC }),
    ]);
  });

  it("refuses to write anywhere but the Sandbox", async () => {
    const live = new SquareApiStore({
      mode: "live",
      token: "t",
      locationId: LOC,
      fetch: async () => new Response("{}"),
    });
    await expect(applySeed(live, planSeed(saved, empty), "USD")).rejects.toThrow(/Sandbox/);
  });
});
