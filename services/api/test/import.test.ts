import type { Kysely } from "kysely";
import { beforeEach, describe, expect, it } from "vitest";
import type { Ctx, ImportType } from "@pet-pos/core";
import { ensureDemo, listDemoStaff, withBusiness, type DB } from "@pet-pos/db";
import { createTestDb, insertBusiness } from "@pet-pos/db/test-db";
import { CHUNK_SIZE } from "../src/handlers/import.ts";
import { invoke } from "../src/registry.ts";

let db: Kysely<DB>;
let owner: Ctx;
let manager: Ctx;
let cashier: Ctx;

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

type Rows = Record<string, string>[];

/** Runs a whole file the way the screen does: start, chunks of 500, finish. */
async function importAll(ctx: Ctx, type: ImportType, rows: Rows, chunk = CHUNK_SIZE) {
  const { batchId } = await invoke(db, ctx, "startImport", {
    type,
    fileName: `${type}.csv`,
    totalRows: rows.length,
  });
  const skips: { row: number; reason: string }[] = [];
  const warnings: { row: number; message: string }[] = [];
  for (let i = 0; i < rows.length; i += chunk) {
    const res = await invoke(db, ctx, "importChunk", { batchId, offset: i, rows: rows.slice(i, i + chunk) });
    skips.push(...res.skips);
    warnings.push(...res.warnings);
  }
  const batch = await invoke(db, ctx, "finishImport", { batchId });
  return { batchId, batch, skips, warnings };
}

const customers = (ctx: Ctx = owner) => invoke(db, ctx, "searchCustomers", { q: "" });
const products = () => invoke(db, owner, "listProducts", { includeArchived: true });

describe("customers", () => {
  it("matches on phone, then email, and creates the rest", async () => {
    const { batch, skips } = await importAll(owner, "customers", [
      // Existing by phone (typed differently): adds a street, keeps everything else.
      { name: "", phone: "212.555.0100", street: "99 New St" },
      // Existing by email.
      { name: "Family Renamed (DEMO)", email: "FAMILY.demo@example.com" },
      // New.
      { first: "Pat", last: "Lee", phone: "(212) 555-0199", state: "il", zip: "2134", smsOptIn: "yes" },
    ]);
    expect(skips).toEqual([]);
    expect(batch).toMatchObject({ created: 1, updated: 2, skipped: 0, status: "done" });
    const all = await customers();
    expect(all.find((c) => c.phone === "2125550100")).toMatchObject({
      name: "Sample Customer (DEMO)",
      street: "99 New St",
    });
    expect(all.find((c) => c.phone === "2125550102")?.name).toBe("Family Renamed (DEMO)");
    expect(all.find((c) => c.phone === "2125550199")).toMatchObject({
      name: "Pat Lee",
      state: "IL",
      zip: "02134",
    });
  });

  it("skips rows with a reason", async () => {
    const { skips } = await importAll(owner, "customers", [
      { name: "No Contact" },
      { name: "Short Phone", phone: "555-0100" },
      { name: "", phone: "2125550188" },
      { name: "Two People", phone: "2125550100", email: "family.demo@example.com" },
    ]);
    expect(skips).toEqual([
      { row: 2, reason: "No phone or email" },
      { row: 3, reason: "Phone isn't 10 digits" },
      { row: 4, reason: "No name" },
      { row: 5, reason: "Phone and email belong to two different customers" },
    ]);
  });

  it("warns about cells it can't read and imports the rest of the row", async () => {
    const { warnings, skips } = await importAll(owner, "customers", [
      {
        name: "Pat",
        phone: "2125550199",
        birthday: "13/45/90",
        smsOptIn: "maybe",
        state: "Illinois",
        email: "pat@",
      },
    ]);
    expect(skips).toEqual([]);
    expect(warnings.map((w) => w.message)).toEqual([
      'Email "pat@" doesn\'t look like an email, left out',
      'State "Illinois" isn\'t a 2-letter state, left blank',
      'Birthday "13/45/90" isn\'t a date, left blank',
      'SMS opt-in "maybe" isn\'t yes or no, left as it was',
    ]);
    expect((await customers()).find((c) => c.name === "Pat")).toMatchObject({
      email: null,
      state: null,
      birthday: null,
    });
  });

  it("updates instead of duplicating when a customer appears twice in one file", async () => {
    const { batch } = await importAll(owner, "customers", [
      { name: "Pat", phone: "2125550199" },
      { name: "Pat Lee", phone: "2125550199", email: "pat@example.com" },
    ]);
    expect(batch).toMatchObject({ created: 1, updated: 1 });
    const pats = (await customers()).filter((c) => c.phone === "2125550199");
    expect(pats).toMatchObject([{ name: "Pat Lee", email: "pat@example.com" }]);
  });
});

