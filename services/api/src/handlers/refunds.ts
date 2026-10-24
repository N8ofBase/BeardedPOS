// Refunds. The preview and the refund run the same planRefund(), so what the
// screen shows is exactly what happens. Money back is worked out from what was
// paid per line (packages/core/src/refund.ts), never from today's prices.
import { sql, type Transaction } from "kysely";
import {
  AppError,
  REFUND_REASONS,
  refundLine,
  refundSplitLabel,
  splitRefund,
  taxShares,
  type Ctx,
  type LineRefund,
  type PaymentRefund,
  type RefundReasonCode,
} from "@bearded/core";
import type { DB } from "@bearded/db";
import { defineHandler } from "../handler.ts";
import { terminal } from "../payments/terminal.ts";
import { audit, currentLocationId } from "../shared.ts";

type Trx = Transaction<DB>;

export interface RefundInput {
  saleId: string;
  lines: { saleLineId: string; qty: number }[];
  restock: boolean;
}

export interface RefundSaleInput extends RefundInput {
  reason: RefundReasonCode;
  note?: string;
  /** An owner's staff id, when a manager refunds more than the store's limit. */
  approvedBy?: string | null;
}

export interface RefundableLineView {
  saleLineId: string;
  name: string;
  qty: number;
  refundedQty: number;
  lineTotalCents: number;
}

export interface RefundPlan {
  saleId: string;
  receiptNumber: number;
  /** Every line on the sale with what's left to refund, for the steppers. */
  refundable: RefundableLineView[];
  lines: LineRefund[];
  amountCents: number;
  taxCents: number;
  totalCents: number;
  payments: PaymentRefund[];
  /** "Refund $43.21 to the card · Hand back $10.00 cash" */
  label: string;
  restock: boolean;
  /** A manager is over the store's refund limit: an owner must approve. */
  needsApproval: boolean;
  limitCents: number;
}

/** Works out a refund without saving anything. */
async function planRefund(trx: Trx, ctx: Ctx, input: RefundInput, lock: boolean): Promise<RefundPlan> {
  let saleQuery = trx
    .selectFrom("sales")
    .select(["id", "status", "source", "receipt_number", "tax_cents", "total_cents", "refunded_cents"])
    .where("id", "=", input.saleId);
  if (lock) saleQuery = saleQuery.forUpdate();
  const sale = await saleQuery.executeTakeFirst();
  if (!sale) throw new AppError("not_found", "That sale doesn't exist.");
  if (sale.source === "import")
    throw new AppError("invalid", "Orders imported from the old system can't be refunded here.");
  if (sale.status !== "paid")
    throw new AppError(
      "invalid",
      sale.status === "open" ? "This sale isn't paid yet. Cancel it instead." : "This sale was canceled.",
    );

  const rows = await trx
    .selectFrom("sale_lines as l")
    .select([
      "l.id",
      "l.name",
      "l.qty",
      "l.product_id",
      "l.line_total_cents",
      "l.tax_cents",
      "l.tax_class",
      sql<number>`coalesce((SELECT sum(rl.qty) FROM refund_lines rl WHERE rl.sale_line_id = l.id), 0)::int`.as(
        "refunded_qty",
      ),
      sql<number>`coalesce((SELECT sum(rl.amount_cents) FROM refund_lines rl WHERE rl.sale_line_id = l.id), 0)::int`.as(
        "refunded_cents",
      ),
      sql<number>`coalesce((SELECT sum(rl.tax_cents) FROM refund_lines rl WHERE rl.sale_line_id = l.id), 0)::int`.as(
        "refunded_tax_cents",
      ),
    ])
    .where("l.sale_id", "=", sale.id)
    .orderBy("l.position")
    .execute();
  // Sales rung before tax shares were stored: spread the sale's tax the same way now.
  const fallback = taxShares(
    sale.tax_cents,
    rows.map((r) => ({ lineTotalCents: r.line_total_cents, taxClass: r.tax_class })),
  );
  const byId = new Map(rows.map((r, i) => [r.id, { row: r, tax: r.tax_cents ?? fallback[i]! }]));

  const wanted = new Map<string, number>();
  for (const l of input.lines) {
    if (!byId.has(l.saleLineId)) throw new AppError("invalid", "That item isn't on this sale.");
    wanted.set(l.saleLineId, (wanted.get(l.saleLineId) ?? 0) + l.qty);
  }
  const lines: LineRefund[] = [];
  for (const [id, qty] of wanted) {
    const { row, tax } = byId.get(id)!;
    lines.push(
      refundLine(
        {
          id,
          name: row.name,
          qty: row.qty,
          lineTotalCents: row.line_total_cents,
          taxCents: tax,
          refundedQty: row.refunded_qty,
          refundedCents: row.refunded_cents,
          refundedTaxCents: row.refunded_tax_cents,
        },
        qty,
      ),
    );
  }
  const amountCents = lines.reduce((s, l) => s + l.amountCents, 0);
  const taxCents = lines.reduce((s, l) => s + l.taxCents, 0);
  const totalCents = amountCents + taxCents;

  const pays = await trx
    .selectFrom("payments")
    .select(["id", "method", "amount_cents", "refunded_cents"])
    .where("sale_id", "=", sale.id)
    .where("status", "=", "completed")
    .orderBy("created_at")
    .execute();
  const payments = splitRefund(
    totalCents,
    pays.map((p) => ({ id: p.id, method: p.method, availableCents: p.amount_cents - p.refunded_cents })),
  );

  const biz = await trx
    .selectFrom("businesses")
    .select("refund_approval_cents")
    .where("id", "=", ctx.businessId)
    .executeTakeFirstOrThrow();

  return {
    saleId: sale.id,
    receiptNumber: sale.receipt_number!,
    refundable: rows.map((r) => ({
      saleLineId: r.id,
      name: r.name,
      qty: r.qty,
      refundedQty: r.refunded_qty,
      lineTotalCents: r.line_total_cents,
    })),
    lines,
    amountCents,
    taxCents,
    totalCents,
    payments,
    label: refundSplitLabel(payments),
    restock: input.restock,
    needsApproval: ctx.role !== "owner" && totalCents > biz.refund_approval_cents,
    limitCents: biz.refund_approval_cents,
  };
}

