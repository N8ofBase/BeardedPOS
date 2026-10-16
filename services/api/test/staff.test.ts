import { beforeAll, describe, expect, it } from "vitest";
import { AppError, type Ctx } from "@pet-pos/core";
import { listDemoStaff, seedDemo } from "@pet-pos/db";
import { createTestDb, insertBusiness } from "@pet-pos/db/test-db";
import { invoke } from "../src/registry.ts";

let db: Awaited<ReturnType<typeof createTestDb>>["db"];
let owner: Ctx;
let cashier: Ctx;

beforeAll(async () => {
  ({ db } = await createTestDb());
  const businessId = await seedDemo(db);
  const staff = await listDemoStaff(db);
  const pick = (role: string) => staff.find((s) => s.role === role)!;
  owner = { businessId, staffId: pick("owner").id, role: "owner" };
  cashier = { businessId, staffId: pick("cashier").id, role: "cashier" };
});

describe("me", () => {
  it("returns the staff member, business and location", async () => {
    const res = await invoke(db, owner, "me", undefined);
    expect(res.staff).toMatchObject({ name: "Sample Owner (DEMO)", role: "owner" });
    expect(res.business.name).toBe("Sample Pet Store (DEMO)");
    expect(res.business.modules).toEqual({ astro: true, grooming: true });
    expect(res.location).toMatchObject({ name: "Main store (DEMO)", taxRateMpct: 7000 });
  });

  it("refuses a role that doesn't match the staff record", async () => {
    await expect(invoke(db, { ...cashier, role: "owner" }, "me", undefined)).rejects.toThrow(/role changed/);
  });

  it("can't see a staff member from another business", async () => {
    const other = await insertBusiness(db, "other-store");
    await expect(invoke(db, { ...owner, businessId: other }, "me", undefined)).rejects.toBeInstanceOf(
      AppError,
    );
  });
});

describe("listStaff", () => {
  it("lists the business's staff", async () => {
    const res = await invoke(db, cashier, "listStaff", undefined);
    expect(res).toHaveLength(4);
  });
});
