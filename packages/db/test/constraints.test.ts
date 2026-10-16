import { beforeEach, describe, expect, it } from "vitest";
import { hasDemoData, listDemoStaff, seedDemo } from "../seed/demo.ts";
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

describe("demo seed", () => {
  it("creates one business with a staff member per role, all marked demo", async () => {
    expect(await hasDemoData(db)).toBe(false);
    const id = await seedDemo(db);
    expect(await hasDemoData(db)).toBe(true);

    const staff = await listDemoStaff(db);
    expect(staff.map((s) => s.role)).toEqual(["owner", "manager", "cashier", "groomer"]);
    expect(staff.every((s) => s.businessId === id && s.name.endsWith("(DEMO)"))).toBe(true);

    const notDemo = await db.selectFrom("staff").select("id").where("is_demo", "=", false).execute();
    expect(notDemo).toEqual([]);
  });
});