/** What a refund would give back. Nothing is saved. An empty `lines` lists what can be refunded. */
export const refundPreview = defineHandler<RefundInput, RefundPlan>({
  action: "sales.refund",
  run: (trx, ctx, input) => planRefund(trx, ctx, input, false),
});

export interface RefundResult {
  refundId: string;
  totalCents: number;
  payments: PaymentRefund[];
  label: string;
}

/** Refunds chosen lines in one transaction: money back, stock and the audit log. */
export const refundSale = defineHandler<RefundSaleInput, RefundResult>({
  action: "sales.refund",
  async run(trx, ctx, input) {
    if (!(REFUND_REASONS as readonly string[]).includes(input.reason))
      throw new AppError("invalid", "Pick a reason for the refund.");
    const note = input.note?.trim() || null;
    if (input.reason === "other" && !note) throw new AppError("invalid", "Add a note saying why.");
    if (!input.lines.length) throw new AppError("invalid", "Pick the items to refund.");

    const plan = await planRefund(trx, ctx, input, true);

    let approvedBy: string | null = null;
    if (plan.needsApproval) {
      if (!input.approvedBy)
        throw new AppError("forbidden", "Refunds over the store's limit need the owner's OK.");
      const approver = await trx
        .selectFrom("staff")
        .select(["role", "active"])
        .where("id", "=", input.approvedBy)
        .executeTakeFirst();
      if (!approver?.active || approver.role !== "owner")
        throw new AppError("forbidden", "Only the owner can approve a refund over the limit.");
      approvedBy = input.approvedBy;
    }

    const refund = await trx
      .insertInto("refunds")
      .values({
        business_id: ctx.businessId,
        sale_id: plan.saleId,
        staff_id: ctx.staffId,
        approved_by: approvedBy,
        reason: input.reason,
        note,
        restock: input.restock,
        amount_cents: plan.amountCents,
        tax_cents: plan.taxCents,
      })
      .returning(["id", "created_at"])
      .executeTakeFirstOrThrow();

    const saleLines = await trx
      .selectFrom("sale_lines")
      .select(["id", "product_id"])
      .where("sale_id", "=", plan.saleId)
      .execute();
    const lineInfo = new Map(saleLines.map((l) => [l.id, l]));
    for (const l of plan.lines)
      await trx
        .insertInto("refund_lines")
        .values({
          business_id: ctx.businessId,
          refund_id: refund.id,
          sale_line_id: l.lineId,
          qty: l.qty,
          amount_cents: l.amountCents,
          tax_cents: l.taxCents,
        })
        .execute();

    // Money back: card through the reader (simulated in the demo), then cash from the drawer.
    for (const p of plan.payments) {
      const pay = await trx
        .selectFrom("payments")
        .select(["provider_ref"])
        .where("id", "=", p.paymentId)
        .executeTakeFirstOrThrow();
      const ref =
        p.method === "card" && pay.provider_ref
          ? (await terminal.refund(pay.provider_ref, p.amountCents)).refundRef
          : null;
      await trx
        .insertInto("refund_payments")
        .values({
          business_id: ctx.businessId,
          refund_id: refund.id,
          payment_id: p.paymentId,
          method: p.method,
          amount_cents: p.amountCents,
          provider_ref: ref,
        })
        .execute();
      await trx
        .updateTable("payments")
        .set({ refunded_cents: sql`refunded_cents + ${p.amountCents}` })
        .where("id", "=", p.paymentId)
        .execute();
    }
    await trx
      .updateTable("sales")
      .set({ refunded_cents: sql`refunded_cents + ${plan.totalCents}` })
      .where("id", "=", plan.saleId)
      .execute();

    if (input.restock) {
      const locationId = await currentLocationId(trx);
      for (const l of plan.lines) {
        const productId = lineInfo.get(l.lineId)?.product_id;
        if (!productId) continue;
        await trx
          .insertInto("inventory_moves")
          .values({
            business_id: ctx.businessId,
            product_id: productId,
            location_id: locationId,
            qty_change: l.qty,
            reason: "return",
            ref_id: refund.id,
            staff_id: ctx.staffId,
          })
          .execute();
      }
    }

    await audit(trx, ctx, {
      action: "sale.refund",
      entity: "sale",
      entityId: plan.saleId,
      before: { receipt_number: plan.receiptNumber },
      after: {
        refund_id: refund.id,
        amount_cents: plan.amountCents,
        tax_cents: plan.taxCents,
        total_cents: plan.totalCents,
        lines: plan.lines.map((l) => ({
          sale_line_id: l.lineId,
          name: l.name,
          qty: l.qty,
          cents: l.amountCents,
        })),
        payments: plan.payments.map((p) => ({ method: p.method, cents: p.amountCents })),
        reason: input.reason,
        note,
        restock: input.restock,
        refunded_by: ctx.staffId,
        approved_by: approvedBy,
      },
    });

    return { refundId: refund.id, totalCents: plan.totalCents, payments: plan.payments, label: plan.label };
  },
});
