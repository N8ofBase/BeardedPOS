import type { Kysely, Selectable } from "kysely";
import { beforeEach, describe, expect, it } from "vitest";
import { todayIso, type Ctx } from "@bearded/core";
import { ensureDemo, listDemoStaff, withBusiness, type DB } from "@bearded/db";
import { createTestDb, insertBusiness } from "@bearded/db/test-db";
import { invoke } from "../src/registry.ts";

let db: Kysely<DB>;
let businessId: string;
let owner: Ctx;
let manager: Ctx;
let cashier: Ctx;
let sku: Record<string, { id: string }>;
let sampleCustomer: string;
const today = todayIso();

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
  manager = ctx("manager");
  cashier = ctx("cashier");
  const products = await invoke(db, owner, "listProducts", {});
  sku = Object.fromEntries(products.map((p) => [p.sku, p]));
  sampleCustomer = (await invoke(db, owner, "lookupByPhone", { phone: "2125550100" }))!.id;
});

const open = (lines: [string, number][], customer = false) =>
  invoke(db, cashier, "startCheckout", {
    customerId: customer ? sampleCustomer : null,
    lines: lines.map(([code, qty], i) => ({
      key: String(i),
      productId: sku[code]!.id,
      qty,
    })),
    discounts: [],
  });
const cash = (saleId: string, cents: number) =>
  invoke(db, cashier, "payCash", { saleId, amountCents: cents, tenderedCents: cents });
async function card(saleId: string, cents: number) {
  const p = await invoke(db, cashier, "startCardPayment", { saleId, amountCents: cents });
  await invoke(db, cashier, "simulateTerminalResult", { paymentId: p.paymentId, outcome: "approved" });
}
const rows = <T extends keyof DB>(table: T): Promise<Selectable<DB[T]>[]> =>
  withBusiness(db, businessId, (trx) =>
    trx
      .selectFrom(table as "sales")
      .selectAll()
      .execute(),
  ) as unknown as Promise<Selectable<DB[T]>[]>;

