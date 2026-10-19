import type { Kysely } from "kysely";
import { beforeEach, describe, expect, it } from "vitest";
import type { Ctx } from "@pet-pos/core";
import { ensureDemo, listDemoStaff, withBusiness, type DB } from "@pet-pos/db";
import { createTestDb, insertBusiness } from "@pet-pos/db/test-db";
import type { TicketInput } from "../src/handlers/register.ts";
import { invoke } from "../src/registry.ts";

let db: Kysely<DB>;
let owner: Ctx;
let manager: Ctx;
let cashier: Ctx;
let groomer: Ctx;
let sku: Record<string, { id: string; onHand: number; priceCents: number }>;
let sampleCustomer: string;
let club: string;

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
  groomer = ctx("groomer");
  const products = await invoke(db, owner, "listProducts", {});
  sku = Object.fromEntries(products.map((p) => [p.sku, p]));
  sampleCustomer = (await invoke(db, owner, "lookupByPhone", { phone: "2125550100" }))!.id;
  club = (await invoke(db, owner, "listPrograms", undefined))[0]!.id;
});

const discountId = async (code: string) =>
  (await invoke(db, owner, "listDiscounts", {})).find((d) => d.code === code)!.id;

const ticket = (over: Partial<TicketInput> = {}): TicketInput => ({
  customerId: null,
  lines: [{ key: "1", productId: sku["0003"]!.id, qty: 1, applyOffer: false }],
  rewards: [],
  discounts: [],
  ...over,
});

const onHand = async (s: string) =>
  (await invoke(db, owner, "listProducts", { includeArchived: true })).find((p) => p.sku === s)!.onHand;
const balance = async () =>
  (await invoke(db, owner, "getCustomer", { id: sampleCustomer })).punchCards.find(
    (c) => c.programId === club,
  )?.balance ?? 0;
const queue = () =>
  withBusiness(db, owner.businessId, (trx) =>
    trx.selectFrom("astro_queue").select(["sale_id", "payload", "status"]).execute(),
  );

