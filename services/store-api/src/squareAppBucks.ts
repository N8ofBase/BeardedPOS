// Beard Bucks for sales rung only in the Square app (not in our register). Square's webhook tells us
// about every order; one that isn't a website order, isn't a register sale, and has a customer on it
// earns that customer's Bucks when they match a register customer by phone, then email (the shop's
// matching rule). The earning goes in the register's loyalty_ledger, once per Square order.
// Refunds made in the Square app don't take these Bucks back; staff adjust by hand if needed.
import { BIRTHDAY_BUCKS, birthdayGiftDue, bucksEarned, normalizePhone } from "@bearded/core";
import type { Sql } from "./db.ts";
import { registerBucksHere } from "./loyalty.ts";
import type { SquareAppSale } from "./square/types.ts";

export const SQUARE_APP_NOTE = "Square app sale";

/** The register's card hand-off notes its Square payment "Receipt #12": that sale earns in the register. */
const HANDOFF_NOTE = /^Receipt #\d+/;

export type SquareAppResult =
  "credited" | "already" | "not_here" | "register_sale" | "no_customer" | "no_match" | "loyalty_off";

/** Credits a Square app sale to its customer. Safe to run again: a sale earns once. */
export async function creditSquareAppSale(
  sql: Sql,
  businessId: string,
  sale: SquareAppSale,
  today: string,
): Promise<SquareAppResult> {
  if (!(await registerBucksHere(sql))) return "not_here";
  if (sale.notes.some((n) => HANDOFF_NOTE.test(n))) return "register_sale";
  if (sale.paymentIds.length) {
    const ours = await sql.query("SELECT 1 FROM payments WHERE provider_ref = ANY($1::text[]) LIMIT 1", [
      sale.paymentIds,
    ]);
    if (ours.rows.length) return "register_sale";
  }
  if (!sale.customer) return "no_customer";
  const on = await sql.query<{ on: boolean }>("SELECT loyalty_enabled AS on FROM businesses WHERE id = $1", [
    businessId,
  ]);
  if (!on.rows[0]?.on) return "loyalty_off";

  const phone = normalizePhone(sale.customer.phone);
  const email = sale.customer.email?.trim().toLowerCase() || null;
  const match = async (where: string, value: string) =>
    (
      await sql.query<{ id: string; birthday: string | null; kind: string }>(
        `SELECT id, to_char(birthday, 'YYYY-MM-DD') AS birthday, kind FROM customers WHERE ${where}
         ORDER BY created_at LIMIT 1 FOR UPDATE`,
        [value],
      )
    ).rows[0];
  const customer =
    (phone ? await match("phone = $1", phone) : undefined) ??
    (email ? await match("lower(email) = $1", email) : undefined);
  // A store buying at wholesale isn't a Beard Buddy shopper.
  if (!customer || customer.kind === "retailer") return "no_match";

  const add = async (kind: "earn" | "birthday", bucks: number) =>
    bucks === 0
      ? false
      : (
          await sql.query(
            `INSERT INTO loyalty_ledger (business_id, customer_id, kind, bucks, square_order_id, note)
             VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING RETURNING id`,
            [businessId, customer.id, kind, bucks, sale.orderId, SQUARE_APP_NOTE],
          )
        ).rows.length === 1;
  // The earning and the birthday gift are written together, so a sale that earned already is done.
  if (!(await add("earn", bucksEarned(sale.netCents)))) return "already";
  const last = (
    await sql.query<{ last: string | null }>(
      `SELECT to_char(max((created_at AT TIME ZONE 'America/Chicago')::date), 'YYYY-MM-DD') AS last
       FROM loyalty_ledger WHERE customer_id = $1 AND kind = 'birthday'`,
      [customer.id],
    )
  ).rows[0]?.last;
  if (birthdayGiftDue(customer.birthday, last ?? null, today)) await add("birthday", BIRTHDAY_BUCKS);
  return "credited";
}
