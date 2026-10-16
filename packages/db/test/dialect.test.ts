import { describe, expect, it } from "vitest";
import { createTestDb, insertBusiness } from "../src/test-db.ts";

describe("PGlite dialect", () => {
  it("runs concurrent transactions one at a time without mixing them", async () => {
    const { db } = await createTestDb();
    const a = await insertBusiness(db, "store-a");

    const ok = db.transaction().execute(async (trx) => {
      await trx.insertInto("staff").values({ business_id: a, name: "Kept", role: "cashier" }).execute();
    });
    const failing = db.transaction().execute(async (trx) => {
      await trx
        .insertInto("staff")
        .values({ business_id: a, name: "Rolled back", role: "cashier" })
        .execute();
      throw new Error("boom");
    });
    const plain = db.selectFrom("businesses").select("slug").execute();

    await expect(failing).rejects.toThrow("boom");
    await ok;
    expect((await plain).map((r) => r.slug)).toEqual(["store-a"]);

    const names = await db.selectFrom("staff").select("name").execute();
    expect(names.map((r) => r.name)).toEqual(["Kept"]);
  });

  it("reports affected rows", async () => {
    const { db } = await createTestDb();
    const a = await insertBusiness(db, "store-a");
    await db.insertInto("staff").values({ business_id: a, name: "Ann", role: "owner" }).execute();
    const res = await db.updateTable("staff").set({ active: false }).executeTakeFirst();
    expect(res.numUpdatedRows).toBe(1n);
  });
});
