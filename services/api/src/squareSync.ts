// The register's side of the Square sync: reads what the rules in packages/core/src/squareSync.ts
// compare, and writes what they decided, all in the caller's transaction (row-level security set).
// The store's server reads Square and calls these; they're not in the handler registry, so a
// screen can't hand in its own "Square" data.
import { sql, type Transaction } from "kysely";
import {
  assertCan,
  type Ctx,
  type CustomerPlan,
  type ProductPlan,
  type ShelfCustomer,
  type ShelfProduct,
} from "@bearded/core";
import type { DB } from "@bearded/db";
import { audit, currentLocationId } from "./shared.ts";

type Trx = Transaction<DB>;

/** The note on stock moves that copy Square's count. */
export const SQUARE_COUNT_NOTE = "Count from Square";

export interface SyncState {
  shelf: ShelfProduct[];
  customers: ShelfCustomer[];
  /** Products with stock changes Square hasn't had yet. */
  waiting: Set<string>;
}

export async function loadSyncState(trx: Trx): Promise<SyncState> {
  const locationId = await currentLocationId(trx);
  const products = await trx
    .selectFrom("products as p")
    .leftJoin("inventory_levels as l", (j) =>
      j.onRef("l.product_id", "=", "p.id").on("l.location_id", "=", locationId),
    )
    .select([
      "p.id",
      "p.sku",
      "p.barcode",
      "p.name",
      "p.price_cents",
      "p.cost_cents",
      "p.square_variation_id",
      "p.square_tracks_stock",
      sql<number>`coalesce(l.on_hand, 0)::int`.as("on_hand"),
    ])
    .orderBy("p.active", "desc")
    .orderBy("p.created_at")
    .execute();
  const customers = await trx
    .selectFrom("customers")
    .select([
      "id",
      "name",
      "phone",
      "email",
      "square_customer_id",
      "is_demo",
      "email_opt_in",
      "square_email_ok",
    ])
    .orderBy("created_at")
    .execute();
  const waiting = await trx
    .selectFrom("square_stock_sends")
    .select("product_id")
    .where("status", "=", "waiting")
    .distinct()
    .execute();
  return {
    shelf: products.map((p) => ({
      id: p.id,
      sku: p.sku,
      barcode: p.barcode,
      name: p.name,
      priceCents: p.price_cents,
      costCents: p.cost_cents,
      onHand: p.on_hand,
      squareVariationId: p.square_variation_id,
      squareTracksStock: p.square_tracks_stock,
    })),
    // Sample (DEMO) customers are never sent to Square, so they don't take part.
    customers: customers
      .filter((c) => !c.is_demo)
      .map((c) => ({
        id: c.id,
        name: c.name,
        phone: c.phone,
        email: c.email,
        squareCustomerId: c.square_customer_id,
        emailOptIn: c.email_opt_in,
        squareEmailOk: c.square_email_ok,
      })),
    waiting: new Set(waiting.map((w) => w.product_id)),
  };
}

export interface SyncSummary {
  /** Square rows the register's database refused (logged), left out so the rest still come in. */
  productsLeftOut: number;
  customersLeftOut: number;
  productsAdded: number;
  productsUpdated: number;
  pricesChanged: number;
  stockChanged: number;
  customersAdded: number;
  customersLinked: number;
  /** Square customers newly marked OK to email (not unsubscribed in Square). */
  customersOkToEmail?: number;
  /** Customers taken off email because they unsubscribed in Square. */
  customersUnsubscribed?: number;
}

