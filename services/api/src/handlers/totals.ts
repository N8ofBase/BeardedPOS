// The day's money, used by both the Sales page KPIs and end of day, so they can't disagree.
// Imported orders (source import) are never counted: that money was taken in the old system.
import { sql, type Transaction } from "kysely";
import type { DB } from "@bearded/db";

export interface MoneyTotals {
  /** Paid register sales rung in the range. */
  count: number;
  grossCents: number;
  discountCents: number;
  taxCents: number;
  /** Completed payments taken in the range (cash is what stayed in the drawer, change excluded). */
  cardInCents: number;
  cashInCents: number;
  /** Refunds made in the range, on any sale, by where the money went. */
  cardBackCents: number;
  cashBackCents: number;
  refundCount: number;
  refundCents: number;
  /** gross − refunds. */
  netCents: number;
}

export async function moneyTotals(trx: Transaction<DB>, from: Date, to: Date): Promise<MoneyTotals> {
  const sales = await trx
    .selectFrom("sales")
    .select([
      sql<number>`count(*)::int`.as("count"),
      sql<number>`coalesce(sum(total_cents), 0)::int`.as("gross"),
      sql<number>`coalesce(sum(discount_cents), 0)::int`.as("discount"),
      sql<number>`coalesce(sum(tax_cents), 0)::int`.as("tax"),
    ])
    .where("source", "=", "register")
    .where("status", "=", "paid")
    .where("created_at", ">=", from)
    .where("created_at", "<", to)
    .executeTakeFirstOrThrow();
  // Voided sales' payments are marked refunded, so only money still held counts.
  const taken = await trx
    .selectFrom("payments")
    .select(["method", sql<number>`coalesce(sum(amount_cents), 0)::int`.as("n")])
    .where("status", "=", "completed")
    .where("completed_at", ">=", from)
    .where("completed_at", "<", to)
    .groupBy("method")
    .execute();
  const back = await trx
    .selectFrom("refund_payments as rp")
    .innerJoin("refunds as r", "r.id", "rp.refund_id")
    .select(["rp.method", sql<number>`sum(rp.amount_cents)::int`.as("n")])
    .where("r.created_at", ">=", from)
    .where("r.created_at", "<", to)
    .groupBy("rp.method")
    .execute();
  const refunds = await trx
    .selectFrom("refunds")
    .select([
      sql<number>`count(*)::int`.as("n"),
      sql<number>`coalesce(sum(amount_cents + tax_cents), 0)::int`.as("cents"),
    ])
    .where("created_at", ">=", from)
    .where("created_at", "<", to)
    .executeTakeFirstOrThrow();
  const by = (rows: { method: string; n: number }[], m: "card" | "cash") =>
    rows.find((r) => r.method === m)?.n ?? 0;
  return {
    count: sales.count,
    grossCents: sales.gross,
    discountCents: sales.discount,
    taxCents: sales.tax,
    cardInCents: by(taken, "card"),
    cashInCents: by(taken, "cash"),
    cardBackCents: by(back, "card"),
    cashBackCents: by(back, "cash"),
    refundCount: refunds.n,
    refundCents: refunds.cents,
    netCents: sales.gross - refunds.cents,
  };
}
