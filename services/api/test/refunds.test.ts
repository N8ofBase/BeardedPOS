import type { Kysely, Selectable } from "kysely";
import { beforeEach, describe, expect, it } from "vitest";
import type { AstroClient, Ctx } from "@pet-pos/core";
import { ensureDemo, listDemoStaff, withBusiness, type DB } from "@pet-pos/db";
import { createTestDb, insertBusiness } from "@pet-pos/db/test-db";
import { processAstroQueue } from "../src/astro/sender.ts";
import type { RefundSaleInput } from "../src/handlers/refunds.ts";
import { invoke } from "../src/registry.ts";

let db: Kysely<DB>;
let businessId: string;
let owner: Ctx;
let manager: Ctx;
let cashier: Ctx;
let sku: Record<string, { id: string }>;
let sampleCustomer: string;
let club: string;

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
  club = (await invoke(db, owner, "listPrograms", undefined))[0]!.id;
});

/** Rings and pays a sale: cash by default, or `cash` cents in cash and the rest on the card. */
async function paidSale(
  lines: [string, number][],
  opts: { customer?: boolean; rewards?: string[]; cash?: number } = {},
) {
  const s = await invoke(db, cashier, "startCheckout", {
    customerId: opts.customer ? sampleCustomer : null,
    lines: lines.map(([code, qty], i) => ({
      key: String(i),
      productId: sku[code]!.id,
      qty,
      applyOffer: false,
    })),
    rewards: opts.rewards ?? [],
    discounts: [],
  });
  if (s.paid) return s;
  const cash = opts.cash ?? s.totalCents;
  if (cash > 0)
    await invoke(db, cashier, "payCash", { saleId: s.saleId, amountCents: cash, tenderedCents: cash });
  if (cash < s.totalCents) {
    const card = await invoke(db, cashier, "startCardPayment", {
      saleId: s.saleId,
      amountCents: s.totalCents - cash,
    });
    await invoke(db, cashier, "simulateTerminalResult", { paymentId: card.paymentId, outcome: "approved" });
  }
  return s;
}

const lineIds = async (saleId: string) =>
  (await invoke(db, owner, "getSale", { id: saleId })).lines.map((l) => l.id);

const refund = (ctx: Ctx, saleId: string, lines: [string, number][], over: Partial<RefundSaleInput> = {}) =>
  invoke(db, ctx, "refundSale", {
    saleId,
    lines: lines.map(([saleLineId, qty]) => ({ saleLineId, qty })),
    restock: true,
    reason: "changed_mind",
    ...over,
  });

const onHand = async (code: string) =>
  (await invoke(db, owner, "listProducts", { includeArchived: true })).find((p) => p.sku === code)!.onHand;
const balance = async () =>
  (await invoke(db, owner, "getCustomer", { id: sampleCustomer })).punchCards.find(
    (c) => c.programId === club,
  )?.balance ?? 0;
/** Every row of a table, for the demo business. */
const rows = <T extends keyof DB>(table: T): Promise<Selectable<DB[T]>[]> =>
  withBusiness(db, businessId, (trx) =>
    trx
      .selectFrom(table as "refunds")
      .selectAll()
      .execute(),
  ) as unknown as Promise<Selectable<DB[T]>[]>;

