import type { Kysely } from "kysely";
import { beforeEach, describe, expect, it } from "vitest";
import type { Ctx, CustomerInput } from "@pet-pos/core";
import { ensureDemo, listDemoStaff, withBusiness, type DB } from "@pet-pos/db";
import { createTestDb, insertBusiness } from "@pet-pos/db/test-db";
import { invoke } from "../src/registry.ts";

let db: Kysely<DB>;
let owner: Ctx;
let manager: Ctx;
let cashier: Ctx;

const pat: CustomerInput = {
  name: "Pat Lee",
  phone: "(212) 555-0199",
  email: "pat@example.com",
  street: "1 Oak Ave",
  city: "Springfield",
  state: "il",
  zip: "62701",
  birthday: "",
  smsOptIn: true,
  notes: "",
};

beforeEach(async () => {
  ({ db } = await createTestDb());
  const businessId = await ensureDemo(db);
  const staff = await listDemoStaff(db);
  const ctx = (role: Ctx["role"]): Ctx => ({
    businessId,
    role,
    staffId: staff.find((s) => s.role === role)!.id,
  });
  owner = ctx("owner");
  manager = ctx("manager");
  cashier = ctx("cashier");
});

describe("demo seed", () => {
  it("adds sample customers and a punch card", async () => {
    const cards = await invoke(db, cashier, "searchCustomers", { q: "" });
    expect(cards.map((c) => c.name)).toEqual([
      "Sample Cat Parent (DEMO)",
      "Sample Customer (DEMO)",
      "Sample Family (DEMO)",
    ]);
    const sample = cards.find((c) => c.name === "Sample Customer (DEMO)")!;
    expect(sample.punchCards).toMatchObject([
      { programName: "Sample dry food club (DEMO)", balance: 11, buyCount: 12 },
    ]);
  });
});

describe("demo seed after deletes", () => {
  it("doesn't bring deleted sample customers back on the next visit", async () => {
    for (const c of await invoke(db, owner, "searchCustomers", { q: "" }))
      await invoke(db, owner, "deleteCustomer", { id: c.id });
    await ensureDemo(db);
    expect(await invoke(db, owner, "searchCustomers", { q: "" })).toEqual([]);
  });

  it("records a part already loaded by an older version without loading it twice", async () => {
    await db.deleteFrom("demo_seed_parts").execute();
    await ensureDemo(db);
    expect(await invoke(db, owner, "searchCustomers", { q: "" })).toHaveLength(3);
    expect(await invoke(db, owner, "listProducts", {})).toHaveLength(4);
  });
});

describe("saveCustomer", () => {
  it("stores the phone as 10 digits and the state in capitals", async () => {
    const { id } = await invoke(db, cashier, "saveCustomer", { customer: pat });
    const p = await invoke(db, cashier, "getCustomer", { id });
    expect(p).toMatchObject({ phone: "2125550199", state: "IL", smsOptIn: true });
  });

  it("refuses a bad phone with the field's message", async () => {
    await expect(
      invoke(db, cashier, "saveCustomer", { customer: { ...pat, phone: "555-0100" } }),
    ).rejects.toMatchObject({ fields: { phone: "Enter a 10-digit phone number." } });
  });

  it("explains a phone or email that's already taken", async () => {
    await expect(
      invoke(db, cashier, "saveCustomer", {
        customer: { ...pat, phone: "212-555-0100", email: "" },
      }),
    ).rejects.toThrow("Another customer already has that phone number.");
    await expect(
      invoke(db, cashier, "saveCustomer", {
        customer: { ...pat, email: "CUSTOMER.demo@example.com" },
      }),
    ).rejects.toThrow("Another customer already has that email.");
  });
});

describe("finding customers", () => {
  it("matches name, email and part of a phone", async () => {
    const names = async (q: string) =>
      (await invoke(db, cashier, "searchCustomers", { q })).map((c) => c.name);
    expect(await names("family")).toEqual(["Sample Family (DEMO)"]);
    expect(await names("customer.demo@")).toEqual(["Sample Customer (DEMO)"]);
    expect(await names("555-0101")).toEqual(["Sample Cat Parent (DEMO)"]);
    expect(await names("(212) 555")).toHaveLength(3);
    expect(await names("01")).toEqual([]);
  });

  it("looks up by phone typed any way", async () => {
    expect((await invoke(db, cashier, "lookupByPhone", { phone: "+1 (212) 555-0102" }))?.name).toBe(
      "Sample Family (DEMO)",
    );
    expect(await invoke(db, cashier, "lookupByPhone", { phone: "555" })).toBeNull();
  });
});

describe("deleteCustomer", () => {
  it("previews, deletes everything, and audits without contact details", async () => {
    const [sample] = await invoke(db, owner, "searchCustomers", { q: "Sample Customer" });
    expect(await invoke(db, manager, "deletePreview", { id: sample!.id })).toEqual({
      name: "Sample Customer (DEMO)",
      punchCards: 1,
    });

    await invoke(db, manager, "deleteCustomer", { id: sample!.id });
    await expect(invoke(db, owner, "getCustomer", { id: sample!.id })).rejects.toThrow(/doesn't exist/);

    const log = await withBusiness(db, owner.businessId, (trx) =>
      trx.selectFrom("audit_log").select(["action", "entity_id", "before", "after", "staff_id"]).execute(),
    );
    expect(log).toEqual([
      {
        action: "customer.delete",
        entity_id: sample!.id,
        before: {
          name: "Sample Customer (DEMO)",
          punch_cards: 1,
        },
        after: null,
        staff_id: manager.staffId,
      },
    ]);
    const text = JSON.stringify(log);
    for (const secret of ["2125550100", "customer.demo@example.com", "12 Sample St"])
      expect(text).not.toContain(secret);
  });

  it("is only for owners and managers", async () => {
    const [sample] = await invoke(db, owner, "searchCustomers", { q: "Sample Customer" });
    await expect(invoke(db, cashier, "deleteCustomer", { id: sample!.id })).rejects.toThrow(/permission/);
    await expect(invoke(db, cashier, "deletePreview", { id: sample!.id })).rejects.toThrow(/permission/);
  });
});

describe("separation between businesses", () => {
  it("never shows, changes or deletes another business's customers", async () => {
    const other = await insertBusiness(db, "other-store");
    const staff = await db
      .insertInto("staff")
      .values({ business_id: other, name: "Olga", role: "owner" })
      .returning("id")
      .executeTakeFirstOrThrow();
    const otherCtx: Ctx = { businessId: other, staffId: staff.id, role: "owner" };
    const [sample] = await invoke(db, owner, "searchCustomers", { q: "Sample Customer" });

    expect(await invoke(db, otherCtx, "searchCustomers", { q: "" })).toEqual([]);
    expect(await invoke(db, otherCtx, "lookupByPhone", { phone: "2125550100" })).toBeNull();
    await expect(invoke(db, otherCtx, "getCustomer", { id: sample!.id })).rejects.toThrow(/doesn't exist/);
    await expect(invoke(db, otherCtx, "deleteCustomer", { id: sample!.id })).rejects.toThrow(/doesn't exist/);
    await expect(invoke(db, otherCtx, "saveCustomer", { id: sample!.id, customer: pat })).rejects.toThrow(
      /doesn't exist/,
    );

    // The same phone is fine in a different business.
    await invoke(db, otherCtx, "saveCustomer", { customer: { ...pat, phone: "2125550100" } });
  });
});
