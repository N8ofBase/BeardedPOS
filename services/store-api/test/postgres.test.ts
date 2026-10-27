// The hosted database adapter. The unit tests use a fake client. The last test runs migrations and a
// staff flow on a real Postgres when STORE_PG_TEST_URL points at one whose user is an ordinary admin
// (CREATEROLE, not a superuser), as on Amazon RDS, then the hosted register beside it.
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { Kysely, PostgresDialect } from "kysely";
import { ensureStore, type DB } from "@bearded/db";
import { withBusiness } from "../src/db.ts";
import { migrateLocked, postgresDatabase } from "../src/postgres.ts";
import {
  migrateRegister,
  readMigrations,
  REGISTER_TYPES,
  storeItems,
  storeSetup,
} from "../src/register-postgres.ts";
import { loadSnapshot } from "../src/square/snapshot.ts";
import { BIZ_A, makeStore, signInStaff } from "./helpers.ts";

function fakePool(failOn?: string) {
  const log: string[] = [];
  const client = {
    query: async (text: string) => {
      log.push(text);
      if (failOn && text.includes(failOn)) throw new Error("boom");
      return { rows: [{ ok: 1 }] };
    },
    release: () => log.push("release"),
  };
  return { log, pool: { query: client.query, connect: async () => client } as unknown as pg.Pool };
}

describe("Postgres adapter", () => {
  it("wraps a transaction in BEGIN and COMMIT on one connection", async () => {
    const { log, pool } = fakePool();
    const out = await postgresDatabase(pool).transaction((tx) => tx.query<{ ok: number }>("SELECT 1"));
    expect(out.rows).toEqual([{ ok: 1 }]);
    expect(log).toEqual(["BEGIN", "SELECT 1", "COMMIT", "release"]);
  });

  it("rolls back and lets the connection go when the work fails", async () => {
    const { log, pool } = fakePool("INSERT");
    await expect(postgresDatabase(pool).transaction((tx) => tx.query("INSERT x"))).rejects.toThrow("boom");
    expect(log).toEqual(["BEGIN", "INSERT x", "ROLLBACK", "release"]);
  });
});

const url = process.env.STORE_PG_TEST_URL;
const pools: pg.Pool[] = [];
afterAll(() => Promise.all(pools.map((p) => p.end())));