/** Writes a product plan and a customer plan (Square customers in; links). Owners and managers. */
export async function applySquareSync(
  trx: Trx,
  ctx: Ctx,
  products: ProductPlan,
  customers: CustomerPlan,
): Promise<SyncSummary> {
  assertCan(ctx.role, "products.edit");
  const locationId = await currentLocationId(trx);
  const summary: SyncSummary = {
    productsLeftOut: 0,
    customersLeftOut: 0,
    productsAdded: 0,
    productsUpdated: 0,
    pricesChanged: 0,
    stockChanged: 0,
    customersAdded: 0,
    customersLinked: 0,
  };
  const count = (productId: string, qty: number) =>
    trx
      .insertInto("inventory_moves")
      .values({
        business_id: ctx.businessId,
        product_id: productId,
        location_id: locationId,
        qty_change: qty,
        reason: "adjust",
        staff_id: ctx.staffId,
        note: SQUARE_COUNT_NOTE,
        from_square: true,
      })
      .execute();

  for (const n of products.create) {
    const saved = await keepGoing(trx, `Square item ${n.item.variationId}`, async () => {
      const row = await trx
        .insertInto("products")
        .values({
          business_id: ctx.businessId,
          sku: n.sku,
          barcode: n.barcode,
          name: n.item.name.trim(),
          category: n.item.category?.trim() || "Other",
          price_cents: n.item.priceCents!,
          cost_cents: n.item.costCents ?? 0,
          square_variation_id: n.item.variationId,
          square_tracks_stock: n.item.tracksStock,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      if (n.item.tracksStock && n.item.stock) await count(row.id, n.item.stock);
    });
    if (saved) summary.productsAdded++;
    else summary.productsLeftOut++;
  }

  for (const u of products.update) {
    const before = await trx
      .selectFrom("products")
      .select(["price_cents", "cost_cents", "wholesale_cents"])
      .where("id", "=", u.productId)
      .executeTakeFirstOrThrow();
    await trx
      .updateTable("products")
      .set({
        square_variation_id: u.item.variationId,
        ...(u.changes.name !== undefined ? { name: u.changes.name } : {}),
        ...(u.changes.priceCents !== undefined ? { price_cents: u.changes.priceCents } : {}),
        ...(u.changes.costCents !== undefined ? { cost_cents: u.changes.costCents } : {}),
        ...(u.changes.tracksStock !== undefined ? { square_tracks_stock: u.changes.tracksStock } : {}),
      })
      .where("id", "=", u.productId)
      .execute();
    if (u.changes.priceCents !== undefined || u.changes.costCents !== undefined) {
      await audit(trx, ctx, {
        action: "product.price_change",
        entity: "product",
        entityId: u.productId,
        before: { price_cents: before.price_cents, cost_cents: before.cost_cents },
        after: {
          price_cents: u.changes.priceCents ?? before.price_cents,
          cost_cents: u.changes.costCents ?? before.cost_cents,
          source: "square_sync",
        },
      });
      summary.pricesChanged++;
    }
    if (u.stockTo !== null && u.stockTo !== u.stockFrom) {
      await count(u.productId, u.stockTo - u.stockFrom);
      summary.stockChanged++;
    }
    summary.productsUpdated++;
  }

  for (const c of customers.create) {
    const saved = await keepGoing(trx, `Square customer ${c.id}`, () =>
      trx
        .insertInto("customers")
        .values({
          business_id: ctx.businessId,
          name: c.name,
          phone: c.phone,
          email: c.email,
          square_customer_id: c.id,
        })
        .execute(),
    );
    if (saved) summary.customersAdded++;
    else summary.customersLeftOut++;
  }
  for (const l of customers.link) {
    const saved = await keepGoing(trx, `Square customer ${l.square.id}`, () =>
      linkCustomer(trx, l.customerId, l.square.id, l.fill),
    );
    if (saved) summary.customersLinked++;
    else summary.customersLeftOut++;
  }

  const prefs = await applyEmailPrefs(trx, customers.emailPrefs);
  summary.customersOkToEmail = prefs.ok;
  summary.customersUnsubscribed = prefs.unsubscribed;

  await trx
    .insertInto("square_sync_runs")
    .values({
      business_id: ctx.businessId,
      staff_id: ctx.staffId,
      summary: JSON.stringify(summary),
    })
    .execute();
  return summary;
}

/**
 * Square's marketing email setting, onto register customers linked to Square. Unsubscribed in
 * Square always means not OK to email here. Not unsubscribed means OK to email the first time we
 * check (unless they unsubscribed from our own emails); after that, a choice made in the register
 * stays. Returns how many changed each way.
 */
export async function applyEmailPrefs(
  trx: Trx,
  prefs: { squareId: string; unsubscribed: boolean }[],
): Promise<{ ok: number; unsubscribed: number }> {
  const off = prefs.filter((p) => p.unsubscribed).map((p) => p.squareId);
  const on = prefs.filter((p) => !p.unsubscribed).map((p) => p.squareId);
  let unsubscribed = 0;
  let ok = 0;
  if (off.length > 0) {
    const r = await trx
      .updateTable("customers")
      .set({ email_opt_in: false, square_email_ok: false })
      .where("square_customer_id", "in", off)
      .where("email_opt_in", "=", true)
      .returning("id")
      .execute();
    unsubscribed = r.length;
    await trx
      .updateTable("customers")
      .set({ square_email_ok: false })
      .where("square_customer_id", "in", off)
      .where((eb) => eb.or([eb("square_email_ok", "is", null), eb("square_email_ok", "=", true)]))
      .execute();
  }
  if (on.length > 0) {
    const r = await trx
      .updateTable("customers")
      .set({ email_opt_in: true, square_email_ok: true })
      .where("square_customer_id", "in", on)
      .where("square_email_ok", "is", null)
      .where("email", "is not", null)
      .where("email_opt_in", "=", false)
      .where(({ not, exists, selectFrom }) =>
        not(
          exists(
            selectFrom("email_suppressions as s")
              .select("s.email")
              .whereRef("s.email", "=", sql<string>`lower(customers.email)`),
          ),
        ),
      )
      .returning("id")
      .execute();
    ok = r.length;
    // The rest were checked too (already OK, no email, or unsubscribed from our own emails).
    await trx
      .updateTable("customers")
      .set({ square_email_ok: true })
      .where("square_customer_id", "in", on)
      .where("square_email_ok", "is", null)
      .execute();
  }
  return { ok, unsubscribed };
}

/**
 * Runs one row's writes inside a savepoint. If the database refuses the row (a phone another
 * customer has, say), only that row is undone and logged, and the sync goes on. False if refused.
 */
async function keepGoing(trx: Trx, what: string, write: () => Promise<unknown>): Promise<boolean> {
  await sql`SAVEPOINT square_row`.execute(trx);
  try {
    await write();
    await sql`RELEASE SAVEPOINT square_row`.execute(trx);
    return true;
  } catch (e) {
    await sql`ROLLBACK TO SAVEPOINT square_row`.execute(trx);
    const why = e as { message?: string; constraint?: string };
    console.error(`square sync: left out ${what}: ${why.constraint ?? ""} ${why.message ?? String(e)}`);
    return false;
  }
}

/** Links a register customer to Square's, filling in a phone or email the register didn't have. */
export async function linkCustomer(
  trx: Trx,
  customerId: string,
  squareCustomerId: string,
  fill: { phone?: string; email?: string } = {},
): Promise<void> {
  await trx
    .updateTable("customers")
    .set({ square_customer_id: squareCustomerId, ...fill })
    .where("id", "=", customerId)
    .execute();
}

export interface StockSend {
  id: string;
  squareVariationId: string;
  qtyChange: number;
  createdAt: Date;
}

/** The oldest stock changes waiting for Square, locked so two requests don't send the same one. */
export async function waitingStockSends(trx: Trx, limit = 100): Promise<StockSend[]> {
  const rows = await trx
    .selectFrom("square_stock_sends")
    .select(["id", "square_variation_id", "qty_change", "created_at"])
    .where("status", "=", "waiting")
    .orderBy("created_at")
    .limit(limit)
    .forUpdate()
    .skipLocked()
    .execute();
  return rows.map((r) => ({
    id: r.id,
    squareVariationId: r.square_variation_id,
    qtyChange: r.qty_change,
    createdAt: r.created_at,
  }));
}

/** Gives up on a change after this many failed sends (it stays listed as failed). */
export const MAX_SEND_TRIES = 10;

export async function markStockSends(trx: Trx, ids: string[], error: string | null): Promise<void> {
  if (ids.length === 0) return;
  if (error === null) {
    await trx
      .updateTable("square_stock_sends")
      .set({ status: "sent", sent_at: new Date(), tries: sql`tries + 1`, last_error: null })
      .where("id", "in", ids)
      .execute();
    return;
  }
  await trx
    .updateTable("square_stock_sends")
    .set({
      tries: sql`tries + 1`,
      last_error: error.slice(0, 500),
      status: sql`CASE WHEN tries + 1 >= ${MAX_SEND_TRIES} THEN 'failed' ELSE 'waiting' END`,
    })
    .where("id", "in", ids)
    .execute();
}

export interface SquareSyncStatus {
  lastSyncAt: Date | null;
  lastSummary: Record<string, unknown> | null;
  waitingSends: number;
  failedSends: number;
  linkedProducts: number;
}

export async function squareSyncStatus(trx: Trx): Promise<SquareSyncStatus> {
  const last = await trx
    .selectFrom("square_sync_runs")
    .select(["created_at", "summary"])
    .orderBy("created_at", "desc")
    .executeTakeFirst();
  const sends = await trx
    .selectFrom("square_stock_sends")
    .select([
      sql<number>`count(*) FILTER (WHERE status = 'waiting')::int`.as("waiting"),
      sql<number>`count(*) FILTER (WHERE status = 'failed')::int`.as("failed"),
    ])
    .executeTakeFirstOrThrow();
  const linked = await trx
    .selectFrom("products")
    .select(sql<number>`count(*)::int`.as("n"))
    .where("square_variation_id", "is not", null)
    .executeTakeFirstOrThrow();
  return {
    lastSyncAt: last?.created_at ?? null,
    lastSummary: (last?.summary as Record<string, unknown> | undefined) ?? null,
    waitingSends: sends.waiting,
    failedSends: sends.failed,
    linkedProducts: linked.n,
  };
}