describe("products", () => {
  it("matches on SKU in any case, then barcode, and keeps stock as moves", async () => {
    const { batch, warnings } = await importAll(owner, "products", [
      { sku: "0001", price: "$66.99", onHand: "20" },
      { sku: "", barcode: "", name: "No code" },
      { sku: "N-1", name: "New Kibble", price: "9.99", cost: "abc", onHand: "5", program: "Mystery Club" },
      { sku: "N-2", name: "No price" },
      { sku: "N-3", name: "Bad price", price: "twelve" },
    ]);
    expect(batch).toMatchObject({ created: 1, updated: 1, skipped: 3 });
    expect(warnings.map((w) => w.message)).toEqual([
      'Cost "abc" isn\'t an amount, left as it was',
      'Unknown program "Mystery Club", imported without it',
    ]);
    const all = await products();
    expect(all.find((p) => p.sku === "0001")).toMatchObject({ priceCents: 6699, onHand: 20 });
    expect(all.find((p) => p.sku === "N-1")).toMatchObject({
      priceCents: 999,
      onHand: 5,
      astroProgramId: null,
    });

    const log = await withBusiness(db, owner.businessId, (trx) =>
      trx.selectFrom("audit_log").select(["action", "before", "after"]).execute(),
    );
    expect(log).toEqual([
      {
        action: "product.price_change",
        before: { price_cents: 6499, cost_cents: 4300, wholesale_cents: null },
        after: { price_cents: 6699, cost_cents: 4300, wholesale_cents: null, via: "import" },
      },
    ]);
  });

  it("reads wholesale price, our cost and royalty, from the column names stores use", async () => {
    const { warnings } = await importAll(owner, "products", [
      {
        sku: "G-1",
        name: "Fences",
        price: "25",
        wholesale: "12.50",
        cost: "6",
        royalty: "10%",
        royaltyPayee: "Ada",
      },
      { sku: "G-2", name: "Locked Out", price: "20", wholesale: "lots", royalty: "120" },
    ]);
    expect(warnings.map((w) => w.message)).toEqual([
      'Wholesale price "lots" isn\'t an amount, left as it was',
      'Royalty "120" isn\'t a percent from 0 to 100, left as it was',
    ]);
    const all = await products();
    expect(all.find((p) => p.sku === "G-1")).toMatchObject({
      priceCents: 2500,
      wholesaleCents: 1250,
      costCents: 600,
      royaltyMpct: 10_000,
      royaltyPayee: "Ada",
    });
    expect(all.find((p) => p.sku === "G-2")).toMatchObject({ wholesaleCents: null, royaltyMpct: 0 });
  });

  it("matches by barcode without renaming our SKU", async () => {
    await importAll(owner, "products", [{ sku: "B-1", name: "One", price: "1", barcode: "999" }]);
    const { warnings, batch } = await importAll(owner, "products", [
      { sku: "DIST-77", barcode: "999", price: "1.50" },
    ]);
    expect(batch).toMatchObject({ created: 0, updated: 1 });
    expect(warnings[0]!.message).toBe("Matched by barcode to SKU B-1; SKU left as it was");
    expect((await products()).find((p) => p.barcode === "999")).toMatchObject({
      sku: "B-1",
      priceCents: 150,
    });
  });

  it("skips a barcode another product already uses, without stopping the chunk", async () => {
    await importAll(owner, "products", [
      { sku: "B-1", name: "One", price: "1", barcode: "999" },
      { sku: "B-2", name: "Two", price: "1" },
    ]);
    const { skips, batch } = await importAll(owner, "products", [
      { sku: "B-2", barcode: "999" },
      { sku: "B-3", name: "Three", price: "1" },
    ]);
    expect(skips).toEqual([{ row: 2, reason: "Another product already has that barcode" }]);
    expect(batch).toMatchObject({ created: 1, skipped: 1 });
  });
});