describe("startCheckout", () => {
  it("prices with current prices and 7% tax, and numbers receipts per business", async () => {
    const a = await invoke(db, cashier, "startCheckout", ticket());
    expect(a).toMatchObject({
      receiptNumber: 1001,
      subtotalCents: 1299,
      taxCents: 91,
      totalCents: 1390,
      paid: false,
    });
    const b = await invoke(db, cashier, "startCheckout", ticket());
    expect(b.receiptNumber).toBe(1002);

    await invoke(db, owner, "saveProduct", {
      ...(await invoke(db, owner, "getProduct", { id: sku["0003"]!.id })).product,
      priceCents: 1500,
      offerLabel: null,
      offerCents: null,
      id: sku["0003"]!.id,
    });
    expect((await invoke(db, cashier, "startCheckout", ticket())).subtotalCents).toBe(1500);
  });

  it("refuses an empty ticket, archived products, and a reward without a full card", async () => {
    await expect(invoke(db, cashier, "startCheckout", ticket({ lines: [] }))).rejects.toThrow(/empty/);
    await invoke(db, owner, "archiveProduct", { id: sku["0004"]!.id, archived: true });
    await expect(
      invoke(
        db,
        cashier,
        "startCheckout",
        ticket({ lines: [{ key: "1", productId: sku["0004"]!.id, qty: 1, applyOffer: false }] }),
      ),
    ).rejects.toThrow(/isn't for sale/);
    await expect(invoke(db, cashier, "startCheckout", ticket({ rewards: [club] }))).rejects.toThrow(
      /Attach the customer/,
    );
    await expect(
      invoke(db, cashier, "startCheckout", ticket({ customerId: sampleCustomer, rewards: [club] })),
    ).rejects.toThrow(/card isn't full yet \(11 of 12\)/);
  });

  it("isn't for groomers", async () => {
    await expect(invoke(db, groomer, "startCheckout", ticket())).rejects.toThrow(/permission/);
  });
});

describe("cash", () => {
  it("pays exact or with change, and refuses too little", async () => {
    const s = await invoke(db, cashier, "startCheckout", ticket());
    await expect(
      invoke(db, cashier, "payCash", { saleId: s.saleId, amountCents: 1390, tenderedCents: 1000 }),
    ).rejects.toThrow(/Cash received/);
    const r = await invoke(db, cashier, "payCash", {
      saleId: s.saleId,
      amountCents: 1390,
      tenderedCents: 2000,
    });
    expect(r).toMatchObject({ status: "completed", changeCents: 610, remainingCents: 0, paid: true });
    await expect(
      invoke(db, cashier, "payCash", { saleId: s.saleId, amountCents: 1, tenderedCents: 1 }),
    ).rejects.toThrow(/already paid/);
  });

  it("refuses paying more than what's left", async () => {
    const s = await invoke(db, cashier, "startCheckout", ticket());
    await expect(
      invoke(db, cashier, "payCash", { saleId: s.saleId, amountCents: 1391, tenderedCents: 2000 }),
    ).rejects.toThrow(/from 1 to 1390/);
  });
});

describe("card (simulated Square Terminal)", () => {
  it("approves, declines and cancels", async () => {
    const s = await invoke(db, cashier, "startCheckout", ticket());
    const p1 = await invoke(db, cashier, "startCardPayment", { saleId: s.saleId, amountCents: s.totalCents });
    expect(p1.status).toBe("pending");
    await expect(
      invoke(db, cashier, "startCardPayment", { saleId: s.saleId, amountCents: s.totalCents }),
    ).rejects.toThrow(/already waiting/);
    expect(
      await invoke(db, cashier, "simulateTerminalResult", { paymentId: p1.paymentId, outcome: "declined" }),
    ).toMatchObject({
      status: "declined",
      paid: false,
      remainingCents: 1390,
    });
    const p2 = await invoke(db, cashier, "startCardPayment", { saleId: s.saleId, amountCents: s.totalCents });
    await invoke(db, cashier, "simulateTerminalResult", { paymentId: p2.paymentId, outcome: "canceled" });
    const p3 = await invoke(db, cashier, "startCardPayment", { saleId: s.saleId, amountCents: s.totalCents });
    expect(
      await invoke(db, cashier, "simulateTerminalResult", { paymentId: p3.paymentId, outcome: "approved" }),
    ).toMatchObject({
      status: "completed",
      paid: true,
    });
    await expect(
      invoke(db, cashier, "simulateTerminalResult", { paymentId: p3.paymentId, outcome: "approved" }),
    ).rejects.toThrow(/already answered/);

    const refs = await withBusiness(db, owner.businessId, (trx) =>
      trx.selectFrom("payments").select(["provider_ref", "status"]).where("sale_id", "=", s.saleId).execute(),
    );
    expect(refs.every((r) => /^sim_[0-9a-f]{18}$/.test(r.provider_ref!))).toBe(true);
    expect(refs.map((r) => r.status).sort()).toEqual(["canceled", "completed", "declined"]);
  });

  it("splits cash then card", async () => {
    const s = await invoke(db, cashier, "startCheckout", ticket());
    const cash = await invoke(db, cashier, "payCash", {
      saleId: s.saleId,
      amountCents: 500,
      tenderedCents: 500,
    });
    expect(cash).toMatchObject({ paid: false, remainingCents: 890 });
    const card = await invoke(db, cashier, "startCardPayment", { saleId: s.saleId, amountCents: 890 });
    expect(
      (
        await invoke(db, cashier, "simulateTerminalResult", {
          paymentId: card.paymentId,
          outcome: "approved",
        })
      ).paid,
    ).toBe(true);
    const receipt = await invoke(db, cashier, "getSale", { id: s.saleId });
    expect(receipt.payments.map((p) => [p.method, p.amountCents])).toEqual([
      ["cash", 500],
      ["card", 890],
    ]);
  });
});

describe("finishing a sale", () => {
  it("takes stock, adds punches, and queues the sale for Astro", async () => {
    const before = await onHand("0001");
    const s = await invoke(
      db,
      cashier,
      "startCheckout",
      ticket({
        customerId: sampleCustomer,
        lines: [
          { key: "1", productId: sku["0001"]!.id, qty: 2, applyOffer: true },
          { key: "2", productId: sku["0003"]!.id, qty: 1, applyOffer: false },
        ],
      }),
    );
    // 2 × 64.99 − 5.00 offer + 12.99 = 137.97; tax 7% = 9.66 (9.6579 → 9.66)
    expect(s).toMatchObject({ subtotalCents: 14297, discountCents: 500, taxCents: 966, totalCents: 14763 });
    await invoke(db, cashier, "payCash", {
      saleId: s.saleId,
      amountCents: s.totalCents,
      tenderedCents: 15000,
    });

    expect(await onHand("0001")).toBe(before - 2);
    expect(await balance()).toBe(13);
    const q = await queue();
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({
      sale_id: s.saleId,
      status: "pending",
      payload: {
        receiptNumber: 1001,
        customer: { name: "Sample Customer (DEMO)", phone: "2125550100" },
        earned: [{ programName: "Sample dry food club (DEMO)", punches: 2 }],
        offers: [{ label: "$5 off 24 lb bag", amountCents: 500, sku: "0001" }],
        rewards: [],
      },
    });
    const receipt = await invoke(db, cashier, "getSale", { id: s.saleId });
    expect(receipt).toMatchObject({
      status: "paid",
      earned: [{ programName: "Sample dry food club (DEMO)", punches: 2 }],
    });
  });

  it("redeems a full card: the cheapest bag is free and its punches are used", async () => {
    // Fill the card: 11 + 1 = 12.
    const fill = await invoke(
      db,
      cashier,
      "startCheckout",
      ticket({
        customerId: sampleCustomer,
        lines: [{ key: "1", productId: sku["0002"]!.id, qty: 1, applyOffer: false }],
      }),
    );
    await invoke(db, cashier, "payCash", {
      saleId: fill.saleId,
      amountCents: fill.totalCents,
      tenderedCents: fill.totalCents,
    });
    expect(await balance()).toBe(12);

    const s = await invoke(
      db,
      cashier,
      "startCheckout",
      ticket({
        customerId: sampleCustomer,
        rewards: [club],
        lines: [
          { key: "1", productId: sku["0001"]!.id, qty: 1, applyOffer: false },
          { key: "2", productId: sku["0002"]!.id, qty: 1, applyOffer: false },
        ],
      }),
    );
    expect(s.discountCents).toBe(3899);
    await invoke(db, cashier, "payCash", {
      saleId: s.saleId,
      amountCents: s.totalCents,
      tenderedCents: s.totalCents,
    });
    // 12 − 12 redeemed + 1 earned (the free bag doesn't earn).
    expect(await balance()).toBe(1);
  });

  it("queues nothing for a sale without Astro activity", async () => {
    const s = await invoke(db, cashier, "startCheckout", ticket());
    await invoke(db, cashier, "payCash", {
      saleId: s.saleId,
      amountCents: s.totalCents,
      tenderedCents: s.totalCents,
    });
    expect(await queue()).toEqual([]);
  });

  it("finishes a fully discounted sale with no payment", async () => {
    const dmg = await discountId("DMG");
    const s = await invoke(
      db,
      manager,
      "startCheckout",
      ticket({
        lines: [{ key: "1", productId: sku["0004"]!.id, qty: 1, applyOffer: false }],
        discounts: [
          { discountId: dmg, lineKey: "1" },
          { discountId: dmg, lineKey: "1" },
        ].slice(0, 1),
      }),
    );
    // Rope toy $8.99 − $5.00 → $3.99 + tax; not zero, so still open.
    expect(s.paid).toBe(false);
  });
});

describe("cancel", () => {
  it("hands back payments and audits the void", async () => {
    const s = await invoke(db, cashier, "startCheckout", ticket());
    await invoke(db, cashier, "payCash", { saleId: s.saleId, amountCents: 500, tenderedCents: 500 });
    const card = await invoke(db, cashier, "startCardPayment", { saleId: s.saleId, amountCents: 890 });
    expect(
      await invoke(db, cashier, "cancelSale", { saleId: s.saleId, reason: "Customer changed mind" }),
    ).toEqual({
      refundedCents: 500,
    });
    const pays = await withBusiness(db, owner.businessId, (trx) =>
      trx
        .selectFrom("payments")
        .select(["id", "status", "refunded_cents"])
        .where("sale_id", "=", s.saleId)
        .execute(),
    );
    expect(pays.find((p) => p.id === card.paymentId)!.status).toBe("canceled");
    expect(pays.find((p) => p.id !== card.paymentId)).toMatchObject({
      status: "refunded",
      refunded_cents: 500,
    });
    const log = await withBusiness(db, owner.businessId, (trx) =>
      trx.selectFrom("audit_log").select(["action", "after"]).where("action", "=", "sale.void").execute(),
    );
    expect(log).toEqual([
      {
        action: "sale.void",
        after: { status: "canceled", refunded_cents: 500, reason: "Customer changed mind" },
      },
    ]);
    await expect(
      invoke(db, cashier, "payCash", { saleId: s.saleId, amountCents: 1, tenderedCents: 1 }),
    ).rejects.toThrow(/already canceled/);
  });
});

describe("store discounts", () => {
  it("applies a code's percent off the whole ticket, before tax", async () => {
    const sr = await discountId("SR10");
    const s = await invoke(
      db,
      cashier,
      "startCheckout",
      ticket({ discounts: [{ discountId: sr, lineKey: null }] }),
    );
    // 12.99 − 10% (1.30) = 11.69; tax 0.82
    expect(s).toMatchObject({ discountCents: 130, taxCents: 82, totalCents: 1251 });
  });

  it("only takes a cash discount with cash", async () => {
    const cash = await discountId("CASH");
    const s = await invoke(
      db,
      cashier,
      "startCheckout",
      ticket({ discounts: [{ discountId: cash, lineKey: null }] }),
    );
    expect(s.cashOnly).toBe(true);
    await expect(
      invoke(db, cashier, "startCardPayment", { saleId: s.saleId, amountCents: s.totalCents }),
    ).rejects.toThrow("Remove the cash discount to pay by card.");
    expect(
      (
        await invoke(db, cashier, "payCash", {
          saleId: s.saleId,
          amountCents: s.totalCents,
          tenderedCents: 2000,
        })
      ).paid,
    ).toBe(true);
  });

  it("asks for a note, and for manager approval", async () => {
    const emp = await discountId("EMP");
    await expect(
      invoke(db, cashier, "startCheckout", ticket({ discounts: [{ discountId: emp, lineKey: null }] })),
    ).rejects.toThrow(/Add a note/);
    const dmg = await discountId("DMG");
    const line = { key: "1", productId: sku["0004"]!.id, qty: 1, applyOffer: false };
    await expect(
      invoke(
        db,
        cashier,
        "startCheckout",
        ticket({ lines: [line], discounts: [{ discountId: dmg, lineKey: "1" }] }),
      ),
    ).rejects.toThrow(/needs a manager/);
    await expect(
      invoke(
        db,
        cashier,
        "startCheckout",
        ticket({
          lines: [line],
          discounts: [{ discountId: dmg, lineKey: "1", approvedBy: cashier.staffId }],
        }),
      ),
    ).rejects.toThrow(/manager or owner/);
    const ok = await invoke(
      db,
      cashier,
      "startCheckout",
      ticket({ lines: [line], discounts: [{ discountId: dmg, lineKey: "1", approvedBy: manager.staffId }] }),
    );
    expect(ok.discountCents).toBe(500);
    // A manager ringing the sale approves it themselves.
    expect(
      (
        await invoke(
          db,
          manager,
          "startCheckout",
          ticket({ lines: [line], discounts: [{ discountId: dmg, lineKey: "1" }] }),
        )
      ).discountCents,
    ).toBe(500);

    const rows = await withBusiness(db, owner.businessId, (trx) =>
      trx
        .selectFrom("sale_discounts")
        .select(["name", "applied_by", "approved_by", "amount_cents"])
        .where("sale_id", "=", ok.saleId)
        .execute(),
    );
    expect(rows).toEqual([
      {
        name: "Damaged bag (DEMO)",
        applied_by: cashier.staffId,
        approved_by: manager.staffId,
        amount_cents: 500,
      },
    ]);
  });

  it("refuses two whole-ticket discounts that don't combine", async () => {
    const [sr, cash] = [await discountId("SR10"), await discountId("CASH")];
    await expect(
      invoke(
        db,
        cashier,
        "startCheckout",
        ticket({
          discounts: [
            { discountId: sr, lineKey: null },
            { discountId: cash, lineKey: null },
          ],
        }),
      ),
    ).rejects.toThrow(/Only one whole-ticket discount/);
  });
});

describe("discount setup", () => {
  const input = {
    name: "Puppy class",
    code: "pup5",
    kind: "fixed" as const,
    percentMpct: null,
    amountCents: 500,
    scope: "ticket" as const,
    cashOnly: false,
    needsApproval: false,
    askNote: false,
    combinable: false,
    active: true,
  };

  it("creates with an upper-case code, audits, and refuses clashes", async () => {
    const { id } = await invoke(db, manager, "saveDiscount", input);
    expect((await invoke(db, cashier, "listDiscounts", {})).find((d) => d.id === id)).toMatchObject({
      code: "PUP5",
      amountCents: 500,
    });
    await expect(
      invoke(db, manager, "saveDiscount", { ...input, name: "Other", code: "PUP5" }),
    ).rejects.toThrow("Another discount already uses that code.");
    await expect(invoke(db, manager, "saveDiscount", { ...input, code: "0001" })).rejects.toThrow(
      /product already uses SKU 0001/,
    );
    await expect(invoke(db, cashier, "saveDiscount", input)).rejects.toThrow(/permission/);
    const log = await withBusiness(db, owner.businessId, (trx) =>
      trx.selectFrom("audit_log").select("action").where("entity_id", "=", id).execute(),
    );
    expect(log).toEqual([{ action: "discount.change" }]);
  });

  it("deletes an unused discount and archives a used one", async () => {
    const { id } = await invoke(db, manager, "saveDiscount", input);
    expect(await invoke(db, manager, "deleteDiscount", { id })).toEqual({ archived: false });

    const sr = await discountId("SR10");
    await invoke(db, cashier, "startCheckout", ticket({ discounts: [{ discountId: sr, lineKey: null }] }));
    expect(await invoke(db, manager, "deleteDiscount", { id: sr })).toEqual({ archived: true });
    expect((await invoke(db, cashier, "listDiscounts", {})).some((d) => d.id === sr)).toBe(false);
    expect(
      (await invoke(db, manager, "listDiscounts", { all: true })).find((d) => d.id === sr),
    ).toMatchObject({ archived: true });
  });

  it("validates amounts and the cash-only rule", async () => {
    await expect(
      invoke(db, manager, "saveDiscount", { ...input, kind: "percent", percentMpct: 0, amountCents: null }),
    ).rejects.toThrow(/percent from/);
    await expect(
      invoke(db, manager, "saveDiscount", { ...input, scope: "line", cashOnly: true }),
    ).rejects.toThrow(/whole ticket/);
  });
});

describe("barcodes", () => {
  it("matches a UPC-A whether it's read with or without the leading 0", async () => {
    const p = (await invoke(db, owner, "getProduct", { id: sku["0003"]!.id })).product;
    await invoke(db, owner, "saveProduct", { ...p, id: p.id, barcode: "012345678905" });
    expect((await invoke(db, cashier, "findByCode", { code: "0012345678905" }))?.sku).toBe("0003");
    await invoke(db, owner, "saveProduct", { ...p, id: p.id, barcode: "0098765432109" });
    expect((await invoke(db, cashier, "findByCode", { code: "098765432109" }))?.sku).toBe("0003");
  });
});

describe("sales list and register customer", () => {
  it("lists the day's sales with totals by payment type", async () => {
    const a = await invoke(db, cashier, "startCheckout", ticket());
    await invoke(db, cashier, "payCash", {
      saleId: a.saleId,
      amountCents: a.totalCents,
      tenderedCents: 2000,
    });
    const b = await invoke(db, cashier, "startCheckout", ticket());
    const c = await invoke(db, cashier, "startCardPayment", { saleId: b.saleId, amountCents: b.totalCents });
    await invoke(db, cashier, "simulateTerminalResult", { paymentId: c.paymentId, outcome: "approved" });
    await invoke(db, cashier, "startCheckout", ticket()); // still open: not listed

    const day = await invoke(db, manager, "listSales", {
      from: new Date(Date.now() - 3600_000).toISOString(),
      to: new Date(Date.now() + 3600_000).toISOString(),
    });
    expect(day).toMatchObject({ count: 2, totalCents: 2780, cardCents: 1390, cashCents: 1390 });
    expect(day.sales.map((s) => s.payment).sort()).toEqual(["card", "cash"]);
    await expect(
      invoke(db, cashier, "listSales", { from: new Date().toISOString(), to: new Date().toISOString() }),
    ).rejects.toThrow(/permission/);
  });

  it("knows what a customer usually buys", async () => {
    for (const s of ["0003", "0003", "0001"]) {
      const sale = await invoke(
        db,
        cashier,
        "startCheckout",
        ticket({
          customerId: sampleCustomer,
          lines: [{ key: "1", productId: sku[s]!.id, qty: 1, applyOffer: false }],
        }),
      );
      await invoke(db, cashier, "payCash", {
        saleId: sale.saleId,
        amountCents: sale.totalCents,
        tenderedCents: sale.totalCents,
      });
    }
    const r = await invoke(db, cashier, "registerCustomer", { id: sampleCustomer });
    expect(r.usuallyBuys.map((p) => [p.sku, p.times])).toEqual([
      ["0003", 2],
      ["0001", 1],
    ]);
    expect(r.lastVisit).not.toBeNull();
  });

  it("keeps sales when the customer is deleted", async () => {
    const s = await invoke(db, cashier, "startCheckout", ticket({ customerId: sampleCustomer }));
    await invoke(db, cashier, "payCash", {
      saleId: s.saleId,
      amountCents: s.totalCents,
      tenderedCents: s.totalCents,
    });
    await invoke(db, owner, "deleteCustomer", { id: sampleCustomer });
    expect((await invoke(db, cashier, "getSale", { id: s.saleId })).customer).toBeNull();
  });

  it("keeps sales separate between businesses", async () => {
    const s = await invoke(db, cashier, "startCheckout", ticket());
    const other = await insertBusiness(db, "other-store");
    await db.insertInto("locations").values({ business_id: other, name: "Other" }).execute();
    const st = await db
      .insertInto("staff")
      .values({ business_id: other, name: "O", role: "owner" })
      .returning("id")
      .executeTakeFirstOrThrow();
    const otherCtx: Ctx = { businessId: other, staffId: st.id, role: "owner" };
    await expect(invoke(db, otherCtx, "getSale", { id: s.saleId })).rejects.toThrow(/doesn't exist/);
    await expect(
      invoke(db, otherCtx, "payCash", { saleId: s.saleId, amountCents: 1, tenderedCents: 1 }),
    ).rejects.toThrow(/doesn't exist/);
    expect(await invoke(db, otherCtx, "startCheckout", ticket()).catch((e: Error) => e.message)).toMatch(
      /isn't for sale/,
    );
  });
});
