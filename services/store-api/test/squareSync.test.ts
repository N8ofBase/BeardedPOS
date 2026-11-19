// The register and Square kept in step, against a fake Square. Nothing here reaches Square.
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { createDb, ensureStore, migrate as migrateRegister, PGLITE_OPTIONS } from "@bearded/db";
import type { CheckoutResult } from "@bearded/api";
import { migrate as migrateStore, type Database } from "../src/db.ts";
import { storeItems, storeSetup } from "../src/register-postgres.ts";
import { SquareApiStore, type CatalogObject } from "../src/square/live.ts";
import { readSquareShelf, sendStockToSquare } from "../src/square/registerSync.ts";
import { loadSnapshot } from "../src/square/snapshot.ts";
import { BIZ_A, BIZ_B, makeStore, type TestStore } from "./helpers.ts";

const N8 = "n8gr8@prismcortex.net";
const ENV = { POS_OWNERS: `N8 <${N8}>`, POS_DEMO_STOCK: "10" };
const LOC = "LBEARDED";
const shelfName = storeItems(loadSnapshot())[0]!.name;

const variation = (id: string, data: object): CatalogObject => ({
  type: "ITEM_VARIATION",
  id,
  present_at_all_locations: true,
  item_variation_data: { name: "Regular", pricing_type: "FIXED_PRICING", ...data },
});
const item = (id: string, name: string, variations: CatalogObject[], extra: object = {}): CatalogObject => ({
  type: "ITEM",
  id,
  present_at_all_locations: true,
  item_data: { name, variations, ...extra } as CatalogObject["item_data"],
});

interface FakeSquare {
  calls: { key: string; body: unknown }[];
  fail: Set<string>;
  catalog: CatalogObject[];
  counts: Record<string, number>;
  customers: object[];
}

function fakeSquare(): FakeSquare & { fetch: (url: string, init: RequestInit) => Promise<Response> } {
  const f: FakeSquare = {
    calls: [],
    fail: new Set(),
    catalog: [
      { type: "CATEGORY", id: "CAT1", category_data: { name: "Card games" } } as CatalogObject,
      // Already on the register's shelf by name, at a new price, counted by Square.
      item("I1", shelfName, [
        variation("V1", { price_money: { amount: 3100 }, sku: "FENCE-1", track_inventory: true }),
      ]),
      // New to the register.
      item(
        "I2",
        "Brand New Game",
        [
          variation("V2", {
            price_money: { amount: 2500 },
            upc: "860000000017",
            default_unit_cost: { amount: 900 },
            track_inventory: true,
          }),
        ],
        { categories: [{ id: "CAT1" }] },
      ),
      // Archived in Square: no longer sold, so never brought in.
      item("I4", "Old Promo", [variation("V4", { price_money: { amount: 100 } })], { is_archived: true }),
      // Can't be rung up at a fixed price.
      item("I3", "Donation", [variation("V3", { pricing_type: "VARIABLE_PRICING" })]),
    ],
    counts: { V1: 7, V2: 4 },
    customers: [
      { id: "C1", given_name: "Pat", family_name: "Lee", phone_number: "+1 314-555-0101" },
      { id: "C2", given_name: "Sam", email_address: "SAM@example.com" },
    ],
  };
  const fetch = async (url: string, init: RequestInit) => {
    const key = `${init.method} ${new URL(url).pathname}`;
    const body = typeof init.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
    f.calls.push({ key, body });
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
    if (f.fail.has(key)) return json({ errors: [{ code: "INTERNAL_SERVER_ERROR", detail: "down" }] }, 500);
    if (key === "GET /v2/catalog/list") return json({ objects: f.catalog });
    if (key === "POST /v2/inventory/counts/batch-retrieve") {
      const ids = (body as { catalog_object_ids: string[] }).catalog_object_ids;
      return json({
        counts: ids
          .filter((id) => id in f.counts)
          .map((id) => ({ catalog_object_id: id, state: "IN_STOCK", quantity: String(f.counts[id]) })),
      });
    }
    if (key === "GET /v2/customers") return json({ customers: f.customers });
    if (key === "POST /v2/customers") return json({ customer: { id: `NEW${f.calls.length}` } });
    if (key === "POST /v2/inventory/changes/batch-create") return json({ counts: [] });
    return json({ errors: [{ code: "NOT_FOUND" }] }, 404);
  };
  return Object.assign(f, { fetch });
}