describe("Astro programs and punches", () => {
  it("matches programs by name in any case", async () => {
    const { batch, skips } = await importAll(owner, "programs", [
      { name: "sample DRY food club (demo)", buyCount: "10", reward: "Free bag" },
      { name: "Cat club", buyCount: "8" },
      { name: "Bad", buyCount: "1" },
    ]);
    expect(batch).toMatchObject({ created: 1, updated: 1, skipped: 1 });
    expect(skips[0]!.reason).toBe("Buy count missing or under 2");
    const programs = await invoke(db, owner, "listPrograms", undefined);
    expect(programs.map((p) => [p.name, p.buyCount, p.rewardText])).toEqual([
      ["Cat club", 8, "Reward"],
      ["Sample dry food club (DEMO)", 10, "Free bag"],
    ]);
  });

  it("sets punch balances to the file's number", async () => {
    const { skips } = await importAll(owner, "punches", [
      { phone: "2125550100", program: "Sample dry food club (DEMO)", count: "5" },
      { email: "family.demo@example.com", program: "sample dry food club (demo)", count: "0" },
      { phone: "2125550101", program: "Unknown club", count: "3" },
      { phone: "2125550101", program: "Sample dry food club (DEMO)", count: "lots" },
      { phone: "2125559999", program: "Sample dry food club (DEMO)", count: "3" },
    ]);
    expect(skips.map((s) => s.reason)).toEqual([
      'Unknown program "Unknown club"',
      "Punch count isn't a number",
      "No customer with that phone or email",
    ]);
    const all = await customers();
    expect(all.find((c) => c.phone === "2125550100")!.punchCards[0]!.balance).toBe(5);
    expect(all.find((c) => c.phone === "2125550102")!.punchCards).toEqual([]);
  });
});

describe("preview", () => {
  it("saves nothing and predicts the real import exactly", async () => {
    const rows: Rows = [
      { name: "", phone: "2125550100", street: "99 New St" },
      { name: "Pat", phone: "2125550199" },
      { name: "Bad", phone: "123" },
    ];
    const before = await customers();
    const preview = await invoke(db, owner, "previewImport", { type: "customers", rows });
    expect(preview).toMatchObject({ rows: 3, created: 1, updated: 1, skipped: 1 });
    expect(preview.sample.map((s) => s.action)).toEqual(["update", "new", "skip"]);
    expect(await customers()).toEqual(before);
    expect(await invoke(db, owner, "listImports", undefined)).toEqual([]);

    const { batch } = await importAll(owner, "customers", rows);
    expect(batch).toMatchObject({
      created: preview.created,
      updated: preview.updated,
      skipped: preview.skipped,
    });
  });
});

describe("chunks", () => {
  it("gives the same result in chunks of 500 as in one pass", async () => {
    const rows: Rows = Array.from({ length: 1200 }, (_, i) => ({
      name: `Bulk ${i}`,
      phone: `31255${String(i).padStart(5, "0")}`,
      ...(i === 700 ? { phone: "bad" } : {}),
    }));
    rows.push({ name: "Bulk 5 again", phone: "3125500005" });
    const { batch, skips } = await importAll(owner, "customers", rows);
    expect(batch).toMatchObject({ totalRows: 1201, created: 1199, updated: 1, skipped: 1 });
    expect(skips).toEqual([{ row: 702, reason: "Phone isn't 10 digits" }]);
    expect((await invoke(db, owner, "searchCustomers", { q: "bulk 5 again" })).length).toBe(1);
  });

  it("refuses chunks bigger than 500", async () => {
    const { batchId } = await invoke(db, owner, "startImport", {
      type: "customers",
      fileName: "x.csv",
      totalRows: 501,
    });
    const rows = Array.from({ length: 501 }, (_, i) => ({ name: `X${i}`, phone: "" }));
    await expect(invoke(db, owner, "importChunk", { batchId, offset: 0, rows })).rejects.toThrow(/up to/);
  });
});

