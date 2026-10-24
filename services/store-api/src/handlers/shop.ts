// Catalog, checkout and the offline preview of Square's payment page.
import {
  maxQty,
  storeProducts,
  type CheckoutResponse,
  type OrderLine,
  type OrderStatus,
  type OrderView,
  type Product,
} from "@bearded/store-core";
import type { StoreCtx } from "../context.ts";
import { withBusiness, type Sql } from "../db.ts";
import { asObject, HttpError, ok, type ApiRequest, type ApiResponse } from "../http.ts";

export async function getCatalog(ctx: StoreCtx): Promise<ApiResponse> {
  return ok(await ctx.square.catalog());
}

const MAX_LINES = 20;

/**
 * Prices the cart on the server from the current Square catalog. The browser sends only ids and
 * quantities; anything not in the store, sold out or above stock is refused with a sentence the
 * shopper can act on, rather than quietly changed.
 */
export function priceLines(raw: unknown, products: Product[]): OrderLine[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new HttpError(400, "Your cart is empty.");
  if (raw.length > MAX_LINES)
    throw new HttpError(400, `A web order can hold up to ${MAX_LINES} different items.`);
  const byId = new Map(products.map((p) => [p.id, p]));
  const qty = new Map<string, number>();
  for (const l of raw) {
    const line = asObject(l);
    if (typeof line.productId !== "string" || !Number.isInteger(line.qty) || (line.qty as number) < 1)
      throw new HttpError(400, "Your cart has an item we couldn’t read. Remove it and add it again.");
    qty.set(line.productId, (qty.get(line.productId) ?? 0) + (line.qty as number));
  }
  return [...qty].map(([id, n]) => {
    const p = byId.get(id);
    if (!p)
      throw new HttpError(409, "An item in your cart is no longer in the shop. Remove it to check out.");
    const max = maxQty(p);
    if (max === 0) throw new HttpError(409, `${p.name} just sold out. Remove it to check out.`);
    if (n > max)
      throw new HttpError(409, `Only ${max} of ${p.name} available. Lower the quantity to check out.`);
    return { productId: p.id, name: p.name, qty: n, priceCents: p.priceCents };
  });
}

export const subtotal = (lines: OrderLine[]) => lines.reduce((n, l) => n + l.priceCents * l.qty, 0);

export async function checkout(ctx: StoreCtx, req: ApiRequest): Promise<ApiResponse> {
  const body = asObject(req.body);
  const lines = priceLines(body.lines, storeProducts(await ctx.square.catalog()));
  const visitorId =
    typeof body.visitorId === "string" && /^[A-Za-z0-9-]{1,64}$/.test(body.visitorId) ? body.visitorId : null;
  const { businessId } = ctx.config;
  const id = await withBusiness(ctx.db, businessId, async (sql) => {
    const { rows } = await sql.query<{ id: string }>(
      `INSERT INTO store_orders (business_id, visitor_id, lines, subtotal_cents)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [businessId, visitorId, JSON.stringify(lines), subtotal(lines)],
    );
    return rows[0]!.id;
  });
  const link = await ctx.square.createPaymentLink({
    id,
    lines: lines.map((l) => ({ productId: l.productId, qty: l.qty })),
    redirectUrl: `${ctx.config.siteUrl}/thanks?order=${id}`,
  });
  await withBusiness(ctx.db, businessId, (sql) =>
    sql.query("UPDATE store_orders SET square_order_id = $2, square_payment_link_id = $3 WHERE id = $1", [
      id,
      link.squareOrderId,
      link.paymentLinkId,
    ]),
  );
  return ok({ url: link.url, orderId: id } satisfies CheckoutResponse);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadOrder(sql: Sql, id: string): Promise<OrderView> {
  if (!UUID.test(id)) throw new HttpError(404, "We couldn’t find that order.");
  const { rows } = await sql.query<{
    id: string;
    status: OrderView["status"];
    lines: OrderLine[];
    subtotal_cents: number;
  }>("SELECT id, status, lines, subtotal_cents FROM store_orders WHERE id = $1", [id]);
  const r = rows[0];
  if (!r) throw new HttpError(404, "We couldn’t find that order.");
  return { id: r.id, status: r.status, lines: r.lines, subtotalCents: r.subtotal_cents };
}

/** Marks an order paid once. Square's webhook calls this when hosted; the preview page does offline. */
export async function markPaid(sql: Sql, id: string): Promise<boolean> {
  const { rows } = await sql.query<{ id: string }>(
    "UPDATE store_orders SET status = 'paid', paid_at = now() WHERE id = $1 AND status = 'open' RETURNING id",
    [id],
  );
  return rows.length > 0;
}

/**
 * The thank-you page asks this when Square sends the shopper back. An open order is checked with
 * Square and marked paid once Square says so. Square's webhook (when hosted) does the same.
 */
export async function getOrderStatus(ctx: StoreCtx, id: string): Promise<ApiResponse> {
  if (!UUID.test(id)) throw new HttpError(404, "We couldn’t find that order.");
  const { businessId } = ctx.config;
  const order = await withBusiness(ctx.db, businessId, async (sql) => {
    const { rows } = await sql.query<{ status: OrderStatus["status"]; square_order_id: string | null }>(
      "SELECT status, square_order_id FROM store_orders WHERE id = $1",
      [id],
    );
    return rows[0];
  });
  if (!order) throw new HttpError(404, "We couldn’t find that order.");
  if (order.status !== "open" || !order.square_order_id)
    return ok({ status: order.status } satisfies OrderStatus);
  let paid = false;
  try {
    paid = await ctx.square.orderPaid(order.square_order_id);
  } catch (e) {
    // Square being slow or down isn't the shopper's problem: the page says payment is being confirmed.
    console.error("square order check failed", e);
  }
  if (paid) await withBusiness(ctx.db, businessId, (sql) => markPaid(sql, id));
  return ok({ status: paid ? "paid" : "open" } satisfies OrderStatus);
}

function offlineOnly(ctx: StoreCtx) {
  if (ctx.square.mode !== "offline") throw new HttpError(404, "Not found.");
}

export async function getPreviewOrder(ctx: StoreCtx, id: string): Promise<ApiResponse> {
  offlineOnly(ctx);
  return ok(await withBusiness(ctx.db, ctx.config.businessId, (sql) => loadOrder(sql, id)));
}

export async function payPreviewOrder(ctx: StoreCtx, id: string): Promise<ApiResponse> {
  offlineOnly(ctx);
  return ok(
    await withBusiness(ctx.db, ctx.config.businessId, async (sql) => {
      await loadOrder(sql, id);
      await markPaid(sql, id);
      return loadOrder(sql, id);
    }),
  );
}