describe("refund money", () => {
  it("refunds 1 of 3, then the other 2, adding up to exactly what was paid", async () => {
    // 3 × $12.99 = $38.97, tax 7% = $2.73 (2.7279), total $41.70.
    const s = await paidSale([["0003", 3]]);
    expect(s.totalCents).toBe(4170);
    const [line] = await lineIds(s.saleId);

    const p1 = await invoke(db, owner, "refundPreview", {
      saleId: s.saleId,
      lines: [{ saleLineId: line!, qty: 1 }],
      restock: true,
    });
    expect(p1).toMatchObject({
      amountCents: 1299,
      taxCents: 91,
      totalCents: 1390,
      label: "Hand back $13.90 cash",
    });
    const r1 = await refund(owner, s.saleId, [[line!, 1]]);
    expect(r1.totalCents).toBe(1390);

    const r2 = await refund(owner, s.saleId, [[line!, 2]]);
    expect(r2.totalCents).toBe(2780);
    expect(r1.totalCents + r2.totalCents).toBe(s.totalCents);

    const receipt = await invoke(db, owner, "getSale", { id: s.saleId });
    expect(receipt.refundedCents).toBe(4170);
    expect(receipt.refunds.map((r) => r.lines[0]!.qty)).toEqual([1, 2]);
  });

  it("refuses refunding more than is left", async () => {
    const s = await paidSale([["0003", 3]]);
    const [line] = await lineIds(s.saleId);
    await expect(refund(owner, s.saleId, [[line!, 4]])).rejects.toThrow(/refund 1 to 3/);
    await refund(owner, s.saleId, [[line!, 3]]);
    await expect(refund(owner, s.saleId, [[line!, 1]])).rejects.toThrow(/already been refunded in full/);
    await expect(refund(owner, s.saleId, [])).rejects.toThrow(/Pick the items/);
  });

  it("goes back to the card first, then cash", async () => {
    const s = await paidSale([["0003", 3]], { cash: 1000 });
    const [line] = await lineIds(s.saleId);
    const r = await refund(owner, s.saleId, [[line!, 3]]);
    expect(r.payments.map((p) => [p.method, p.amountCents])).toEqual([
      ["card", 3170],
      ["cash", 1000],
    ]);
    expect(r.label).toBe("Refund $31.70 to the card · Hand back $10.00 cash");
    const refs = await rows("refund_payments");
    expect(refs.find((p) => p.method === "card")!.provider_ref).toMatch(/^simrefund_/);
    const pays = await rows("payments");
    expect(pays.every((p) => p.refunded_cents === p.amount_cents)).toBe(true);
  });

  it("uses the same tax shares for older sales that didn't store them", async () => {
    // $12.99 + $8.99 = $21.98, tax 7% = $1.54; the rope toy's share is 63¢.
    const s = await paidSale([
      ["0003", 1],
      ["0004", 1],
    ]);
    const stored = (await rows("sale_lines")).map((l) => l.tax_cents).sort();
    expect(stored).toEqual([63, 91]);
    await db.updateTable("sale_lines").set({ tax_cents: null }).execute();
    const [, toy] = await lineIds(s.saleId);
    expect((await refund(owner, s.saleId, [[toy!, 1]])).totalCents).toBe(899 + 63);
  });

  it("refuses a sale that isn't paid", async () => {
    const s = await invoke(db, cashier, "startCheckout", {
      customerId: null,
      lines: [{ key: "1", productId: sku["0003"]!.id, qty: 1, applyOffer: false }],
      rewards: [],
      discounts: [],
    });
    await expect(
      invoke(db, owner, "refundPreview", { saleId: s.saleId, lines: [], restock: true }),
    ).rejects.toThrow(/isn't paid yet/);
  });
});

describe("refund stock, reasons and audit", () => {
  it("puts items back in stock, or not for damaged goods", async () => {
    const before = await onHand("0003");
    const s = await paidSale([["0003", 3]]);
    const [line] = await lineIds(s.saleId);
    await refund(owner, s.saleId, [[line!, 1]], { restock: true });
    expect(await onHand("0003")).toBe(before - 2);
    await refund(owner, s.saleId, [[line!, 1]], { restock: false, reason: "damaged" });
    expect(await onHand("0003")).toBe(before - 2);
  });

  it("needs a note for Other, and writes the audit log", async () => {
    const s = await paidSale([["0003", 1]]);
    const [line] = await lineIds(s.saleId);
    await expect(refund(owner, s.saleId, [[line!, 1]], { reason: "other" })).rejects.toThrow(/note/);
    await refund(owner, s.saleId, [[line!, 1]], { reason: "other", note: "Duplicate charge" });
    const log = (await rows("audit_log")).filter((a) => a.action === "sale.refund");
    expect(log).toHaveLength(1);
    expect(log[0]!.after).toMatchObject({
      total_cents: 1390,
      reason: "other",
      note: "Duplicate charge",
      refunded_by: owner.staffId,
      approved_by: null,
    });
  });
});

describe("who can refund", () => {
  it("refuses cashiers", async () => {
    const s = await paidSale([["0003", 1]]);
    const [line] = await lineIds(s.saleId);
    await expect(refund(cashier, s.saleId, [[line!, 1]])).rejects.toThrow(/permission/);
  });

  it("needs the owner's OK when a manager goes over the limit", async () => {
    // $64.99 + $4.55 tax = $69.54, over the $50.00 default.
    const s = await paidSale([["0001", 1]]);
    const [line] = await lineIds(s.saleId);
    const p = await invoke(db, manager, "refundPreview", {
      saleId: s.saleId,
      lines: [{ saleLineId: line!, qty: 1 }],
      restock: true,
    });
    expect(p).toMatchObject({ totalCents: 6954, needsApproval: true, limitCents: 5000 });
    await expect(refund(manager, s.saleId, [[line!, 1]])).rejects.toThrow(/owner's OK/);
    await expect(refund(manager, s.saleId, [[line!, 1]], { approvedBy: manager.staffId })).rejects.toThrow(
      /Only the owner/,
    );
    await refund(manager, s.saleId, [[line!, 1]], { approvedBy: owner.staffId });
    expect((await rows("refunds"))[0]).toMatchObject({
      staff_id: manager.staffId,
      approved_by: owner.staffId,
    });
  });

  it("lets managers refund under the limit, and the owner change it", async () => {
    const s = await paidSale([["0001", 1]]);
    const [line] = await lineIds(s.saleId);
    const set = await invoke(db, owner, "getSettings", undefined);
    await invoke(db, owner, "updateSettings", {
      name: set.name,
      brandColor: set.brandColor,
      logo: set.logo,
      locationName: set.locationName,
      taxPercent: "7",
      astroDiscountsBeforeTax: set.astroDiscountsBeforeTax,
      refundApprovalCents: 10_000,
    });
    expect((await invoke(db, owner, "getSettings", undefined)).refundApprovalCents).toBe(10_000);
    expect((await rows("audit_log")).some((a) => a.action === "settings.refund_limit")).toBe(true);
    await refund(manager, s.saleId, [[line!, 1]]);
  });
});

describe("refunds and Astro", () => {
  it("takes back punches earned on refunded units and queues the refund", async () => {
    // 11 to start, +2.
    const s = await paidSale([["0001", 2]], { customer: true });
    expect(await balance()).toBe(13);
    const [line] = await lineIds(s.saleId);
    const p = await invoke(db, owner, "refundPreview", {
      saleId: s.saleId,
      lines: [{ saleLineId: line!, qty: 1 }],
      restock: true,
    });
    expect(p.astro).toEqual([
      { programId: club, programName: "Sample dry food club (DEMO)", reversed: 1, short: 0, returned: 0 },
    ]);
    await refund(owner, s.saleId, [[line!, 1]]);
    expect(await balance()).toBe(12);
    const q = await invoke(db, cashier, "listAstroQueue", { status: "pending" });
    expect(q.map((r) => [r.kind, r.entries])).toEqual([
      ["sale", ["+2 Sample dry food club (DEMO)"]],
      ["refund", ["Refund: −1 punch Sample dry food club (DEMO)"]],
    ]);
  });

  it("gives the reward back with the free item, and never goes below zero", async () => {
    const fill = await paidSale([["0002", 1]], { customer: true });
    expect(await balance()).toBe(12);
    // Two bags, one free: 12 − 12 redeemed + 1 earned.
    const r = await paidSale([["0002", 2]], { customer: true, rewards: [club] });
    expect(await balance()).toBe(1);

    const [fillLine] = await lineIds(fill.saleId);
    await refund(owner, fill.saleId, [[fillLine!, 1]]);
    expect(await balance()).toBe(0);

    // The paid bag: the punch it earned is already gone.
    const [bags] = await lineIds(r.saleId);
    const paid = await refund(owner, r.saleId, [[bags!, 1]]);
    expect(paid.totalCents).toBe(3899 + 273);
    expect(await balance()).toBe(0);

    // The free bag: $0 back, and the 12 punches come back.
    const free = await refund(owner, r.saleId, [[bags!, 1]]);
    expect(free.totalCents).toBe(0);
    expect(await balance()).toBe(12);

    const q = await invoke(db, cashier, "listAstroQueue", { status: "pending" });
    const refunds = q.filter((x) => x.kind === "refund").map((x) => x.entries);
    expect(refunds).toEqual([
      ["Refund: −1 punch Sample dry food club (DEMO)"],
      ["Refund: 1 punch Sample dry food club (DEMO) already spent, not taken back"],
      ["Reward returned: +12 punches Sample dry food club (DEMO)"],
    ]);
  });

  it("queues nothing for a refund without Astro credit", async () => {
    const s = await paidSale([["0003", 1]], { customer: true });
    const [line] = await lineIds(s.saleId);
    await refund(owner, s.saleId, [[line!, 1]]);
    expect(await rows("astro_queue")).toEqual([]);
  });
});

describe("sales list", () => {
  it("finds sales by receipt number or customer, and nets out refunds", async () => {
    const a = await paidSale([["0003", 1]], { customer: true });
    await paidSale([["0003", 1]]);
    const range = {
      from: new Date(Date.now() - 3600_000).toISOString(),
      to: new Date(Date.now() + 3600_000).toISOString(),
    };
    const [line] = await lineIds(a.saleId);
    await refund(owner, a.saleId, [[line!, 1]]);

    const day = await invoke(db, owner, "listSales", range);
    expect(day).toMatchObject({
      count: 2,
      totalCents: 1390,
      cashCents: 1390,
      refundCount: 1,
      refundCents: 1390,
    });
    expect(day.sales.find((s) => s.id === a.saleId)!.refundedCents).toBe(1390);
    expect((await invoke(db, owner, "listSales", { ...range, q: "#1001" })).sales.map((s) => s.id)).toEqual([
      a.saleId,
    ]);
    expect((await invoke(db, owner, "listSales", { ...range, q: "sample cust" })).sales).toHaveLength(1);
  });
});

describe("sendReceipt", () => {
  it("checks the address and saves a preview", async () => {
    const s = await paidSale([["0003", 1]], { customer: true });
    await expect(
      invoke(db, cashier, "sendReceipt", { saleId: s.saleId, channel: "email", to: "nope" }),
    ).rejects.toThrow(/name@example.com/);
    await expect(
      invoke(db, cashier, "sendReceipt", { saleId: s.saleId, channel: "sms", to: "555-1234" }),
    ).rejects.toThrow(/10-digit/);

    const email = await invoke(db, cashier, "sendReceipt", {
      saleId: s.saleId,
      channel: "email",
      to: " Pat@Example.com ",
    });
    expect(email).toMatchObject({
      to: "pat@example.com",
      status: "preview",
      subject: expect.stringContaining("#1001"),
    });
    expect(email.body).toMatch(/TOTAL\s+\$13\.90/);
    const sms = await invoke(db, cashier, "sendReceipt", {
      saleId: s.saleId,
      channel: "sms",
      to: "(212) 555-0100",
    });
    expect(sms).toMatchObject({ to: "2125550100", subject: null });
    expect(sms.body).toContain("receipt #1001, total $13.90");
    expect((await rows("receipt_outbox")).map((r) => r.status)).toEqual(["preview", "preview"]);
  });
});

describe("Astro queue", () => {
  it("marks entered, and only a manager or owner can undo", async () => {
    await paidSale([["0001", 1]], { customer: true });
    const [row] = await invoke(db, cashier, "listAstroQueue", { status: "pending" });
    await invoke(db, cashier, "markAstroEntered", { id: row!.id, entered: true });
    expect(await invoke(db, cashier, "listAstroQueue", { status: "pending" })).toEqual([]);
    const [done] = await invoke(db, cashier, "listAstroQueue", { status: "entered" });
    expect(done).toMatchObject({ enteredByName: expect.any(String), customerPhone: "2125550100" });
    await expect(invoke(db, cashier, "markAstroEntered", { id: row!.id, entered: true })).rejects.toThrow(
      /already entered/,
    );
    await expect(invoke(db, cashier, "markAstroEntered", { id: row!.id, entered: false })).rejects.toThrow(
      /manager or the owner/,
    );
    await invoke(db, manager, "markAstroEntered", { id: row!.id, entered: false });
    expect(await invoke(db, cashier, "listAstroQueue", { status: "pending" })).toHaveLength(1);
  });

  it("sends through a connected client, and marks a row failed after 5 tries", async () => {
    await paidSale([["0001", 1]], { customer: true });
    const send = (client: AstroClient) =>
      withBusiness(db, businessId, (trx) => processAstroQueue(trx, client));

    // Today's client isn't connected: nothing changes.
    expect(await withBusiness(db, businessId, (trx) => processAstroQueue(trx))).toEqual({
      sent: 0,
      failed: 0,
      waiting: 0,
    });

    const broken: AstroClient = {
      connected: true,
      sendSale: () => Promise.reject(new Error("Astro is down")),
      sendRefund: () => Promise.reject(new Error("Astro is down")),
    };
    for (let i = 0; i < 4; i++) expect(await send(broken)).toMatchObject({ waiting: 1 });
    expect((await rows("astro_queue"))[0]).toMatchObject({
      status: "pending",
      attempts: 4,
      error: "Astro is down",
    });
    expect(await send(broken)).toMatchObject({ failed: 1 });
    expect((await rows("astro_queue"))[0]!.status).toBe("failed");

    await paidSale([["0002", 1]], { customer: true });
    const working: AstroClient = {
      connected: true,
      sendSale: () => Promise.resolve({ sent: true }),
      sendRefund: () => Promise.resolve({ sent: true }),
    };
    expect(await send(working)).toEqual({ sent: 1, failed: 0, waiting: 0 });
    expect((await rows("astro_queue")).map((r) => r.status).sort()).toEqual(["failed", "sent"]);
  });
});

describe("separation between businesses", () => {
  it("can't see or refund another store's sale", async () => {
    const s = await paidSale([["0003", 1]]);
    const other = await insertBusiness(db, "other-store");
    await db.insertInto("locations").values({ business_id: other, name: "Other" }).execute();
    const st = await db
      .insertInto("staff")
      .values({ business_id: other, name: "O", role: "owner" })
      .returning("id")
      .executeTakeFirstOrThrow();
    const otherCtx: Ctx = { businessId: other, staffId: st.id, role: "owner" };
    await expect(
      invoke(db, otherCtx, "refundPreview", { saleId: s.saleId, lines: [], restock: true }),
    ).rejects.toThrow(/doesn't exist/);
    await expect(
      invoke(db, otherCtx, "sendReceipt", { saleId: s.saleId, channel: "email", to: "a@b.co" }),
    ).rejects.toThrow(/doesn't exist/);
    expect(await invoke(db, otherCtx, "listAstroQueue", { status: "pending" })).toEqual([]);
  });
});