describe("undo", () => {
  it("deletes what it created, restores what it changed, and reverses stock", async () => {
    const { batchId } = await importAll(owner, "products", [
      { sku: "0001", price: "70.00", onHand: "20" },
      { sku: "U-1", name: "Undo me", price: "5", onHand: "3" },
    ]);
    await importAll(owner, "customers", [{ name: "Undo Person", phone: "2125550166" }]);

    const res = await invoke(db, manager, "undoImport", { batchId });
    expect(res).toMatchObject({ deleted: 1, restored: 2, kept: [] });
    const all = await products();
    expect(all.find((p) => p.sku === "0001")).toMatchObject({ priceCents: 6499, onHand: 14 });
    expect(all.find((p) => p.sku === "U-1")).toBeUndefined();
    // The other batch is untouched.
    expect((await customers()).some((c) => c.name === "Undo Person")).toBe(true);
    await expect(invoke(db, manager, "undoImport", { batchId })).rejects.toThrow(/already undone/);
    const list = await invoke(db, owner, "listImports", undefined);
    expect(list.find((b) => b.id === batchId)?.status).toBe("undone");
  });

  it("puts a blank wholesale price back to blank", async () => {
    const { batchId } = await importAll(owner, "products", [{ sku: "0001", wholesale: "40", royalty: "5" }]);
    expect((await products()).find((p) => p.sku === "0001")).toMatchObject({
      wholesaleCents: 4000,
      royaltyMpct: 5000,
    });
    await invoke(db, manager, "undoImport", { batchId });
    expect((await products()).find((p) => p.sku === "0001")).toMatchObject({
      wholesaleCents: null,
      royaltyMpct: 0,
    });
    const log = await withBusiness(db, owner.businessId, (trx) =>
      trx
        .selectFrom("audit_log")
        .select(["action", "after"])
        .where("action", "=", "product.price_change")
        .orderBy("created_at")
        .execute(),
    );
    expect(log.map((l) => l.after)).toEqual([
      { price_cents: 6499, cost_cents: 4300, wholesale_cents: 4000, via: "import" },
      { price_cents: 6499, cost_cents: 4300, wholesale_cents: null, via: "import undo" },
    ]);
  });

  it("keeps fields edited after the import and says so", async () => {
    const { batchId } = await importAll(owner, "customers", [
      { name: "", phone: "2125550100", street: "1 Import Rd", city: "Importville" },
    ]);
    const sample = (await customers()).find((c) => c.phone === "2125550100")!;
    const profile = await invoke(db, owner, "getCustomer", { id: sample.id });
    await invoke(db, owner, "saveCustomer", {
      id: sample.id,
      customer: {
        name: profile.name,
        phone: "2125550100",
        email: profile.email ?? "",
        street: "5 Edited Ave",
        city: profile.city ?? "",
        state: profile.state ?? "",
        zip: profile.zip ?? "",
        birthday: profile.birthday ?? "",
        smsOptIn: profile.smsOptIn,
        notes: "",
      },
    });

    const res = await invoke(db, owner, "undoImport", { batchId });
    expect(res.kept).toEqual([
      'Customer "Sample Customer (DEMO)": street was changed after the import, kept',
    ]);
    const after = await invoke(db, owner, "getCustomer", { id: sample.id });
    expect(after).toMatchObject({ street: "5 Edited Ave", city: "Springfield" });
  });

  it("puts back punch balances it replaced and audits deleted customers", async () => {
    const before = (await customers()).find((c) => c.phone === "2125550100")!.punchCards[0]!.balance;
    const punches = await importAll(owner, "punches", [
      { phone: "2125550100", program: "Sample dry food club (DEMO)", count: "2" },
    ]);
    await invoke(db, owner, "undoImport", { batchId: punches.batchId });
    expect((await customers()).find((c) => c.phone === "2125550100")!.punchCards[0]!.balance).toBe(before);

    const people = await importAll(owner, "customers", [{ name: "Temp", phone: "2125550155" }]);
    expect(await invoke(db, owner, "undoPreview", { batchId: people.batchId })).toEqual({
      creates: { customer: 1 },
      updates: 0,
    });
    await invoke(db, owner, "undoImport", { batchId: people.batchId });
    const log = await withBusiness(db, owner.businessId, (trx) =>
      trx
        .selectFrom("audit_log")
        .select(["action", "before"])
        .where("action", "=", "customer.delete")
        .execute(),
    );
    expect(log).toEqual([{ action: "customer.delete", before: { name: "Temp", via: "import undo" } }]);
  });
});

describe("access", () => {
  it("is for owners and managers only", async () => {
    await expect(
      invoke(db, cashier, "previewImport", { type: "customers", rows: [{ name: "X", phone: "2125550111" }] }),
    ).rejects.toThrow(/permission/);
    await expect(invoke(db, cashier, "listImports", undefined)).rejects.toThrow(/permission/);
  });

  it("keeps imports separate between businesses", async () => {
    const other = await insertBusiness(db, "other-store");
    await db.insertInto("locations").values({ business_id: other, name: "Other" }).execute();
    const staff = await db
      .insertInto("staff")
      .values({ business_id: other, name: "Olga", role: "owner" })
      .returning("id")
      .executeTakeFirstOrThrow();
    const otherCtx: Ctx = { businessId: other, staffId: staff.id, role: "owner" };

    // The demo store's phone is a new customer in the other store.
    const { batch, batchId } = await importAll(otherCtx, "customers", [
      { name: "Olga's customer", phone: "2125550100" },
    ]);
    expect(batch.created).toBe(1);
    expect(await invoke(db, owner, "listImports", undefined)).toEqual([]);
    await expect(invoke(db, owner, "undoImport", { batchId })).rejects.toThrow(/doesn't exist/);
    expect((await customers()).find((c) => c.phone === "2125550100")!.name).toBe("Sample Customer (DEMO)");
  });
});