describe("end of day", () => {
  /**
   * Today: a cash sale ($41.70), a card sale ($13.90), a split sale ($5.00 cash + $8.90 card),
   * a sale voided after $5.00 cash, and a cash refund ($13.90) of yesterday's sale.
   */
  async function aDay() {
    const a = await open([["0003", 3]]);
    await cash(a.saleId, a.totalCents);
    const b = await open([["0003", 1]]);
    await card(b.saleId, b.totalCents);
    const c = await open([["0003", 1]]);
    await cash(c.saleId, 500);
    await card(c.saleId, c.totalCents - 500);
    const d = await open([["0003", 1]]);
    await cash(d.saleId, 500);
    await invoke(db, cashier, "cancelSale", { saleId: d.saleId });

    const e = await open([["0003", 1]]);
    await cash(e.saleId, e.totalCents);
    const yesterday = new Date(Date.now() - 86_400_000 * 1.5);
    await db
      .updateTable("sales")
      .set({ created_at: yesterday, paid_at: yesterday })
      .where("id", "=", e.saleId)
      .execute();
    await db
      .updateTable("payments")
      .set({ completed_at: yesterday })
      .where("sale_id", "=", e.saleId)
      .execute();
    const line = (await invoke(db, owner, "getSale", { id: e.saleId })).lines[0]!.id;
    await invoke(db, owner, "refundSale", {
      saleId: e.saleId,
      lines: [{ saleLineId: line, qty: 1 }],
      restock: true,
      reason: "changed_mind",
    });
  }

  it("works out expected cash and the card total for the day", async () => {
    await aDay();
    const s = await invoke(db, manager, "drawerSummary", { day: today });
    expect(s).toMatchObject({
      startingCents: 10000,
      cashInCents: 4170 + 500,
      cashOutCents: 1390,
      cardCents: 1390 + 890,
      counts: [],
    });
    expect(s.totals).toMatchObject({
      count: 3,
      grossCents: 4170 + 1390 + 1390,
      refundCount: 1,
      refundCents: 1390,
    });

    // The Sales page KPIs are the same numbers.
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    const to = new Date(from.getTime() + 86_400_000);
    const kpis = await invoke(db, owner, "listSales", { from: from.toISOString(), to: to.toISOString() });
    expect(kpis).toMatchObject({ cashCents: 4670 - 1390, cardCents: 2280, totalCents: 6950 - 1390 });
  });

  it("saves counts, keeps recounts, and asks for a note when short", async () => {
    await aDay();
    // Expected: 100.00 + 46.70 − 13.90 = 132.80.
    const even = await invoke(db, manager, "saveDrawerCount", {
      day: today,
      startingCents: 10000,
      denominations: { "10000": 1, "2000": 1, "1000": 1, "100": 2, "25": 3, "5": 1 },
    });
    expect(even).toMatchObject({
      expectedCents: 13280,
      countedCents: 13280,
      overShortCents: 0,
      label: "Even",
      depositCents: 3280,
      leaveCents: 10000,
    });
    const short = await invoke(db, manager, "saveDrawerCount", {
      day: today,
      startingCents: 10000,
      denominations: null,
      countedCents: 13000,
    });
    expect(short.label).toBe("Short $2.80");
    await expect(
      invoke(db, manager, "saveDrawerCount", {
        day: today,
        startingCents: 10000,
        denominations: null,
        countedCents: 12000,
      }),
    ).rejects.toThrow(/Add a note/);
    await invoke(db, owner, "saveDrawerCount", {
      day: today,
      startingCents: 10000,
      denominations: null,
      countedCents: 12000,
      note: "Gave change from the wrong drawer",
    });

    const s = await invoke(db, manager, "drawerSummary", { day: today });
    expect(s.counts.map((c) => c.overShortCents)).toEqual([-1280, -280, 0]);
    expect(await invoke(db, manager, "listDrawerCounts", { from: today, to: today })).toHaveLength(3);
    expect((await rows("audit_log")).filter((a) => a.action === "drawer.count")).toHaveLength(3);
  });

  it("refuses cashiers, future days and other businesses' numbers", async () => {
    await expect(invoke(db, cashier, "drawerSummary", { day: today })).rejects.toThrow(/permission/);
    await expect(invoke(db, owner, "drawerSummary", { day: "2999-01-01" })).rejects.toThrow(
      /hasn't happened/,
    );
    await aDay();
    await invoke(db, owner, "saveDrawerCount", {
      day: today,
      startingCents: 10000,
      denominations: null,
      countedCents: 13280,
    });
    const other = await insertBusiness(db, "other-store");
    await db.insertInto("locations").values({ business_id: other, name: "Other" }).execute();
    const st = await db
      .insertInto("staff")
      .values({ business_id: other, name: "O", role: "owner" })
      .returning("id")
      .executeTakeFirstOrThrow();
    const s = await invoke(db, { businessId: other, staffId: st.id, role: "owner" }, "drawerSummary", {
      day: today,
    });
    expect(s).toMatchObject({ cashInCents: 0, cardCents: 0, counts: [] });
  });
});

type Rows = Record<string, string>[];
async function importAll(rows: Rows) {
  const { batchId } = await invoke(db, owner, "startImport", {
    type: "orders",
    fileName: "orders.csv",
    totalRows: rows.length,
  });
  const res = await invoke(db, owner, "importChunk", { batchId, offset: 0, rows });
  const batch = await invoke(db, owner, "finishImport", { batchId });
  return { batchId, batch, skips: res.skips, warnings: res.warnings };
}

const phone = "(212) 555-0100";
const file = (): Rows => [
  { date: "2025-03-14", receipt: "A-1", phone, sku: "0003", qty: "2", unitPrice: "12.99" },
  { date: "3/14/2025", receipt: "A-1", phone, barcode: "0012345678905", lineTotal: "60.00" },
  { date: "2025-03-20", phone, item: "Old card game", lineTotal: "5.00" },
  { date: "2025-03-20", phone, item: "Old card game", qty: "2", lineTotal: "10.00" },
  { date: "2025-03-21", phone: "9995550000", item: "Dice", lineTotal: "1.00" },
];