let pg: PGlite;
let square: ReturnType<typeof fakeSquare>;
let store: TestStore;
let jar: Record<string, string>;

async function signIn(s: TestStore, email: string) {
  // With Square connected the code goes by email only (the test mailer keeps it).
  await s.call("POST", "/api/pos/code", { email });
  const code = /(\d{6})/.exec(s.mail.at(-1)!.subject)![1];
  const res = await s.call("POST", "/api/pos/session", { email, code });
  return { bbg_pos: /bbg_pos=([^;]+)/.exec(res.headers!["Set-Cookie"]!)![1]! };
}

beforeEach(async () => {
  pg = new PGlite(PGLITE_OPTIONS);
  await migrateRegister(pg);
  await migrateStore(pg as unknown as Database);
  const pos = createDb(pg);
  await ensureStore(pos, storeSetup(ENV, BIZ_A, loadSnapshot()));
  await ensureStore(pos, { ...storeSetup({ POS_OWNERS: "Other <owner@b.example>" }, BIZ_B), slug: "other" });
  square = fakeSquare();
  const api = new SquareApiStore({ mode: "live", token: "t", locationId: LOC, fetch: square.fetch });
  store = makeStore(pg as unknown as Database, { square: api });
  store.ctx.pos = pos;
  jar = await signIn(store, N8);
});

const call = async <T>(name: string, input?: unknown) => {
  const r = await store.call("POST", `/api/pos/call/${name}`, input === undefined ? {} : { input }, jar);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return (r.body as { output: T }).output;
};
const sync = (apply: boolean, cookies = jar) =>
  store.call("POST", "/api/pos/square/sync", { apply }, cookies);
const rows = async <T>(q: string, params: unknown[] = []) => (await pg.query<T>(q, params)).rows;

describe("reading Square", () => {
  it("lists each variation with its SKU, barcode, cost, category and count", async () => {
    const api = new SquareApiStore({ mode: "live", token: "t", locationId: LOC, fetch: square.fetch });
    const shelf = await readSquareShelf(api);
    expect(shelf).toEqual([
      expect.objectContaining({
        variationId: "V1",
        name: shelfName,
        sku: "FENCE-1",
        priceCents: 3100,
        stock: 7,
      }),
      {
        variationId: "V2",
        name: "Brand New Game",
        sku: null,
        barcode: "860000000017",
        priceCents: 2500,
        costCents: 900,
        category: "Card games",
        tracksStock: true,
        stock: 4,
      },
      expect.objectContaining({ variationId: "V3", priceCents: null, tracksStock: false, stock: null }),
    ]);
  });
});

