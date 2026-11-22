// Beard Bucks on web orders. The rules are the register's (@bearded/core/loyalty, via store-core);
// this file is the only place the store writes Bucks: the welcome gift when a shopper first signs in,
// and everything else in the transaction that marks an order paid. A balance is the sum of the
// ledger, less Bucks held by open checkouts.
//
// One balance everywhere: when the register shares this database (hosted), each shopper is joined to
// the register customer with the same email (joinBuddy), and their Bucks live in the register's
// loyalty_ledger beside what they earn and spend at the counter. On its own database (store dev and
// tests) a shopper's Bucks stay in store_loyalty_ledger.
import {
  BIRTHDAY_BUCKS,
  birthdayGiftDue,
  bucksEarned,
  HOLD_HOURS,
  type LedgerEntry,
  type LedgerKind,
  type OrderBucks,
  WELCOME_BUCKS,
} from "@bearded/store-core";
import type { Sql } from "./db.ts";
import { websiteOrderNote } from "./registerStock.ts";

/** The store's calendar day (St. Louis), for birthdays. */
export function storeToday(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(now);
}

/** The note on website Bucks that aren't from an order (the welcome gift). */
export const WEBSITE_NOTE = "On the website";

/** The register's ledger is in this database and can hold website Bucks (its migration 043 has run). */
export async function registerBucksHere(sql: Sql): Promise<boolean> {
  const { rows } = await sql.query<{ ok: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM pg_attribute
       WHERE attrelid = to_regclass('public.loyalty_ledger') AND attname = 'web_order_id' AND NOT attisdropped) AS ok`,
  );
  return rows[0]?.ok === true;
}

/**
 * The register customer whose ledger holds this shopper's Bucks, joining them first if they aren't
 * yet: the register customer with the same email, or a new one. The first join copies the shopper's
 * website Bucks into the register's ledger, once. Null when the register isn't in this database (or
 * the register refused the new customer, which is logged): the shopper's Bucks stay on the website.
 * Runs inside the caller's transaction and locks the shopper's row.
 */
export async function joinBuddy(sql: Sql, storeCustomerId: string): Promise<string | null> {
  if (!(await registerBucksHere(sql))) return null;
  const c = (
    await sql.query<{
      business_id: string;
      email: string;
      name: string | null;
      birthday: string | null;
      register_customer_id: string | null;
      bucks_joined_at: Date | null;
      is_demo: boolean;
    }>(
      `SELECT business_id, email, name, to_char(birthday, 'YYYY-MM-DD') AS birthday, register_customer_id,
              bucks_joined_at, is_demo
       FROM store_customers WHERE id = $1 FOR UPDATE`,
      [storeCustomerId],
    )
  ).rows[0];
  if (!c) return null;
  if (c.register_customer_id && c.bucks_joined_at) {
    const still = await sql.query("SELECT 1 FROM customers WHERE id = $1", [c.register_customer_id]);
    if (still.rows.length) return c.register_customer_id;
  }
  let registerId = (
    await sql.query<{ id: string }>(
      "SELECT id FROM customers WHERE lower(email) = lower($1) ORDER BY created_at LIMIT 1",
      [c.email],
    )
  ).rows[0]?.id;
  if (!registerId) {
    // A savepoint, so a customer the register won't take leaves the shopper's own call working.
    await sql.query("SAVEPOINT join_buddy");
    try {
      registerId = (
        await sql.query<{ id: string }>(
          `INSERT INTO customers (business_id, name, email, birthday, is_demo)
           VALUES ($1, coalesce(nullif(trim($2), ''), $3), $3, $4, $5) RETURNING id`,
          [c.business_id, c.name ?? "", c.email, c.birthday, c.is_demo],
        )
      ).rows[0]!.id;
      await sql.query("RELEASE SAVEPOINT join_buddy");
    } catch (e) {
      await sql.query("ROLLBACK TO SAVEPOINT join_buddy");
      console.error(`beard buddy ${storeCustomerId}: the register refused a customer for them`, e);
      return null;
    }
  } else if (c.birthday) {
    await sql.query("UPDATE customers SET birthday = $2 WHERE id = $1 AND birthday IS NULL", [
      registerId,
      c.birthday,
    ]);
  }
  if (!c.bucks_joined_at) {
    // Their website Bucks move to the register's ledger as they were, dated when they happened.
    // A kind the register's ledger can't hold that way comes over as an adjustment.
    await sql.query(
      `INSERT INTO loyalty_ledger (business_id, customer_id, kind, bucks, note, web_order_id, is_demo, created_at)
       SELECT business_id, $2,
              CASE WHEN (kind IN ('earn', 'birthday', 'give_back', 'welcome') AND bucks > 0)
                     OR (kind IN ('redeem', 'take_back') AND bucks < 0) OR kind = 'adjust'
                   THEN kind ELSE 'adjust' END,
              bucks,
              left(coalesce(nullif(trim(note), ''),
                CASE WHEN order_id IS NULL THEN $3
                     ELSE 'Website order #' || upper(left(order_id::text, 8)) END), 200),
              order_id, is_demo, created_at
       FROM store_loyalty_ledger WHERE customer_id = $1
       ORDER BY created_at
       ON CONFLICT DO NOTHING`,
      [storeCustomerId, registerId, WEBSITE_NOTE],
    );
  }
  await sql.query(
    `UPDATE store_customers SET register_customer_id = $2, bucks_joined_at = coalesce(bucks_joined_at, now())
     WHERE id = $1`,
    [storeCustomerId, registerId],
  );
  return registerId;
}

/**
 * Joins every shopper who isn't joined yet (they signed up before the register shared this database,
 * or while it was off). Runs when the server starts. Returns how many it joined.
 */
export async function joinAllBuddies(sql: Sql): Promise<number> {
  if (!(await registerBucksHere(sql))) return 0;
  const { rows } = await sql.query<{ id: string }>(
    "SELECT id FROM store_customers WHERE bucks_joined_at IS NULL ORDER BY created_at",
  );
  let joined = 0;
  for (const r of rows) if (await joinBuddy(sql, r.id)) joined++;
  if (rows.length)
    console.log(`beard buddy join: ${joined} of ${rows.length} shopper(s) joined to the register`);
  return joined;
}

/**
 * Locks the shopper's Bucks for a checkout: their own row, and the register customer the counter
 * locks, so the website and the counter can't spend the same Bucks at once.
 */
export async function lockBucks(sql: Sql, storeCustomerId: string): Promise<void> {
  const registerId = await joinBuddy(sql, storeCustomerId);
  if (registerId) await sql.query("SELECT id FROM customers WHERE id = $1 FOR UPDATE", [registerId]);
}

/** A name or birthday the shopper gave on the website fills in what the register doesn't have yet. */
export async function shareDetails(sql: Sql, storeCustomerId: string): Promise<void> {
  const registerId = await joinBuddy(sql, storeCustomerId);
  if (!registerId) return;
  await sql.query(
    `UPDATE customers r SET
       birthday = coalesce(r.birthday, s.birthday),
       name = CASE WHEN lower(r.name) = lower(s.email) AND nullif(trim(s.name), '') IS NOT NULL
                   THEN trim(s.name) ELSE r.name END
     FROM store_customers s
     WHERE s.id = $1 AND r.id = $2
       AND ((r.birthday IS NULL AND s.birthday IS NOT NULL)
            OR (lower(r.name) = lower(s.email) AND nullif(trim(s.name), '') IS NOT NULL))`,
    [storeCustomerId, registerId],
  );
}

export interface Balance {
  /** What can be spent now. */
  balance: number;
  /** Held by checkouts opened in the last HOLD_HOURS that aren't paid yet. */
  held: number;
}

export async function bucksBalance(sql: Sql, customerId: string): Promise<Balance> {
  const registerId = await joinBuddy(sql, customerId);
  const { rows } = await sql.query<{ total: number; held: number }>(
    `SELECT
       (${
         registerId
           ? "SELECT coalesce(sum(bucks), 0)::int FROM loyalty_ledger WHERE customer_id = $3"
           : "SELECT coalesce(sum(bucks), 0)::int FROM store_loyalty_ledger WHERE customer_id = $1"
       }) AS total,
       (SELECT coalesce(sum(reward_bucks), 0)::int FROM store_orders
         WHERE customer_id = $1 AND status = 'open' AND reward_bucks > 0
           AND created_at > now() - make_interval(hours => $2)) AS held`,
    registerId ? [customerId, HOLD_HOURS, registerId] : [customerId, HOLD_HOURS],
  );
  const { total, held } = rows[0]!;
  return { balance: total - held, held };
}

/** Gives the welcome gift if this shopper hasn't had it. True when it was given now. */
export async function giveWelcome(sql: Sql, businessId: string, customerId: string): Promise<boolean> {
  const registerId = await joinBuddy(sql, customerId);
  const { rows } = registerId
    ? await sql.query(
        `INSERT INTO loyalty_ledger (business_id, customer_id, kind, bucks, note) VALUES ($1, $2, 'welcome', $3, $4)
         ON CONFLICT (business_id, customer_id) WHERE kind = 'welcome' DO NOTHING RETURNING id`,
        [businessId, registerId, WELCOME_BUCKS, WEBSITE_NOTE],
      )
    : await sql.query(
        `INSERT INTO store_loyalty_ledger (business_id, customer_id, kind, bucks) VALUES ($1, $2, 'welcome', $3)
         ON CONFLICT (business_id, customer_id) WHERE kind = 'welcome' DO NOTHING RETURNING id`,
        [businessId, customerId, WELCOME_BUCKS],
      );
  return rows.length === 1;
}

export async function ledgerHistory(sql: Sql, customerId: string, limit = 20): Promise<LedgerEntry[]> {
  const registerId = await joinBuddy(sql, customerId);
  const { rows } = await sql.query<{
    kind: LedgerKind;
    bucks: number;
    created_at: Date;
    order_id: string | null;
    at_shop: boolean;
  }>(
    registerId
      ? `SELECT kind, bucks, created_at, web_order_id AS order_id,
                (sale_id IS NOT NULL OR square_order_id IS NOT NULL) AS at_shop
         FROM loyalty_ledger WHERE customer_id = $1 ORDER BY created_at DESC, id LIMIT $2`
      : `SELECT kind, bucks, created_at, order_id, false AS at_shop FROM store_loyalty_ledger
         WHERE customer_id = $1 ORDER BY created_at DESC, id LIMIT $2`,
    [registerId ?? customerId, limit],
  );
  return rows.map((r) => ({
    kind: r.kind,
    bucks: r.bucks,
    at: r.created_at.toISOString(),
    orderId: r.order_id,
    ...(r.at_shop ? { atShop: true } : {}),
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
  const registerId = await joinBuddy(sql, order.customer_id);
  if (registerId) await sql.query("SELECT id FROM customers WHERE id = $1 FOR UPDATE", [registerId]);
  const add = (kind: LedgerKind, bucks: number) =>
    bucks === 0
      ? Promise.resolve()
      : registerId
        ? sql.query(
            `INSERT INTO loyalty_ledger (business_id, customer_id, kind, bucks, web_order_id, note)
             VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
            [order.business_id, registerId, kind, bucks, orderId, websiteOrderNote(orderId)],
          )
        : sql.query(
            `INSERT INTO store_loyalty_ledger (business_id, customer_id, kind, bucks, order_id)
             VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
            [order.business_id, order.customer_id, kind, bucks, orderId],
          );
  await add("redeem", -order.reward_bucks);
  await add("earn", bucksEarned(order.subtotal_cents - order.discount_cents));

  // The birthday gift is once a year wherever it's given: the website remembers its last one, and
  // the register's ledger has the counter's.
  const customer = (
    await sql.query<{ birthday: string | null; last_gift_on: string | null }>(
      registerId
        ? `SELECT to_char(coalesce(s.birthday, r.birthday), 'YYYY-MM-DD') AS birthday,
                  to_char(greatest(s.last_gift_on,
                    (SELECT max((l.created_at AT TIME ZONE 'America/Chicago')::date) FROM loyalty_ledger l
                     WHERE l.customer_id = r.id AND l.kind = 'birthday')), 'YYYY-MM-DD') AS last_gift_on
           FROM store_customers s, customers r WHERE s.id = $1 AND r.id = $2 FOR UPDATE OF s`
        : `SELECT to_char(birthday, 'YYYY-MM-DD') AS birthday, to_char(last_gift_on, 'YYYY-MM-DD') AS last_gift_on
           FROM store_customers WHERE id = $1 FOR UPDATE`,
      registerId ? [order.customer_id, registerId] : [order.customer_id],
    )
  ).rows[0];
  if (customer && birthdayGiftDue(customer.birthday, customer.last_gift_on, today)) {
    await add("birthday", BIRTHDAY_BUCKS);
    await sql.query("UPDATE store_customers SET last_gift_on = $2 WHERE id = $1", [order.customer_id, today]);
  }
}

/** What one order did to the shopper's Bucks, or undefined for a guest order. */
export async function orderBucks(sql: Sql, orderId: string): Promise<OrderBucks | undefined> {
  let rows: { kind: LedgerKind; bucks: number }[] = [];
  if (await registerBucksHere(sql))
    rows = (
      await sql.query<{ kind: LedgerKind; bucks: number }>(
        "SELECT kind, bucks FROM loyalty_ledger WHERE web_order_id = $1",
        [orderId],
      )
    ).rows;
  // An order paid before its shopper was joined still has its own entries on the website.
  if (rows.length === 0)
    rows = (
      await sql.query<{ kind: LedgerKind; bucks: number }>(
        "SELECT kind, bucks FROM store_loyalty_ledger WHERE order_id = $1",
        [orderId],
      )
    ).rows;
  if (rows.length === 0) return undefined;
  const sum = (kind: LedgerKind) => rows.filter((r) => r.kind === kind).reduce((n, r) => n + r.bucks, 0);
  return { earned: sum("earn"), used: Math.abs(sum("redeem")), birthday: sum("birthday") };
}
