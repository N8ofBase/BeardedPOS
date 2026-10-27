// A paid website order takes its items off the register's shelf, when the register shares this
// database (hosted). Items match the register's products by name: the register's shelf was copied
// from the store's listing. An item with no match is skipped and logged, never blocking the order.
import type { OrderLine } from "@bearded/store-core";
import type { Sql } from "./db.ts";

/** "Website order #1A2B3C": the first characters of the order id, as staff see it in stock history. */
export const websiteOrderNote = (orderId: string) => `Website order #${orderId.slice(0, 8).toUpperCase()}`;

/** Call only from the transaction that flipped the order to paid, so it runs once per order. */
export async function takeRegisterStock(sql: Sql, orderId: string): Promise<void> {
  const { rows: tables } = await sql.query<{ ok: boolean }>(
    "SELECT to_regclass('public.inventory_moves') IS NOT NULL AS ok",
  );
  if (!tables[0]?.ok) return; // the store on its own (local development): no register here
  const order = (
    await sql.query<{ business_id: string; lines: OrderLine[] }>(
      "SELECT business_id, lines FROM store_orders WHERE id = $1 AND status = 'paid'",
      [orderId],
    )
  ).rows[0];
  if (!order) return;
  const location = (
    await sql.query<{ id: string }>(
      "SELECT id FROM locations WHERE business_id = $1 ORDER BY created_at LIMIT 1",
      [order.business_id],
    )
  ).rows[0];
  if (!location) return;
  for (const line of order.lines) {
    const product = (
      await sql.query<{ id: string }>(
        `SELECT id FROM products WHERE business_id = $1 AND lower(name) = lower($2)
         ORDER BY active DESC, created_at LIMIT 1`,
        [order.business_id, line.name],
      )
    ).rows[0];
    if (!product) {
      console.warn(`website order ${orderId}: no register product named "${line.name}"; stock not changed`);
      continue;
    }
    await sql.query(
      `INSERT INTO inventory_moves (business_id, product_id, location_id, qty_change, reason, ref_id, note)
       VALUES ($1, $2, $3, $4, 'sale', $5, $6)`,
      [order.business_id, product.id, location.id, -line.qty, orderId, websiteOrderNote(orderId)],
    );
  }
}
