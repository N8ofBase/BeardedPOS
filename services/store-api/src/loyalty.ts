// Beard Bucks on web orders. The rules are the register's (@bearded/core/loyalty, via store-core);
// this file is the only place that writes store_loyalty_ledger, always in the transaction that marks
// an order paid. A balance is the sum of the ledger, less Bucks held by open checkouts.
import {
  BIRTHDAY_BUCKS,
  birthdayGiftDue,
  bucksEarned,
  HOLD_HOURS,
  type LedgerEntry,
  type LedgerKind,
  type OrderBucks,
} from "@bearded/store-core";
import type { Sql } from "./db.ts";

/** The store's calendar day (St. Louis), for birthdays. */
export function storeToday(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(now);
}

export interface Balance {
  /** What can be spent now. */
  balance: number;
  /** Held by checkouts opened in the last HOLD_HOURS that aren't paid yet. */
  held: number;
}

export async function bucksBalance(sql: Sql, customerId: string): Promise<Balance> {
  const { rows } = await sql.query<{ total: number; held: number }>(
    `SELECT
       (SELECT coalesce(sum(bucks), 0)::int FROM store_loyalty_ledger WHERE customer_id = $1) AS total,
       (SELECT coalesce(sum(reward_bucks), 0)::int FROM store_orders
         WHERE customer_id = $1 AND status = 'open' AND reward_bucks > 0
           AND created_at > now() - make_interval(hours => $2)) AS held`,
    [customerId, HOLD_HOURS],
  );
  const { total, held } = rows[0]!;
  return { balance: total - held, held };
}

export async function ledgerHistory(sql: Sql, customerId: string, limit = 20): Promise<LedgerEntry[]> {
  const { rows } = await sql.query<{
    kind: LedgerKind;
    bucks: number;
    created_at: Date;
    order_id: string | null;
  }>(
    `SELECT kind, bucks, created_at, order_id FROM store_loyalty_ledger
     WHERE customer_id = $1 ORDER BY created_at DESC, id LIMIT $2`,
    [customerId, limit],
  );
  return rows.map((r) => ({
    kind: r.kind,
    bucks: r.bucks,
    at: r.created_at.toISOString(),
    orderId: r.order_id,
  }));
}

/**
 * Writes what a newly paid order does to the shopper's Bucks: the reward it used, what it earns
 * (1 per whole dollar after the reward, before tax) and the birthday gift when due. Call it only
 * from the transaction that flipped the order to paid; the ledger's unique index stops a second run.
 */
export async function settlePaidOrder(sql: Sql, orderId: string, today: string): Promise<void> {
  const { rows } = await sql.query<{
    business_id: string;
    customer_id: string | null;
    subtotal_cents: number;
    discount_cents: number;
    reward_bucks: number;
  }>(
    `SELECT business_id, customer_id, subtotal_cents, discount_cents, reward_bucks
     FROM store_orders WHERE id = $1 AND status = 'paid'`,
    [orderId],
  );
  const order = rows[0];
  if (!order?.customer_id) return;
  const add = (kind: LedgerKind, bucks: number) =>
    bucks === 0
      ? Promise.resolve()
      : sql.query(
          `INSERT INTO store_loyalty_ledger (business_id, customer_id, kind, bucks, order_id)
           VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
          [order.business_id, order.customer_id, kind, bucks, orderId],
        );
  await add("redeem", -order.reward_bucks);
  await add("earn", bucksEarned(order.subtotal_cents - order.discount_cents));

  const customer = (
    await sql.query<{ birthday: string | null; last_gift_on: string | null }>(
      `SELECT to_char(birthday, 'YYYY-MM-DD') AS birthday, to_char(last_gift_on, 'YYYY-MM-DD') AS last_gift_on
       FROM store_customers WHERE id = $1 FOR UPDATE`,
      [order.customer_id],
    )
  ).rows[0];
  if (customer && birthdayGiftDue(customer.birthday, customer.last_gift_on, today)) {
    await add("birthday", BIRTHDAY_BUCKS);
    await sql.query("UPDATE store_customers SET last_gift_on = $2 WHERE id = $1", [order.customer_id, today]);
  }
}

/** What one order did to the shopper's Bucks, or undefined for a guest order. */
export async function orderBucks(sql: Sql, orderId: string): Promise<OrderBucks | undefined> {
  const { rows } = await sql.query<{ kind: LedgerKind; bucks: number }>(
    "SELECT kind, bucks FROM store_loyalty_ledger WHERE order_id = $1",
    [orderId],
  );
  if (rows.length === 0) return undefined;
  const sum = (kind: LedgerKind) => rows.filter((r) => r.kind === kind).reduce((n, r) => n + r.bucks, 0);
  return { earned: sum("earn"), used: Math.abs(sum("redeem")), birthday: sum("birthday") };
}
