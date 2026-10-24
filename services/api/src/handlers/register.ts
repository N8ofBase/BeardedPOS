// Register checkout. The browser shows totals with priceSale() as the ticket
// changes; startCheckout reruns it here with current prices and saved discounts,
// never trusting the browser's numbers. A sale finishes (stock moves, status paid)
// exactly once, in the transaction of the payment that completes it.
import { sql, type Transaction } from "kysely";
import {
  allocate,
  AppError,
  can,
  priceSale,
  type AppliedStoreDiscount,
  type Ctx,
  type DiscountRule,
  type PricedSale,
  type ReceiptData,
  type TicketLine,
} from "@pet-pos/core";
import type { DB } from "@pet-pos/db";
import { defineHandler } from "../handler.ts";
import { terminal } from "../payments/terminal.ts";
import { audit, currentLocationId, likePattern, requireInt } from "../shared.ts";
import { CUSTOMER_COLUMNS, type CustomerCard } from "./customers.ts";
import { productQuery, type ProductRow } from "./inventory.ts";
import { moneyTotals } from "./totals.ts";

type Trx = Transaction<DB>;

export interface TicketInput {
  customerId: string | null;
  lines: {
    key: string;
    productId: string;
    qty: number;
  }[];
  discounts: { discountId: string; lineKey: string | null; note?: string; approvedBy?: string | null }[];
}

interface Loaded {
  priced: PricedSale;
  lines: TicketLine[];
  products: Map<string, ProductRow>;
  applied: (AppliedStoreDiscount & { note: string | null; approvedBy: string | null })[];
  rules: Map<string, { cashOnly: boolean }>;
  taxRateMpct: number;
  locationId: string;
}

/** Turns a ticket into priced lines, checking every product and discount. */
async function loadTicket(trx: Trx, ctx: Ctx, t: TicketInput): Promise<Loaded> {
  if (!t.lines.length) throw new AppError("invalid", "The ticket is empty.");
  if (t.lines.length > 200) throw new AppError("invalid", "A ticket can have up to 200 lines.");

  const ids = [...new Set(t.lines.map((l) => l.productId))];
  const rows = ids.length
    ? await productQuery(trx).where("p.id", "in", ids).where("p.active", "=", true).execute()
    : [];
  const products = new Map(rows.map((p) => [p.id, p]));
  const lines: TicketLine[] = t.lines.map((l) => {
    const p = products.get(l.productId);
    if (!p)
      throw new AppError(
        "invalid",
        "An item on the ticket isn't for sale anymore. Remove it and scan again.",
      );
    requireInt(l.qty, `Quantity for ${p.name}`, { min: 1, max: 9999 });
    return {
      key: l.key,
      productId: p.id,
      name: p.name,
      unitPriceCents: p.priceCents,
      qty: l.qty,
      taxClass: p.taxClass,
    };
  });

  // Store discounts: active, approved when they need it, with a note when they ask for one.
  const applied: Loaded["applied"] = [];
  const rules = new Map<string, { cashOnly: boolean }>();
  for (const d of t.discounts) {
    const r = await trx
      .selectFrom("discounts")
      .selectAll()
      .where("id", "=", d.discountId)
      .where("active", "=", true)
      .where("archived_at", "is", null)
      .executeTakeFirst();
    if (!r) throw new AppError("invalid", "A discount on the ticket isn't available anymore. Remove it.");
    let approvedBy: string | null = null;
    if (r.needs_approval) {
      approvedBy = d.approvedBy ?? (can(ctx.role, "discounts.approve") ? ctx.staffId : null);
      if (!approvedBy) throw new AppError("forbidden", `${r.name} needs a manager to approve it.`);
      const approver = await trx
        .selectFrom("staff")
        .select(["role", "active"])
        .where("id", "=", approvedBy)
        .executeTakeFirst();
      if (!approver?.active || (approver.role !== "owner" && approver.role !== "manager"))
        throw new AppError("forbidden", `${r.name} needs a manager or owner to approve it.`);
    }
    const note = d.note?.trim() || null;
    if (r.ask_note && !note) throw new AppError("invalid", `Add a note for ${r.name}.`);
    const rule: DiscountRule = {
      id: r.id,
      name: r.name,
      kind: r.kind,
      percentMpct: r.percent_mpct,
      amountCents: r.amount_cents,
      scope: r.scope,
      combinable: r.combinable,
    };
    applied.push({ rule, lineKey: r.scope === "line" ? d.lineKey : null, note, approvedBy });
    rules.set(r.id, { cashOnly: r.cash_only });
  }

  const loc = await trx
    .selectFrom("locations")
    .select(["id", "tax_rate_mpct"])
    .orderBy("created_at")
    .executeTakeFirstOrThrow();
  const priced = priceSale({
    lines,
    storeDiscounts: applied,
    taxRateMpct: loc.tax_rate_mpct,
  });
  return {
    priced,
    lines,
    products,
    applied,
    rules,
    taxRateMpct: loc.tax_rate_mpct,
    locationId: loc.id,
  };
}