describe("past orders import", () => {
  beforeEach(async () => {
    await db.updateTable("products").set({ barcode: "012345678905" }).where("sku", "=", "0001").execute();
  });

  it("groups rows into orders and matches customers and products", async () => {
    const before = await invoke(db, owner, "listProducts", { includeArchived: true });
    const preview = await invoke(db, owner, "previewImport", { type: "orders", rows: file() });
    expect(preview).toMatchObject({ created: 2, updated: 2, skipped: 1 });
    expect((await rows("sales")).filter((s) => s.source === "import")).toHaveLength(0);

    const { batch, skips, warnings } = await importAll(file());
    expect(batch).toMatchObject({ created: 2, updated: 2, skipped: 1 });
    expect(skips).toEqual([
      { row: 6, reason: "No customer with this phone or email. Import customers first." },
    ]);
    expect(warnings.map((w) => w.row)).toEqual([4, 5]);

    const imported = (await rows("sales")).filter((s) => s.source === "import");
    expect(imported.map((s) => [s.import_key, s.total_cents, s.receipt_number]).sort()).toEqual([
      ["A-1", 2598 + 6000, null],
      ["date:2025-03-20", 1500, null],
    ]);
    const lines = (await rows("sale_lines")).filter((l) => imported.some((s) => s.id === l.sale_id));
    expect(lines.find((l) => l.line_total_cents === 6000)!.product_id).toBe(sku["0001"]!.id);
    expect(lines.filter((l) => l.product_id === null).map((l) => l.name)).toEqual([
      "Old card game",
      "Old card game",
    ]);

    // No stock or payments.
    expect(await invoke(db, owner, "listProducts", { includeArchived: true })).toEqual(before);
    expect(await rows("payments")).toEqual([]);

    // Not on the Sales page; can't be refunded or opened as a receipt.
    const all = { from: "2000-01-01T00:00:00Z", to: "2100-01-01T00:00:00Z" };
    expect((await invoke(db, owner, "listSales", all)).sales).toEqual([]);
    await expect(
      invoke(db, owner, "refundPreview", { saleId: imported[0]!.id, lines: [], restock: true }),
    ).rejects.toThrow(/imported from the old system/);
  });

  it("skips orders already imported, and undo removes them", async () => {
    const first = await importAll(file());
    const again = await importAll(file());
    expect(again.batch).toMatchObject({ created: 0, updated: 0, skipped: 5 });
    expect(again.skips.filter((s) => s.reason === "Already imported")).toHaveLength(4);

    await invoke(db, owner, "undoImport", { batchId: first.batchId });
    expect((await rows("sales")).filter((s) => s.source === "import")).toEqual([]);
    expect((await importAll(file())).batch.created).toBe(2);
  });
});

describe("customer order history", () => {
  it("adds up imported and new orders, net of refunds, with most bought", async () => {
    await importAll([
      { date: "2025-03-14", receipt: "A-1", phone, sku: "0003", qty: "2", unitPrice: "12.99" },
      { date: "2025-03-20", phone, item: "Old card game", lineTotal: "5.00" },
    ]);
    const s = await open([["0003", 3]], true);
    await cash(s.saleId, s.totalCents);
    const line = (await invoke(db, owner, "getSale", { id: s.saleId })).lines[0]!.id;
    await invoke(db, owner, "refundSale", {
      saleId: s.saleId,
      lines: [{ saleLineId: line, qty: 1 }],
      restock: true,
      reason: "damaged",
    });

    const h = await invoke(db, cashier, "customerHistory", { id: sampleCustomer });
    expect(h).toMatchObject({ orders: 3, totalSpentCents: 2598 + 500 + 4170 - 1390, next: null });
    expect(new Date(h.firstVisit!).getFullYear()).toBe(2025);
    expect(h.mostBought[0]).toEqual({ name: "Sample Card Game (DEMO)", qty: 4 });
    expect(h.page.map((o) => o.label)).toEqual([`#${s.receiptNumber}`, "Imported order", "Imported #A-1"]);
    expect(h.page[0]!.refundedCents).toBe(1390);

    const usually = await invoke(db, cashier, "registerCustomer", { id: sampleCustomer });
    expect(usually.usuallyBuys.map((p) => p.sku)).toContain("0003");
  });

  it("pages 25 at a time", async () => {
    const days = Array.from({ length: 26 }, (_, i) => ({
      date: `2025-01-${String(i + 1).padStart(2, "0")}`,
      phone,
      item: "Card game",
      lineTotal: "1.00",
    }));
    await importAll(days);
    const p1 = await invoke(db, owner, "customerHistory", { id: sampleCustomer });
    expect(p1.page).toHaveLength(25);
    const p2 = await invoke(db, owner, "customerHistory", { id: sampleCustomer, before: p1.next });
    expect(p2.page.map((o) => new Date(o.date).getDate())).toEqual([1]);
    expect(p2.next).toBeNull();
  });
});
