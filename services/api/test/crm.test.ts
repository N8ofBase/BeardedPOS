import type { Kysely } from "kysely";
import { beforeEach, describe, expect, it } from "vitest";
import type { Ctx, CustomerInput } from "@pet-pos/core";
import { ensureDemo, listDemoStaff, withBusiness, type DB } from "@pet-pos/db";
import { createTestDb, insertBusiness } from "@pet-pos/db/test-db";
import { recordStoreContact, sqlClient } from "../src/handlers/crm.ts";
import { invoke } from "../src/registry.ts";

let db: Kysely<DB>;
let businessId: string;
let owner: Ctx;
let cashier: Ctx;

const blank: CustomerInput = {
  name: "",
  phone: "",
  email: "",
  street: "",
  city: "",
  state: "",
  zip: "",
  birthday: "",
  smsOptIn: false,
  notes: "",
};

beforeEach(async () => {
  ({ db } = await createTestDb());
  businessId = await ensureDemo(db);
  const staff = await listDemoStaff(db);
  const ctx = (role: Ctx["role"]): Ctx => ({
    businessId,
    role,
    staffId: staff.find((s) => s.role === role)!.id,
  });
  owner = ctx("owner");
  cashier = ctx("cashier");
});

const store = (c: Parameters<typeof recordStoreContact>[2], id = businessId) =>
  withBusiness(db, id, (trx) => recordStoreContact(sqlClient(trx), id, c));

describe("retailers", () => {
  it("saves a retailer with a store name and terms, and needs the store name", async () => {
    await expect(
      invoke(db, cashier, "saveCustomer", {
        customer: { ...blank, name: "Ann", email: "ann@shop.com", kind: "retailer" },
      }),
    ).rejects.toThrow("Add the store's name.");
    const { id } = await invoke(db, cashier, "saveCustomer", {
      customer: {
        ...blank,
        name: "Ann",
        email: "ann@shop.com",
        kind: "retailer",
        company: "Dice Den",
        wholesaleTerms: "Net 30",
        emailOptIn: true,
      },
    });
    const p = await invoke(db, cashier, "getCustomer", { id });
    expect(p).toMatchObject({
      kind: "retailer",
      company: "Dice Den",
      wholesaleTerms: "Net 30",
      emailOptIn: true,
    });
    expect((await invoke(db, cashier, "searchCustomers", { q: "dice" })).map((c) => c.name)).toEqual(["Ann"]);
    expect(
      (await invoke(db, cashier, "searchCustomers", { q: "", kind: "retailer" })).map((c) => c.company),
    ).toEqual(["Sample Game Shop (DEMO)", "Dice Den"].sort());
  });

  it("leaves type and opt-in alone when an older caller doesn't send them", async () => {
    const shop = (await invoke(db, owner, "searchCustomers", { q: "Sample Buyer" }))[0]!;
    const p = await invoke(db, owner, "getCustomer", { id: shop.id });
    await invoke(db, owner, "saveCustomer", {
      id: shop.id,
      customer: { ...blank, name: p.name, email: p.email!, phone: p.phone!, notes: "called" },
    });
    expect(await invoke(db, owner, "getCustomer", { id: shop.id })).toMatchObject({
      kind: "retailer",
      emailOptIn: true,
    });
  });

  it("totals what a retailer has earned us; cashiers can't see it", async () => {
    const shop = (await invoke(db, owner, "searchCustomers", { q: "Sample Buyer" }))[0]!;
    expect(await invoke(db, owner, "customerProfit", { customerId: shop.id })).toMatchObject({
      orders: 0,
      profitCents: 0,
    });
    await expect(invoke(db, cashier, "customerProfit", { customerId: shop.id })).rejects.toThrow(
      /permission/,
    );
  });
});

describe("tags", () => {
  it("tags a customer by name, adding new tags and matching any case", async () => {
    const c = (await invoke(db, cashier, "searchCustomers", { q: "Sample Cat" }))[0]!;
    await invoke(db, cashier, "setCustomerTags", {
      customerId: c.id,
      tags: ["vip (demo)", "Board game club"],
    });
    const tagged = (await invoke(db, cashier, "searchCustomers", { q: "Sample Cat" }))[0]!;
    expect(tagged.tags.map((t) => t.name)).toEqual(["Board game club", "VIP (DEMO)"]);
    const tags = await invoke(db, cashier, "listTags", undefined);
    expect(tags.find((t) => t.name === "VIP (DEMO)")!.customers).toBe(3);
    const club = tags.find((t) => t.name === "Board game club")!;
    expect(
      (await invoke(db, cashier, "searchCustomers", { q: "", tagId: club.id })).map((x) => x.id),
    ).toEqual([c.id]);
    await invoke(db, cashier, "setCustomerTags", { customerId: c.id, tags: [] });
    expect((await invoke(db, cashier, "searchCustomers", { q: "Sample Cat" }))[0]!.tags).toEqual([]);
  });

  it("renames and deletes tags (managers and owners only) and refuses duplicates", async () => {
    const vip = (await invoke(db, owner, "listTags", undefined)).find((t) => t.name === "VIP (DEMO)")!;
    await expect(invoke(db, cashier, "deleteTag", { id: vip.id })).rejects.toThrow(/permission/);
    await expect(invoke(db, owner, "saveTag", { name: "game NIGHT (demo)" })).rejects.toThrow(
      "already a tag",
    );
    await invoke(db, owner, "saveTag", { id: vip.id, name: "VIP" });
    expect((await invoke(db, owner, "listTags", undefined)).map((t) => t.name)).toContain("VIP");
    await invoke(db, owner, "deleteTag", { id: vip.id });
    expect((await invoke(db, owner, "listTags", undefined)).map((t) => t.name)).not.toContain("VIP");
  });
});

