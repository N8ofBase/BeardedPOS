import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { ensureDemo, hasDemoData, listDemoStaff, seedDemo } from "../seed/demo.ts";
import { createDb } from "../src/index.ts";
import { migrate, MIGRATIONS } from "../src/migrate.ts";
import { PGLITE_OPTIONS } from "../src/parsers.ts";
import { createTestDb, insertBusiness } from "../src/test-db.ts";

let db: Awaited<ReturnType<typeof createTestDb>>["db"];

beforeEach(async () => {
  ({ db } = await createTestDb());
});

describe("staff constraints", () => {
  it("refuses the same email twice in one business, ignoring case", async () => {
    const a = await insertBusiness(db, "store-a");
    await db
      .insertInto("staff")
      .values({ business_id: a, name: "Ann", email: "ann@x.com", role: "owner" })
      .execute();
    await expect(
      db
        .insertInto("staff")
        .values({ business_id: a, name: "Ann 2", email: "ANN@x.com", role: "cashier" })
        .execute(),
    ).rejects.toThrow(/staff_email_per_business/);
  });

  it("allows the same email in two businesses", async () => {
    const a = await insertBusiness(db, "store-a");
    const b = await insertBusiness(db, "store-b");
    await db
      .insertInto("staff")
      .values({ business_id: a, name: "Ann", email: "ann@x.com", role: "owner" })
      .execute();
    await db
      .insertInto("staff")
      .values({ business_id: b, name: "Ann", email: "ann@x.com", role: "owner" })
      .execute();
  });

  it("refuses an unknown role", async () => {
    const a = await insertBusiness(db, "store-a");
    await expect(
      db
        .insertInto("staff")
        // @ts-expect-error: not a role
        .values({ business_id: a, name: "X", role: "admin" })
        .execute(),
    ).rejects.toThrow(/check constraint/);
  });

  it("refuses a bad business slug", async () => {
    await expect(insertBusiness(db, "Not A Slug")).rejects.toThrow(/check constraint/);
  });
});

describe("upgrading a demo browser from session 1a", () => {
  it("adds the new tables and sample data on top of the old database", async () => {
    const pg = new PGlite(PGLITE_OPTIONS);
    await migrate(pg, MIGRATIONS.slice(0, 2));
    const old = createDb(pg);
    // What 1a's seed created: the business, a location and staff only.
    const biz = await old
      .insertInto("businesses")
      .values({ name: "Sample Game Shop (DEMO)", slug: "sample-game-shop-demo", is_demo: true })
      .returning("id")
      .executeTakeFirstOrThrow();
    await old
      .insertInto("locations")
      .values({ business_id: biz.id, name: "Main store (DEMO)", is_demo: true })
      .execute();
    await old
      .insertInto("staff")
      .values({ business_id: biz.id, name: "Sample Owner (DEMO)", role: "owner", is_demo: true })
      .execute();

    expect(await migrate(pg)).toEqual(MIGRATIONS.slice(2).map((m) => m.name));
    expect(await ensureDemo(old)).toBe(biz.id);
    const count = async (t: "products" | "customers") =>
      (await old.selectFrom(t).select("id").where("business_id", "=", biz.id).execute()).length;
    expect(await count("products")).toBe(4);
    expect(await count("customers")).toBe(3);
  });
});

describe("migration 010", () => {
  it("converts tax rates from basis points to thousandths of a percent", async () => {
    const pg = new PGlite(PGLITE_OPTIONS);
    const before = MIGRATIONS.findIndex((m) => m.name.startsWith("010_"));
    await migrate(pg, MIGRATIONS.slice(0, before));
    const biz = await pg.query<{ id: string }>(
      "INSERT INTO businesses (name, slug) VALUES ('T', 't') RETURNING id",
    );
    await pg.query("INSERT INTO locations (business_id, name, tax_rate_bp) VALUES ($1, 'L', 825)", [
      biz.rows[0]!.id,
    ]);
    await migrate(pg);
    const { rows } = await pg.query<{ tax_rate_mpct: number }>("SELECT tax_rate_mpct FROM locations");
    expect(rows).toEqual([{ tax_rate_mpct: 8250 }]);
  });
});

describe("demo seed", () => {
  it("creates one business with a staff member per role, all marked demo", async () => {
    expect(await hasDemoData(db)).toBe(false);
    const id = await seedDemo(db);
    expect(await hasDemoData(db)).toBe(true);

    const staff = await listDemoStaff(db);
    expect(staff.map((s) => s.role)).toEqual(["owner", "manager", "cashier"]);
    expect(staff.every((s) => s.businessId === id && s.name.endsWith("(DEMO)"))).toBe(true);

    const notDemo = await db.selectFrom("staff").select("id").where("is_demo", "=", false).execute();
    expect(notDemo).toEqual([]);
  });
});
