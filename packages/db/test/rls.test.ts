// Separation between businesses: with business A set, nothing from business B is
// visible or writable, even when a query asks for B's rows by id.
import { sql } from "kysely";
import { beforeAll, describe, expect, it } from "vitest";
import { withBusiness } from "../src/tx.ts";
import { createTestDb, insertBusiness } from "../src/test-db.ts";

let db: Awaited<ReturnType<typeof createTestDb>>["db"];
let a: string;
let b: string;
let bStaffId: string;

beforeAll(async () => {
  ({ db } = await createTestDb());
  a = await insertBusiness(db, "store-a");
  b = await insertBusiness(db, "store-b");
  await db.insertInto("staff").values({ business_id: a, name: "Ann", role: "owner" }).execute();
  const row = await db
    .insertInto("staff")
    .values({ business_id: b, name: "Bea", role: "owner" })
    .returning("id")
    .executeTakeFirstOrThrow();
  bStaffId = row.id;
});

describe("row-level security", () => {
  it("shows only the current business's rows", async () => {
    const names = await withBusiness(db, a, (trx) => trx.selectFrom("staff").select("name").execute());
    expect(names.map((r) => r.name)).toEqual(["Ann"]);

    const businesses = await withBusiness(db, a, (trx) =>
      trx.selectFrom("businesses").select("slug").execute(),
    );
    expect(businesses.map((r) => r.slug)).toEqual(["store-a"]);
  });

  it("hides another business's row even when asked for by id", async () => {
    const row = await withBusiness(db, a, (trx) =>
      trx.selectFrom("staff").selectAll().where("id", "=", bStaffId).executeTakeFirst(),
    );
    expect(row).toBeUndefined();
  });

  it("can't update or delete another business's rows", async () => {
    const updated = await withBusiness(db, a, (trx) =>
      trx.updateTable("staff").set({ name: "Hacked" }).where("id", "=", bStaffId).executeTakeFirst(),
    );
    expect(updated.numUpdatedRows).toBe(0n);

    const deleted = await withBusiness(db, a, (trx) =>
      trx.deleteFrom("staff").where("id", "=", bStaffId).executeTakeFirst(),
    );
    expect(deleted.numDeletedRows).toBe(0n);

    const still = await withBusiness(db, b, (trx) =>
      trx.selectFrom("staff").select("name").where("id", "=", bStaffId).executeTakeFirstOrThrow(),
    );
    expect(still.name).toBe("Bea");
  });

  it("refuses inserting a row for another business", async () => {
    await expect(
      withBusiness(db, a, (trx) =>
        trx.insertInto("staff").values({ business_id: b, name: "Sneaky", role: "cashier" }).execute(),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("refuses moving a row to another business", async () => {
    await expect(
      withBusiness(db, a, (trx) =>
        trx.updateTable("staff").set({ business_id: b }).where("name", "=", "Ann").execute(),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("shows nothing when no business is set", async () => {
    const rows = await db.transaction().execute(async (trx) => {
      await sql`SET LOCAL ROLE pos_app`.execute(trx);
      return trx.selectFrom("staff").selectAll().execute();
    });
    expect(rows).toEqual([]);
  });

  it("keeps the app role out of the migrations table", async () => {
    await expect(
      db.transaction().execute(async (trx) => {
        await sql`SET LOCAL ROLE pos_app`.execute(trx);
        return sql`SELECT * FROM schema_migrations`.execute(trx);
      }),
    ).rejects.toThrow(/permission denied/);
  });

  it("ends the role switch with the transaction", async () => {
    await withBusiness(db, a, async () => undefined);
    const { rows } = await sql<{ r: string }>`SELECT current_user AS r`.execute(db);
    expect(rows[0]!.r).not.toBe("pos_app");
  });
});