describe.runIf(url)("on a real Postgres", () => {
  it("migrates as a non-superuser and keeps row-level security on", async () => {
    const pool = new pg.Pool({ connectionString: url, max: 2 });
    pools.push(pool);
    await pool.query(
      "DROP TABLE IF EXISTS store_migrations, store_reviews, store_vip_signups, store_orders, store_order_lines, store_events, store_staff_codes, store_staff_sessions, store_old_site_choices, store_customers, store_customer_codes, store_customer_sessions, store_loyalty_ledger CASCADE",
    );
    await Promise.all([migrateLocked(pool), migrateLocked(pool)]);
    const db = postgresDatabase(pool);
    const store = makeStore(db);
    const jar = await signInStaff(store);
    const saved = await store.call("POST", "/api/staff/old-site/tim-bio", { decision: "keep" }, jar);
    expect(saved.status).toBe(200);
    const other = await withBusiness(db, "bbbbbbbb-0000-4000-8000-000000000002", (sql) =>
      sql.query("SELECT * FROM store_old_site_choices"),
    );
    expect(other.rows).toEqual([]);
    const mine = await withBusiness(db, BIZ_A, (sql) =>
      sql.query("SELECT item_id FROM store_old_site_choices"),
    );
    expect(mine.rows).toEqual([{ item_id: "tim-bio" }]);

    // Beard Bucks: a shopper and their ledger stay inside their business, and the ledger is append-only.
    const address = "pg-buddy@example.com";
    const { devCode } = (await store.call("POST", "/api/account/code", { email: address })).body as {
      devCode: string;
    };
    expect((await store.call("POST", "/api/account/session", { email: address, code: devCode })).status).toBe(
      200,
    );
    await withBusiness(db, BIZ_A, async (sql) => {
      const { rows } = await sql.query<{ id: string }>("SELECT id FROM store_customers");
      await sql.query(
        "INSERT INTO store_loyalty_ledger (business_id, customer_id, kind, bucks) VALUES ($1, $2, 'adjust', 5)",
        [BIZ_A, rows[0]!.id],
      );
    });
    const theirs = await withBusiness(db, "bbbbbbbb-0000-4000-8000-000000000002", async (sql) => [
      ...(await sql.query("SELECT * FROM store_customers")).rows,
      ...(await sql.query("SELECT * FROM store_loyalty_ledger")).rows,
    ]);
    expect(theirs).toEqual([]);
    await expect(
      withBusiness(db, BIZ_A, (sql) => sql.query("UPDATE store_loyalty_ledger SET bucks = 500")),
    ).rejects.toThrow(/permission denied/);
  });

  it("hosts the register beside the store: its migrations, the store's setup and a sale", async () => {
    const pool = new pg.Pool({ connectionString: url, max: 4, types: REGISTER_TYPES });
    pools.push(pool);
    // A database with nothing in it, as a new RDS starts.
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    const migrations = readMigrations(
      fileURLToPath(new URL("../../../packages/db/migrations", import.meta.url)),
    );
    expect(migrations.length).toBeGreaterThan(10);
    // The Lambda's order, with two cold starts at once.
    await Promise.all([migrateRegister(pool, migrations), migrateRegister(pool, migrations)]);
    await migrateLocked(pool);
    const pos = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
    const setup = storeSetup({ POS_OWNERS: "N8 <n8gr8@prismcortex.net>", POS_DEMO_STOCK: "100" }, BIZ_A);
    await ensureStore(pos, setup);
    await ensureStore(pos, setup);

    const store = makeStore(postgresDatabase(pool));
    store.ctx.pos = pos;
    const code = (await store.call("POST", "/api/pos/code", { email: "n8gr8@prismcortex.net" })).body as {
      devCode: string;
    };
    const res = await store.call("POST", "/api/pos/session", {
      email: "n8gr8@prismcortex.net",
      code: code.devCode,
    });
    const jar = { bbg_pos: /bbg_pos=([^;]+)/.exec(res.headers!["Set-Cookie"]!)![1]! };
    const call = async <T>(name: string, input: unknown = {}) => {
      const r = await store.call("POST", `/api/pos/call/${name}`, { input }, jar);
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      return (r.body as { output: T }).output;
    };
    const products = await call<{ id: string; onHand: number }[]>("listProducts");
    expect(products.map((p) => p.onHand)).toEqual(products.map(() => 100));
    const sale = await call<{ saleId: string; totalCents: number }>("startCheckout", {
      customerId: null,
      lines: [{ key: "a", productId: products[0]!.id, qty: 2 }],
      discounts: [],
    });
    expect(
      await call("payCash", { saleId: sale.saleId, amountCents: sale.totalCents, tenderedCents: 10_000 }),
    ).toMatchObject({
      paid: true,
    });
    // Dates stay "YYYY-MM-DD" here too, as in the browser.
    const found = await call<{ name: string; birthday: string | null }[]>("searchCustomers", { q: "" });
    const birthdays = found.map((c) => c.birthday).filter((b) => b !== null);
    expect(birthdays.length).toBeGreaterThan(0);
    for (const b of birthdays) expect(b).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Counts and sums are numbers, as PGlite gives them.
    expect((await pool.query("SELECT count(*) AS n FROM staff")).rows[0].n).toBeTypeOf("number");
  });

  it("adds the register to a database where the store already runs, as on the live site", async () => {
    const pool = new pg.Pool({ connectionString: url, max: 4, types: REGISTER_TYPES });
    pools.push(pool);
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    await migrateLocked(pool);
    const migrations = readMigrations(
      fileURLToPath(new URL("../../../packages/db/migrations", import.meta.url)),
    );
    await migrateRegister(pool, migrations);
    await migrateLocked(pool);
    const pos = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
    // Last deploy's setup (sample products only), then this one's with the online store's items.
    const env = { POS_OWNERS: "N8 <n8gr8@prismcortex.net>", POS_DEMO_STOCK: "100" };
    await ensureStore(pos, storeSetup(env, BIZ_A));
    await ensureStore(pos, storeSetup(env, BIZ_A, loadSnapshot()));
    await ensureStore(pos, storeSetup(env, BIZ_A, loadSnapshot()));
    // The store's own staff sign-in still works beside the register's tables.
    const store = makeStore(postgresDatabase(pool));
    store.ctx.pos = pos;
    await signInStaff(store);
    const { rows } = await withBusiness(postgresDatabase(pool), BIZ_A, (sql) =>
      sql.query<{ name: string; on_hand: number }>(
        `SELECT p.name, l.on_hand FROM products p JOIN inventory_levels l ON l.product_id = p.id
         WHERE p.active ORDER BY p.sku`,
      ),
    );
    expect(rows.map((r) => r.name)).toEqual(storeItems(loadSnapshot()).map((p) => p.name));
    for (const r of rows) expect(r.on_hand).toBe(100);

    // A website purchase takes one off the register's shelf, as the app's role under row-level security.
    const { orderId } = (
      await store.call("POST", "/api/checkout", {
        lines: [{ productId: "NJ65T37BVFHTAAFBCEXI7KNX", qty: 1 }],
      })
    ).body as { orderId: string };
    expect((await store.call("POST", `/api/checkout-preview/${orderId}/pay`, {})).status).toBe(200);
    const after = await withBusiness(postgresDatabase(pool), BIZ_A, (sql) =>
      sql.query<{ on_hand: number }>(
        `SELECT l.on_hand FROM products p JOIN inventory_levels l ON l.product_id = p.id
         WHERE p.active AND p.name = 'Locked Out'`,
      ),
    );
    expect(after.rows[0]!.on_hand).toBe(99);
  });
});
