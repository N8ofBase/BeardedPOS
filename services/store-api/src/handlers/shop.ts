// Catalog, checkout and the offline preview of Square's payment page.
import {
  BUCKS_PER_REWARD,
  maxQty,
  REWARD_CENTS,
  rewardsAllowed,
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
import { bucksBalance, orderBucks, settlePaidOrder, storeToday } from "../loyalty.ts";
import { currentCustomer } from "./account.ts";

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

const MAX_REWARDS = 100;

function readRewards(raw: unknown): number {
  if (raw === undefined) return 0;
  if (!Number.isInteger(raw) || (raw as number) < 0 || (raw as number) > MAX_REWARDS)
    throw new HttpError(400, "Pick how many Beard Bucks rewards to use again.");
  return raw as number;
}

/**
 * Starts checkout. A signed-in shopper's order is tied to them so it earns Beard Bucks once paid, and
 * may use rewards: each 100 Bucks takes $5 off, checked against their balance on the server. The
 * Bucks are held while the order is open and only taken from the ledger once Square says it's paid.
 */
export async function checkout(ctx: StoreCtx, req: ApiRequest): Promise<ApiResponse> {
  const body = asObject(req.body);
  const catalog = await ctx.square.catalog();
  const lines = priceLines(body.lines, storeProducts(catalog));
  const rewards = readRewards(body.rewards);
  const visitorId =
    typeof body.visitorId === "string" && /^[A-Za-z0-9-]{1,64}$/.test(body.visitorId) ? body.visitorId : null;
  const { businessId } = ctx.config;
  const subtotalCents = subtotal(lines);
  const order = await withBusiness(ctx.db, businessId, async (sql) => {
    const customerId = await currentCustomer(sql, req);
    let email: string | undefined;
    if (customerId) {
      // Locks the shopper, so two checkouts at once can't both spend the same Bucks.
      const { rows } = await sql.query<{ email: string }>(
        "SELECT email FROM store_customers WHERE id = $1 FOR UPDATE",
        [customerId],
      );
      email = rows[0]?.email;
    }
    if (rewards > 0) {
      if (!customerId) throw new HttpError(401, "Sign in to use your Beard Bucks.");
      const allowed = rewardsAllowed((await bucksBalance(sql, customerId)).balance, subtotalCents);
      if (rewards > allowed)
        throw new HttpError(
          409,
          allowed === 0
            ? "Your Beard Bucks can’t take anything off this order. Check out without the reward."
            : `You can use ${allowed} ${allowed === 1 ? "reward" : "rewards"} on this order. Change it and check out again.`,
        );
    }
    const discountCents = rewards * REWARD_CENTS;
    const { rows } = await sql.query<{ id: string }>(
      `INSERT INTO store_orders
         (business_id, visitor_id, lines, subtotal_cents, customer_id, reward_count, reward_bucks, discount_cents)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [
        businessId,
        visitorId,
        JSON.stringify(lines),
        subtotalCents,
        customerId,
        rewards,
        rewards * BUCKS_PER_REWARD,
        discountCents,
      ],
    );
    return { id: rows[0]!.id, email, discountCents };
  });
  let link: Awaited<ReturnType<typeof ctx.square.createPaymentLink>>;
  try {
    link = await ctx.square.createPaymentLink({
      id: order.id,
      lines: lines.map((l) => ({ productId: l.productId, qty: l.qty })),
      redirectUrl: `${ctx.config.siteUrl}/thanks?order=${order.id}`,
      discountCents: order.discountCents,
      buyerEmail: order.email,
      currency: catalog.currency,
    });
  } catch (e) {
    // No payment page means no order: let go of any Bucks it was holding.
    await withBusiness(ctx.db, businessId, (sql) =>
      sql.query("UPDATE store_orders SET status = 'cancelled' WHERE id = $1 AND status = 'open'", [order.id]),
    );
    throw e;
  }
  await withBusiness(ctx.db, businessId, (sql) =>
    sql.query("UPDATE store_orders SET square_order_id = $2, square_payment_link_id = $3 WHERE id = $1", [
      order.id,
      link.squareOrderId,
      link.paymentLinkId,
    ]),
  );
  return ok({ url: link.url, orderId: order.id } satisfies CheckoutResponse);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadOrder(sql: Sql, id: string): Promise<OrderView> {
  if (!UUID.test(id)) throw new HttpError(404, "We couldn’t find that order.");
  const { rows } = await sql.query<{
    id: string;
    status: OrderView["status"];
    lines: OrderLine[];
    subtotal_cents: number;
    discount_cents: number;
  }>("SELECT id, status, lines, subtotal_cents, discount_cents FROM store_orders WHERE id = $1", [id]);
  const r = rows[0];
  if (!r) throw new HttpError(404, "We couldn’t find that order.");
  return {
    id: r.id,
    status: r.status,
    lines: r.lines,
    subtotalCents: r.subtotal_cents,
    discountCents: r.discount_cents,
  };
}

/**
 * Marks an order paid once, and in the same transaction writes its Beard Bucks. Square's webhook
 * calls this when hosted; the thank-you page check and the offline preview page do too.
 */
export async function markPaid(sql: Sql, id: string, today: string): Promise<boolean> {
  const { rows } = await sql.query<{ id: string }>(
    "UPDATE store_orders SET status = 'paid', paid_at = now() WHERE id = $1 AND status = 'open' RETURNING id",
    [id],
  );
  if (rows.length === 0) return false;
  await settlePaidOrder(sql, id, today);
  return true;
}

/** What a paid order did to the shopper's Bucks; the balance only for the shopper who placed it. */
async function paidBucks(sql: Sql, req: ApiRequest, id: string, customerId: string | null) {
  const bucks = await orderBucks(sql, id);
  if (!bucks || !customerId || (await currentCustomer(sql, req)) !== customerId) return bucks;
  return { ...bucks, balance: (await bucksBalance(sql, customerId)).balance };
}

/**
 * The thank-you page asks this when Square sends the shopper back. An open order is checked with
 * Square and marked paid once Square says so. Square's webhook (when hosted) does the same.
 */
export async function getOrderStatus(ctx: StoreCtx, req: ApiRequest, id: string): Promise<ApiResponse> {
  if (!UUID.test(id)) throw new HttpError(404, "We couldn’t find that order.");
  const { businessId } = ctx.config;
  const order = await withBusiness(ctx.db, businessId, async (sql) => {
    const { rows } = await sql.query<{
      status: OrderStatus["status"];
      square_order_id: string | null;
      customer_id: string | null;
    }>("SELECT status, square_order_id, customer_id FROM store_orders WHERE id = $1", [id]);
    return rows[0];
  });
  if (!order) throw new HttpError(404, "We couldn’t find that order.");
  let status = order.status;
  if (status === "open" && order.square_order_id) {
    let paid = false;
    try {
      paid = await ctx.square.orderPaid(order.square_order_id);
    } catch (e) {
      // Square being slow or down isn't the shopper's problem: the page says payment is being confirmed.
      console.error("square order check failed", e);
    }
    if (paid) {
      await withBusiness(ctx.db, businessId, (sql) => markPaid(sql, id, storeToday(ctx.now())));
      status = "paid";
    }
  }
  if (status !== "paid") return ok({ status } satisfies OrderStatus);
  const bucks = await withBusiness(ctx.db, businessId, (sql) => paidBucks(sql, req, id, order.customer_id));
  return ok({ status, ...(bucks ? { bucks } : {}) } satisfies OrderStatus);
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
      await markPaid(sql, id, storeToday(ctx.now()));
      return loadOrder(sql, id);
    }),
  );
}