describe("timeline and follow-ups", () => {
  it("shows notes, follow-ups and sales, newest first", async () => {
    const shop = (await invoke(db, cashier, "searchCustomers", { q: "Sample Buyer" }))[0]!;
    await invoke(db, cashier, "addCustomerNote", {
      customerId: shop.id,
      text: "  Wants the Fences reprint ",
    });
    await invoke(db, cashier, "setFollowUp", {
      customerId: shop.id,
      on: "2030-01-15",
      note: "Call about reorder",
    });
    const t = await invoke(db, cashier, "customerTimeline", { customerId: shop.id });
    expect(t.map((e) => [e.kind, e.summary])).toEqual([
      ["follow_up", "Follow up on 2030-01-15: Call about reorder"],
      ["note", "Wants the Fences reprint"],
      ["note", "Met at the Gateway Game Expo. Carries family games."],
    ]);
    expect(t[1]!.staffName).toBeTruthy();
    const due = await invoke(db, cashier, "followUps", undefined);
    expect(due.find((f) => f.id === shop.id)).toMatchObject({ on: "2030-01-15", note: "Call about reorder" });
    await invoke(db, cashier, "setFollowUp", { customerId: shop.id, on: null, note: "" });
    expect((await invoke(db, cashier, "followUps", undefined)).find((f) => f.id === shop.id)).toBeUndefined();
    await expect(invoke(db, cashier, "addCustomerNote", { customerId: shop.id, text: " " })).rejects.toThrow(
      "Write the note",
    );
  });
});

describe("people the website meets", () => {
  it("adds a VIP signup as a customer, opted in and tagged VIP", async () => {
    const r = await store({ email: " New.Fan@Example.com ", source: "vip", optIn: true });
    expect(r.created).toBe(true);
    const p = await invoke(db, owner, "getCustomer", { id: r.customerId });
    expect(p).toMatchObject({ name: "new.fan@example.com", email: "new.fan@example.com", emailOptIn: true });
    expect(p.tags.map((t) => t.name)).toEqual(["VIP"]);
    const t = await invoke(db, owner, "customerTimeline", { customerId: r.customerId });
    expect(t.map((e) => e.kind)).toEqual(["vip_signup"]);
  });

  it("matches an existing customer by email, any case, and doesn't opt them in without asking", async () => {
    const r = await store({
      email: "FAMILY.demo@example.com",
      name: "Sam R.",
      source: "review",
      optIn: false,
      refId: "rev_1",
    });
    expect(r.created).toBe(false);
    const p = await invoke(db, owner, "getCustomer", { id: r.customerId });
    expect(p.name).toBe("Sample Family (DEMO)");
    const t = await invoke(db, owner, "customerTimeline", { customerId: r.customerId });
    expect(t[0]).toMatchObject({ kind: "review", summary: "Wrote a review on the website" });
  });

  it("matches on phone first and fills in a missing email", async () => {
    const r = await store({
      email: "cat@example.com",
      phone: "(212) 555-0101",
      source: "order",
      optIn: false,
    });
    const p = await invoke(db, owner, "getCustomer", { id: r.customerId });
    expect(p).toMatchObject({
      name: "Sample Cat Parent (DEMO)",
      email: "cat@example.com",
      emailOptIn: false,
    });
  });

  it("refuses a bad email", async () => {
    await expect(store({ email: "nope", source: "vip", optIn: true })).rejects.toThrow("Check the email");
  });

  it("keeps each business's customers apart", async () => {
    const other = await insertBusiness(db, "other");
    const r = await store({ email: "family.demo@example.com", source: "vip", optIn: true }, other);
    expect(r.created).toBe(true);
    const mine = await invoke(db, owner, "searchCustomers", { q: "family.demo" });
    expect(mine).toHaveLength(1);
    expect(mine[0]!.id).not.toBe(r.customerId);
  });
});

describe("removing demo data", () => {
  it("removes sample tags, the sample retailer and their timeline", async () => {
    await invoke(db, owner, "removeDemoData", undefined);
    expect(await invoke(db, owner, "listTags", undefined)).toEqual([]);
    expect(await invoke(db, owner, "followUps", undefined)).toEqual([]);
  });
});
