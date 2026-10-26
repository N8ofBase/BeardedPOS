// The hosted database adapter. The unit tests use a fake client. The last test runs migrations and a
// staff flow on a real Postgres when STORE_PG_TEST_URL points at one whose user is an ordinary admin
// (CREATEROLE, not a superuser), as on Amazon RDS.
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { withBusiness } from "../src/db.ts";
import { migrateLocked, postgresDatabase } from "../src/postgres.ts";
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
});
