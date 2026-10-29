// A paid website order takes its items off the register's shelf, when the register shares this
// database (hosted). Items match the register's products by name: the register's shelf was copied
// from the store's listing. An item with no match is skipped and logged, never blocking the order.
// Every way out is logged, so CloudWatch says why an order did or didn't change stock.
import type { OrderLine } from "@bearded/store-core";
import type { Sql } from "./db.ts";

/** "Website order #1A2B3C": the first characters of the order id, as staff see it in stock history. */
export const websiteOrderNote = (orderId: string) => `Website order #${orderId.slice(0, 8).toUpperCase()}`;

async function registerHere(sql: Sql): Promise<boolean> {
  const { rows } = await sql.query<{ ok: boolean }>(
    "SELECT to_regclass('public.inventory_moves') IS NOT NULL AS ok",
  );
  return rows[0]?.ok === true;
}

/**
 * Takes a paid order's items off the register's shelf. Safe to run again: an order whose items
 * already came off is left alone. Returns how many items came off.
 */
export async function takeRegisterStock(sql: Sql, orderId: string): Promise<number> {
  const tag = `website order ${orderId}`;
  if (!(await registerHere(sql))) {
    console.log(`${tag}: no register tables in this database; stock not changed`);
    return 0;
  }
  const order = (
    await sql.query<{ business_id: string; lines: OrderLine[] }>(
      "SELECT business_id, lines FROM store_orders WHERE id = $1 AND status = 'paid'",
      [orderId],
    )
  ).rows[0];
  if (!order) {
    console.warn(`${tag}: not found as paid; stock not changed`);
    return 0;
  }
  const taken = await sql.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM inventory_moves WHERE business_id = $1 AND ref_id = $2",
    [order.business_id, orderId],
  );
  if ((taken.rows[0]?.n ?? 0) > 0) return 0;
  const location = (
    await sql.query<{ id: string }>(
      "SELECT id FROM locations WHERE business_id = $1 ORDER BY created_at LIMIT 1",
      [order.business_id],
    )
  ).rows[0];
  if (!location) {
    console.warn(`${tag}: the register has no location yet; stock not changed`);
    return 0;
  }
  let count = 0;
  for (const line of order.lines) {
    const product = (
      await sql.query<{ id: string }>(
        `SELECT id FROM products WHERE business_id = $1 AND lower(name) = lower($2)
         ORDER BY active DESC, created_at LIMIT 1`,
        [order.business_id, line.name],
      )
    ).rows[0];
    if (!product) {
      console.warn(`${tag}: no register product named "${line.name}"; stock not changed`);
      continue;
    }
    await sql.query(
      `INSERT INTO inventory_moves (business_id, product_id, location_id, qty_change, reason, ref_id, note)
       VALUES ($1, $2, $3, $4, 'sale', $5, $6)`,
      [order.business_id, product.id, location.id, -line.qty, orderId, websiteOrderNote(orderId)],
    );
    count += line.qty;
  }
  console.log(`${tag}: took ${count} item(s) off the register's shelf`);
  return count;
}

/**
 * Takes stock for paid orders that never came off the shelf (paid before the register shared this
 * database, or while it was off). Runs when the server starts. Returns how many orders it caught up.
 */
export async function catchUpRegisterStock(sql: Sql): Promise<number> {
  if (!(await registerHere(sql))) return 0;
  const { rows } = await sql.query<{ id: string }>(
    `SELECT o.id FROM store_orders o
     WHERE o.status = 'paid'
       AND NOT EXISTS (SELECT 1 FROM inventory_moves m WHERE m.business_id = o.business_id AND m.ref_id = o.id)
     ORDER BY o.paid_at`,
  );
  let caught = 0;
  for (const r of rows) if ((await takeRegisterStock(sql, r.id)) > 0) caught++;
  if (rows.length) console.log(`register stock catch-up: ${caught} of ${rows.length} paid website order(s)`);
  return caught;
}