async function nextReceiptNumber(trx: Trx, businessId: string): Promise<number> {
  const row = await trx
    .insertInto("business_counters")
    .values({ business_id: businessId, name: "receipt", value: 1001 })
    .onConflict((oc) =>
      oc.columns(["business_id", "name"]).doUpdateSet({ value: sql`business_counters.value + 1` }),
    )
    .returning("value")
    .executeTakeFirstOrThrow();
  return row.value;
}

export interface CheckoutResult {
  saleId: string;
  receiptNumber: number;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  /** A cash-only discount is on the sale: card payments are refused. */
  cashOnly: boolean;
  paid: boolean;
}

/** Prices the ticket with current prices and opens a sale, ready for payment. */
export const startCheckout = defineHandler<TicketInput, CheckoutResult>({
  action: "register.use",
  async run(trx, ctx, t) {
    if (t.customerId) {
      const c = await trx
        .selectFrom("customers")
        .select("id")
        .where("id", "=", t.customerId)
        .executeTakeFirst();
      if (!c) throw new AppError("invalid", "That customer doesn't exist anymore. Change the customer.");
    }
    const L = await loadTicket(trx, ctx, t);
    const p = L.priced;
    const receiptNumber = await nextReceiptNumber(trx, ctx.businessId);
    const sale = await trx
      .insertInto("sales")
      .values({
        business_id: ctx.businessId,
        location_id: L.locationId,
        customer_id: t.customerId,
        staff_id: ctx.staffId,
        receipt_number: receiptNumber,
        subtotal_cents: p.subtotalCents,
        discount_cents: p.discountCents,
        tax_cents: p.taxCents,
        total_cents: p.totalCents,
        tax_rate_mpct: L.taxRateMpct,
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    // Each line's share of the tax, so a refund gives back exactly what was paid.
    const taxShares = allocate(
      p.taxCents,
      p.lines.map((l) => l.taxBaseCents),
    );
    const lineIds = new Map<string, string>();
    for (const [i, line] of L.lines.entries()) {
      const pl = p.lines[i]!;
      const prod = line.productId ? L.products.get(line.productId) : undefined;
      const row = await trx
        .insertInto("sale_lines")
        .values({
          business_id: ctx.businessId,
          sale_id: sale.id,
          position: i + 1,
          product_id: prod?.id ?? null,
          name: prod?.name ?? line.name,
          sku: prod?.sku ?? null,
          barcode: prod?.barcode ?? null,
          tax_class: line.taxClass,
          qty: line.qty,
          unit_price_cents: line.unitPriceCents,
          discount_cents: pl.discountCents,
          line_total_cents: pl.netCents,
          tax_cents: taxShares[i]!,
          unit_cost_cents: prod?.costCents ?? null,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      lineIds.set(line.key, row.id);
    }

    for (const d of p.discounts) {
      const a = L.applied.find((x) => x.rule.id === d.discountId && x.lineKey === d.lineKey);
      await trx
        .insertInto("sale_discounts")
        .values({
          business_id: ctx.businessId,
          sale_id: sale.id,
          sale_line_id: d.lineKey ? (lineIds.get(d.lineKey) ?? null) : null,
          discount_id: d.discountId,
          name: d.name,
          kind: a?.rule.kind ?? null,
          percent_mpct: a?.rule.percentMpct ?? null,
          amount_cents: d.amountCents,
          note: a?.note ?? null,
          applied_by: ctx.staffId,
          approved_by: a?.approvedBy ?? null,
        })
        .execute();
    }

    const cashOnly = L.applied.some((a) => L.rules.get(a.rule.id)?.cashOnly);
    let paid = false;
    if (p.totalCents === 0) paid = await finishSale(trx, ctx, sale.id);
    return {
      saleId: sale.id,
      receiptNumber,
      subtotalCents: p.subtotalCents,
      discountCents: p.discountCents,
      taxCents: p.taxCents,
      totalCents: p.totalCents,
      cashOnly,
      paid,
    };
  },
});

async function openSale(trx: Trx, saleId: string) {
  const sale = await trx
    .selectFrom("sales")
    .select(["id", "status", "total_cents", "customer_id", "receipt_number"])
    .where("id", "=", saleId)
    .forUpdate()
    .executeTakeFirst();
  if (!sale) throw new AppError("not_found", "That sale doesn't exist.");
  if (sale.status !== "open") throw new AppError("conflict", `This sale is already ${sale.status}.`);
  return sale;
}

async function paidSoFar(trx: Trx, saleId: string): Promise<number> {
  const r = await trx
    .selectFrom("payments")
    .select(sql<number>`coalesce(sum(amount_cents), 0)::int`.as("n"))
    .where("sale_id", "=", saleId)
    .where("status", "=", "completed")
    .executeTakeFirstOrThrow();
  return r.n;
}

async function hasCashOnlyDiscount(trx: Trx, saleId: string): Promise<boolean> {
  const r = await trx
    .selectFrom("sale_discounts as s")
    .innerJoin("discounts as d", "d.id", "s.discount_id")
    .select("s.id")
    .where("s.sale_id", "=", saleId)
    .where("d.cash_only", "=", true)
    .executeTakeFirst();
  return !!r;
}

/**
 * Finishes a fully paid sale: stock moves and status paid. Guarded by the open status (row-locked), so it runs once.
 */
async function finishSale(trx: Trx, ctx: Ctx, saleId: string): Promise<boolean> {
  const sale = await trx
    .selectFrom("sales")
    .selectAll()
    .where("id", "=", saleId)
    .forUpdate()
    .executeTakeFirstOrThrow();
  if (sale.status !== "open") return sale.status === "paid";
  if ((await paidSoFar(trx, saleId)) < sale.total_cents) return false;

  const lines = await trx
    .selectFrom("sale_lines")
    .selectAll()
    .where("sale_id", "=", saleId)
    .orderBy("position")
    .execute();
  const locationId = await currentLocationId(trx);
  for (const l of lines) {
    if (!l.product_id) continue;
    await trx
      .insertInto("inventory_moves")
      .values({
        business_id: ctx.businessId,
        product_id: l.product_id,
        location_id: locationId,
        qty_change: -l.qty,
        reason: "sale",
        ref_id: saleId,
        staff_id: ctx.staffId,
      })
      .execute();
  }

  await trx
    .updateTable("sales")
    .set({ status: "paid", paid_at: new Date() })
    .where("id", "=", saleId)
    .execute();
  return true;
}

export interface PaymentResult {
  paymentId: string;
  status: "pending" | "completed" | "declined" | "canceled";
  changeCents: number;
  paidCents: number;
  remainingCents: number;
  /** The sale is fully paid and finished. */
  paid: boolean;
}

async function result(
  trx: Trx,
  saleId: string,
  paymentId: string,
  status: PaymentResult["status"],
  changeCents = 0,
): Promise<PaymentResult> {
  const sale = await trx
    .selectFrom("sales")
    .select(["total_cents", "status"])
    .where("id", "=", saleId)
    .executeTakeFirstOrThrow();
  const paidCents = await paidSoFar(trx, saleId);
  return {
    paymentId,
    status,
    changeCents,
    paidCents,
    remainingCents: Math.max(0, sale.total_cents - paidCents),
    paid: sale.status === "paid",
  };
}

export const payCash = defineHandler<
  { saleId: string; amountCents: number; tenderedCents: number },
  PaymentResult
>({
  action: "register.use",
  async run(trx, ctx, { saleId, amountCents, tenderedCents }) {
    const sale = await openSale(trx, saleId);
    const remaining = sale.total_cents - (await paidSoFar(trx, saleId));
    requireInt(amountCents, "Cash amount", { min: 1, max: remaining });
    requireInt(tenderedCents, "Cash received", { min: amountCents, max: 100_000_000 });
    const row = await trx
      .insertInto("payments")
      .values({
        business_id: ctx.businessId,
        sale_id: saleId,
        method: "cash",
        provider: "cash",
        status: "completed",
        amount_cents: amountCents,
        tendered_cents: tenderedCents,
        change_cents: tenderedCents - amountCents,
        staff_id: ctx.staffId,
        completed_at: new Date(),
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await finishSale(trx, ctx, saleId);
    return result(trx, saleId, row.id, "completed", tenderedCents - amountCents);
  },
});

export const startCardPayment = defineHandler<{ saleId: string; amountCents: number }, PaymentResult>({
  action: "register.use",
  async run(trx, ctx, { saleId, amountCents }) {
    const sale = await openSale(trx, saleId);
    if (await hasCashOnlyDiscount(trx, saleId))
      throw new AppError("invalid", "Remove the cash discount to pay by card.");
    const pending = await trx
      .selectFrom("payments")
      .select("id")
      .where("sale_id", "=", saleId)
      .where("status", "=", "pending")
      .executeTakeFirst();
    if (pending) throw new AppError("conflict", "The card reader is already waiting for this sale.");
    const remaining = sale.total_cents - (await paidSoFar(trx, saleId));
    requireInt(amountCents, "Card amount", { min: 1, max: remaining });
    const charge = await terminal.charge(amountCents, saleId);
    const row = await trx
      .insertInto("payments")
      .values({
        business_id: ctx.businessId,
        sale_id: saleId,
        method: "card",
        provider: "square",
        provider_ref: charge.providerRef,
        status: "pending",
        amount_cents: amountCents,
        staff_id: ctx.staffId,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    return result(trx, saleId, row.id, "pending");
  },
});

/**
 * Demo only: stands in for Square's webhook with the reader's answer. Hosted mode
 * replaces this with the webhook handler, which runs the same finishing step.
 */
export const simulateTerminalResult = defineHandler<
  { paymentId: string; outcome: "approved" | "declined" | "canceled" },
  PaymentResult
>({
  action: "register.use",
  async run(trx, ctx, { paymentId, outcome }) {
    const p = await trx
      .selectFrom("payments")
      .select(["id", "sale_id", "status", "method"])
      .where("id", "=", paymentId)
      .forUpdate()
      .executeTakeFirst();
    if (!p || p.method !== "card") throw new AppError("not_found", "That card payment doesn't exist.");
    if (p.status !== "pending")
      throw new AppError("conflict", "The card reader already answered for this payment.");
    await openSale(trx, p.sale_id);
    const status = outcome === "approved" ? "completed" : outcome === "declined" ? "declined" : "canceled";
    await trx
      .updateTable("payments")
      .set({ status, completed_at: status === "completed" ? new Date() : null })
      .where("id", "=", paymentId)
      .execute();
    if (status === "completed") await finishSale(trx, ctx, p.sale_id);
    return result(trx, p.sale_id, paymentId, status);
  },
});

/**
 * Cancels an open sale. Completed payments are handed back (cash returned to the
 * customer, card refunded through the reader) and the void is audited.
 */
export const cancelSale = defineHandler<{ saleId: string; reason?: string }, { refundedCents: number }>({
  action: "register.use",
  async run(trx, ctx, { saleId, reason }) {
    const sale = await openSale(trx, saleId);
    const payments = await trx.selectFrom("payments").selectAll().where("sale_id", "=", saleId).execute();
    let refunded = 0;
    for (const p of payments) {
      if (p.status === "pending") {
        await trx.updateTable("payments").set({ status: "canceled" }).where("id", "=", p.id).execute();
      } else if (p.status === "completed") {
        if (p.method === "card" && p.provider_ref) await terminal.refund(p.provider_ref, p.amount_cents);
        await trx
          .updateTable("payments")
          .set({ status: "refunded", refunded_cents: p.amount_cents })
          .where("id", "=", p.id)
          .execute();
        refunded += p.amount_cents;
      }
    }
    await trx
      .updateTable("sales")
      .set({ status: "canceled", canceled_at: new Date() })
      .where("id", "=", saleId)
      .execute();
    await audit(trx, ctx, {
      action: "sale.void",
      entity: "sale",
      entityId: saleId,
      before: { status: "open", receipt_number: sale.receipt_number, total_cents: sale.total_cents },
      after: { status: "canceled", refunded_cents: refunded, reason: reason?.trim() || null },
    });
    return { refundedCents: refunded };
  },
});

export type Receipt = ReceiptData;

export const getSale = defineHandler<{ id: string }, Receipt>({
  action: "register.use",
  async run(trx, ctx, { id }) {
    const s = await trx
      .selectFrom("sales as s")
      .leftJoin("staff as st", "st.id", "s.staff_id")
      .leftJoin("customers as c", "c.id", "s.customer_id")
      .select([
        "s.id",
        "s.receipt_number",
        "s.status",
        "s.created_at",
        "s.paid_at",
        "s.subtotal_cents",
        "s.discount_cents",
        "s.tax_cents",
        "s.tax_rate_mpct",
        "s.total_cents",
        "s.refunded_cents",
        "st.name as staff_name",
        "c.id as customer_id",
        "c.name as customer_name",
        "c.email as customer_email",
        "c.phone as customer_phone",
      ])
      .where("s.id", "=", id)
      .where("s.source", "=", "register")
      .executeTakeFirst();
    if (!s) throw new AppError("not_found", "That sale doesn't exist.");
    const biz = await trx
      .selectFrom("businesses")
      .select("name")
      .where("id", "=", ctx.businessId)
      .executeTakeFirstOrThrow();
    const loc = await trx
      .selectFrom("locations")
      .select("name")
      .orderBy("created_at")
      .executeTakeFirstOrThrow();
    const lines = await trx
      .selectFrom("sale_lines")
      .selectAll()
      .where("sale_id", "=", id)
      .orderBy("position")
      .execute();
    const discounts = await trx
      .selectFrom("sale_discounts")
      .select(["name", "amount_cents", "note"])
      .where("sale_id", "=", id)
      .orderBy("created_at")
      .execute();
    const payments = await trx
      .selectFrom("payments")
      .select(["method", "status", "amount_cents", "tendered_cents", "change_cents"])
      .where("sale_id", "=", id)
      .where("status", "in", ["completed", "refunded"])
      .orderBy("created_at")
      .execute();
    const refunds = await saleRefunds(trx, id);
    return {
      id: s.id,
      receiptNumber: s.receipt_number!,
      status: s.status,
      createdAt: s.created_at,
      paidAt: s.paid_at,
      storeName: biz.name,
      locationName: loc.name,
      staffName: s.staff_name,
      customer: s.customer_id
        ? {
            id: s.customer_id,
            name: s.customer_name!,
            email: s.customer_email,
            phone: s.customer_phone,
          }
        : null,
      lines: lines.map((l) => ({
        id: l.id,
        name: l.name,
        sku: l.sku,
        qty: l.qty,
        unitPriceCents: l.unit_price_cents,
        discountCents: l.discount_cents,
        lineTotalCents: l.line_total_cents,
      })),
      discounts: discounts.map((d) => ({
        name: d.name,
        amountCents: d.amount_cents,
        note: d.note,
      })),
      payments: payments.map((p) => ({
        method: p.method,
        status: p.status,
        amountCents: p.amount_cents,
        tenderedCents: p.tendered_cents,
        changeCents: p.change_cents,
      })),
      subtotalCents: s.subtotal_cents,
      discountCents: s.discount_cents,
      taxCents: s.tax_cents,
      taxRateMpct: s.tax_rate_mpct,
      totalCents: s.total_cents,
      refundedCents: s.refunded_cents,
      refunds,
    };
  },
});

/** A sale's refunds, oldest first, for the receipt and the slide-over. */
async function saleRefunds(trx: Trx, saleId: string): Promise<ReceiptData["refunds"]> {
  const rows = await trx
    .selectFrom("refunds as r")
    .leftJoin("staff as st", "st.id", "r.staff_id")
    .leftJoin("staff as ap", "ap.id", "r.approved_by")
    .select([
      "r.id",
      "r.created_at",
      "r.reason",
      "r.note",
      "r.restock",
      "r.amount_cents",
      "r.tax_cents",
      "st.name as staff_name",
      "ap.name as approved_by_name",
    ])
    .where("r.sale_id", "=", saleId)
    .orderBy("r.created_at")
    .execute();
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const lines = await trx
    .selectFrom("refund_lines as rl")
    .innerJoin("sale_lines as l", "l.id", "rl.sale_line_id")
    .select(["rl.refund_id", "l.name", "rl.qty", "rl.amount_cents", "l.position"])
    .where("rl.refund_id", "in", ids)
    .orderBy("l.position")
    .execute();
  const pays = await trx
    .selectFrom("refund_payments")
    .select(["refund_id", "method", "amount_cents"])
    .where("refund_id", "in", ids)
    .execute();
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    reason: r.reason,
    note: r.note,
    restock: r.restock,
    staffName: r.staff_name,
    approvedByName: r.approved_by_name,
    amountCents: r.amount_cents,
    taxCents: r.tax_cents,
    lines: lines
      .filter((l) => l.refund_id === r.id)
      .map((l) => ({ name: l.name, qty: l.qty, amountCents: l.amount_cents })),
    payments: pays
      .filter((p) => p.refund_id === r.id)
      .map((p) => ({ method: p.method, amountCents: p.amount_cents })),
  }));
}

export interface SaleListRow {
  id: string;
  receiptNumber: number;
  createdAt: Date;
  status: "open" | "paid" | "canceled";
  customerName: string | null;
  items: string;
  payment: string;
  discountCents: number;
  totalCents: number;
  refundedCents: number;
}

export interface SalesDay {
  sales: SaleListRow[];
  count: number;
  totalCents: number;
  cardCents: number;
  cashCents: number;
  discountCents: number;
  /** Refunds made in the range, on any sale. */
  refundCount: number;
  refundCents: number;
}

/**
 * Sales and totals for a range, as on the prototype's Sales tab. from/to are ISO
 * times. q finds a receipt number or customer name; the totals are for the whole range
 * (moneyTotals, shared with end of day), net of refunds made in it.
 */
export const listSales = defineHandler<{ from: string; to: string; q?: string }, SalesDay>({
  action: "sales.view",
  async run(trx, _ctx, { from, to, q }) {
    const term = q?.trim().replace(/^#/, "") ?? "";
    let query = trx
      .selectFrom("sales as s")
      .leftJoin("customers as c", "c.id", "s.customer_id")
      .select([
        "s.id",
        "s.receipt_number as receiptNumber",
        "s.created_at as createdAt",
        "s.status",
        "c.name as customerName",
        "s.discount_cents as discountCents",
        "s.total_cents as totalCents",
        "s.refunded_cents as refundedCents",
        sql<string>`(SELECT string_agg(l.qty || '× ' || l.name, ', ' ORDER BY l.position) FROM sale_lines l WHERE l.sale_id = s.id)`.as(
          "items",
        ),
        sql<string>`coalesce((SELECT string_agg(DISTINCT p.method, ' + ') FROM payments p WHERE p.sale_id = s.id AND p.status IN ('completed', 'refunded')), '')`.as(
          "payment",
        ),
      ])
      .where("s.created_at", ">=", new Date(from))
      .where("s.created_at", "<", new Date(to))
      .where("s.status", "in", ["paid", "canceled"])
      .where("s.source", "=", "register");
    if (/^\d{1,9}$/.test(term))
      query = query.where((eb) =>
        eb.or([eb("s.receipt_number", "=", Number(term)), eb("c.name", "ilike", likePattern(term))]),
      );
    else if (term) query = query.where("c.name", "ilike", likePattern(term));
    const rows = await query.orderBy("s.created_at", "desc").limit(500).execute();
    const t = await moneyTotals(trx, new Date(from), new Date(to));
    return {
      sales: rows.map((r) => ({ ...r, receiptNumber: r.receiptNumber!, items: r.items ?? "" })),
      count: t.count,
      totalCents: t.netCents,
      cardCents: t.cardInCents - t.cardBackCents,
      cashCents: t.cashInCents - t.cashBackCents,
      discountCents: t.discountCents,
      refundCount: t.refundCount,
      refundCents: t.refundCents,
    };
  },
});

export interface RegisterCustomer {
  card: CustomerCard;
  /** Top products from this customer's past sales, for one-tap adding. */
  usuallyBuys: (ProductRow & { times: number })[];
  lastVisit: Date | null;
}

export const registerCustomer = defineHandler<{ id: string }, RegisterCustomer>({
  action: "register.use",
  async run(trx, _ctx, { id }) {
    const row = await trx
      .selectFrom("customers")
      .select(CUSTOMER_COLUMNS)
      .where("id", "=", id)
      .executeTakeFirst();
    if (!row) throw new AppError("not_found", "That customer doesn't exist anymore.");
    const top = await trx
      .selectFrom("sale_lines as l")
      .innerJoin("sales as s", "s.id", "l.sale_id")
      .select(["l.product_id", sql<number>`count(DISTINCT l.sale_id)::int`.as("times")])
      .where("s.customer_id", "=", id)
      .where("s.status", "=", "paid")
      .where("l.product_id", "is not", null)
      .groupBy("l.product_id")
      .orderBy("times", "desc")
      .limit(3)
      .execute();
    const ids = top.map((t) => t.product_id!);
    const products = ids.length
      ? await productQuery(trx).where("p.id", "in", ids).where("p.active", "=", true).execute()
      : [];
    const last = await trx
      .selectFrom("sales")
      .select("paid_at")
      .where("customer_id", "=", id)
      .where("status", "=", "paid")
      .orderBy("paid_at", "desc")
      .executeTakeFirst();
    return {
      card: row,
      usuallyBuys: top
        .map((t) => {
          const p = products.find((x) => x.id === t.product_id);
          return p ? { ...p, times: t.times } : null;
        })
        .filter((x): x is ProductRow & { times: number } => !!x),
      lastVisit: last?.paid_at ?? null,
    };
  },
});