describe("the Square sync", () => {
  it("previews without changing anything", async () => {
    const r = await sync(false);
    expect(r.status).toBe(200);
    const { preview, applied } = r.body as { preview: Record<string, unknown>; applied?: unknown };
    expect(applied).toBeUndefined();
    expect(preview).toMatchObject({
      newProducts: [{ name: "Brand New Game", priceCents: 2500, stock: 4 }],
      linkedProducts: 1,
      stockChanges: [{ name: shelfName, from: 10, to: 7 }],
      skipped: [{ name: "Donation", reason: "Variable price in Square" }],
      newCustomers: 2,
    });
    expect(await rows("SELECT id FROM products WHERE square_variation_id IS NOT NULL")).toEqual([]);
    expect(square.calls.some((c) => c.key === "POST /v2/customers")).toBe(false);
  });

  it("brings items, prices, counts and customers in, audits prices, and sends nothing back for them", async () => {
    await call("saveCustomer", {
      customer: {
        name: "Jo Register",
        phone: "3145550199",
        email: "",
        street: "",
        city: "",
        state: "",
        zip: "",
        birthday: "",
        smsOptIn: false,
        notes: "",
      },
    });
    const r = await sync(true);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((r.body as { applied: object }).applied).toMatchObject({
      productsAdded: 1,
      pricesChanged: 1,
      stockChanged: 1,
      customersAdded: 2,
      customersToSquare: 1,
    });

    const [linked] = await rows<{ price_cents: number; square_tracks_stock: boolean; id: string }>(
      "SELECT id, price_cents, square_tracks_stock FROM products WHERE square_variation_id = 'V1'",
    );
    expect(linked).toMatchObject({ price_cents: 3100, square_tracks_stock: true });
    const [added] = await rows<Record<string, unknown>>(
      "SELECT sku, barcode, category, cost_cents FROM products WHERE square_variation_id = 'V2'",
    );
    expect(added).toEqual({ sku: "SQ-V2", barcode: "860000000017", category: "Card games", cost_cents: 900 });
    const onHand = await rows<{ square_variation_id: string; on_hand: number }>(
      `SELECT p.square_variation_id, l.on_hand FROM products p JOIN inventory_levels l ON l.product_id = p.id
       WHERE p.square_variation_id IS NOT NULL ORDER BY 1`,
    );
    expect(onHand).toEqual([
      { square_variation_id: "V1", on_hand: 7 },
      { square_variation_id: "V2", on_hand: 4 },
    ]);
    expect(await rows("SELECT id FROM square_stock_sends")).toEqual([]);
    const audits = await rows<{ after: { source: string } }>(
      "SELECT after FROM audit_log WHERE action = 'product.price_change' AND entity_id = $1",
      [linked!.id],
    );
    expect(audits[0]!.after.source).toBe("square_sync");

    const people = await rows<{ name: string; square_customer_id: string | null; phone: string | null }>(
      "SELECT name, square_customer_id, phone FROM customers WHERE NOT is_demo AND business_id = $1 ORDER BY name",
      [BIZ_A],
    );
    expect(people).toEqual([
      { name: "Jo Register", square_customer_id: expect.stringMatching(/^NEW/), phone: "3145550199" },
      { name: "Pat Lee", square_customer_id: "C1", phone: "3145550101" },
      { name: "Sam", square_customer_id: "C2", phone: null },
    ]);
    const added2 = square.calls.find((c) => c.key === "POST /v2/customers")!.body;
    expect(added2).toMatchObject({ given_name: "Jo", family_name: "Register", phone_number: "+13145550199" });

    // A second sync finds nothing to do.
    const again = (await sync(false)).body as { preview: Record<string, unknown> };
    expect(again.preview).toMatchObject({
      newProducts: [],
      priceChanges: [],
      stockChanges: [],
      linkedProducts: 0,
      newCustomers: 0,
      customersToSquare: 0,
    });
  });

  it("sends a register sale to Square's stock, and retries when Square is down", async () => {
    await sync(true);
    const [p] = await rows<{ id: string }>("SELECT id FROM products WHERE square_variation_id = 'V1'");
    square.fail.add("POST /v2/inventory/changes/batch-create");
    const sale = await call<CheckoutResult>("startCheckout", {
      customerId: null,
      lines: [{ key: "1", productId: p!.id, qty: 2 }],
      discounts: [],
    });
    await call("payCash", {
      saleId: sale.saleId,
      amountCents: sale.totalCents,
      tenderedCents: sale.totalCents,
    });
    const [waiting] = await rows<{ status: string; tries: number; qty_change: number }>(
      "SELECT status, tries, qty_change FROM square_stock_sends",
    );
    expect(waiting).toMatchObject({ status: "waiting", qty_change: -2 });
    expect(waiting!.tries).toBeGreaterThan(0);

    square.fail.clear();
    square.calls.length = 0;
    expect(await sendStockToSquare(store.ctx)).toBe(1);
    const sent = square.calls.find((c) => c.key === "POST /v2/inventory/changes/batch-create")!.body as {
      changes: { adjustment: Record<string, unknown> }[];
    };
    expect(sent.changes).toEqual([
      {
        type: "ADJUSTMENT",
        adjustment: expect.objectContaining({
          catalog_object_id: "V1",
          location_id: LOC,
          quantity: "2",
          from_state: "IN_STOCK",
          to_state: "SOLD",
        }),
      },
    ]);
    expect((await rows<{ status: string }>("SELECT status FROM square_stock_sends"))[0]!.status).toBe("sent");
    expect(await sendStockToSquare(store.ctx)).toBe(0);
  });

  it("doesn't send stock for an item Square doesn't count", async () => {
    square.catalog[1] = item("I1", shelfName, [variation("V1", { price_money: { amount: 3100 } })]);
    await sync(true);
    const [p] = await rows<{ id: string }>("SELECT id FROM products WHERE square_variation_id = 'V1'");
    const sale = await call<CheckoutResult>("startCheckout", {
      customerId: null,
      lines: [{ key: "1", productId: p!.id, qty: 1 }],
      discounts: [],
    });
    await call("payCash", {
      saleId: sale.saleId,
      amountCents: sale.totalCents,
      tenderedCents: sale.totalCents,
    });
    expect(await rows("SELECT id FROM square_stock_sends")).toEqual([]);
  });

  it("is for owners and managers, and keeps each business's stock changes its own", async () => {
    await pg.query(
      "INSERT INTO staff (business_id, name, email, role) VALUES ($1, 'Cass', 'cass@b.example', 'cashier')",
      [BIZ_A],
    );
    const cashier = await signIn(store, "cass@b.example");
    expect((await sync(false, cashier)).status).toBe(403);

    await sync(true);
    const [p] = await rows<{ id: string }>("SELECT id FROM products WHERE square_variation_id = 'V1'");
    square.fail.add("POST /v2/inventory/changes/batch-create");
    await call("receiveStock", { productId: p!.id, qty: 3, note: "Delivery" }).catch(() => undefined);
    const other = await pg.transaction(async (tx) => {
      await tx.query("SELECT set_config('app.business_id', $1, true)", [BIZ_B]);
      await tx.query("SET LOCAL ROLE pos_app");
      return (await tx.query("SELECT id FROM square_stock_sends")).rows;
    });
    expect(other).toEqual([]);
  });

  it("brings the rest in when some Square customers have only a name or a broken email", async () => {
    square.customers.push(
      { id: "C3", given_name: "Name", family_name: "Only" },
      { id: "C4", given_name: "Bad", email_address: "bad at example.com" },
      { id: "C5", company_name: "Phone Shop", email_address: "oops", phone_number: "(636) 555-0102" },
    );
    const r = await sync(true);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((r.body as { applied: { customersAdded: number } }).applied.customersAdded).toBe(3);
    const saved = await rows<{ name: string; email: string | null }>(
      "SELECT name, email FROM customers WHERE square_customer_id = 'C5'",
    );
    expect(saved).toEqual([{ name: "Phone Shop", email: null }]);
  });

  it("leaves out a Square customer the database refuses, and brings the rest in", async () => {
    // A sample customer isn't compared with Square, but still holds its phone.
    await pg.query(
      "INSERT INTO customers (business_id, name, phone, is_demo) VALUES ($1, 'Pat (DEMO)', '3145550101', true)",
      [BIZ_A],
    );
    const r = await sync(true);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((r.body as { applied: object }).applied).toMatchObject({
      customersAdded: 1,
      customersLeftOut: 1,
      productsAdded: 1,
    });
    expect(await rows("SELECT name FROM customers WHERE square_customer_id IS NOT NULL")).toEqual([
      { name: "Sam" },
    ]);
  });

  it("says plainly when Square can't be reached", async () => {
    square.fail.add("GET /v2/catalog/list");
    const r = await sync(false);
    expect(r.status).toBe(502);
    expect((r.body as { error: string }).error).toContain("Square didn't answer");
  });
});
