// The Stats tab: what visitors look at, click and buy, and the carts they leave behind.
import { storeProducts, type Count, type LeftCart, type StoreStats } from "@bearded/store-core";
import type { StoreCtx } from "../context.ts";
import { withBusiness, type Sql } from "../db.ts";
import { ok, type ApiRequest, type ApiResponse } from "../http.ts";
import { pruneEvents } from "./events.ts";
import { requireStaff } from "./staff.ts";

export const RANGES = [7, 30, 90] as const;
/** A cart counts as left behind once it has sat this long without a paid order. */
export const LEFT_AFTER_HOURS = 24;

interface CartEvent {
  visitor_id: string;
  type: "cart_add" | "cart_remove" | "cart_qty";
  product_id: string | null;
  qty: number | null;
  at: Date;
}

interface OrderRow {
  visitor_id: string | null;
  status: string;
  created_at: Date;
  paid_at: Date | null;
}

/**
 * Replays each visitor's cart events. A cart is left behind when it still holds items, its last
 * change is over LEFT_AFTER_HOURS old, and no order was paid after that change.
 */
export function leftCarts(
  events: CartEvent[],
  orders: OrderRow[],
  now: Date,
  names: Map<string, string>,
): LeftCart[] {
  const carts = new Map<string, { items: Map<string, number>; last: Date }>();
  for (const e of [...events].sort((a, b) => a.at.getTime() - b.at.getTime())) {
    if (!e.product_id) continue;
    const cart = carts.get(e.visitor_id) ?? { items: new Map<string, number>(), last: e.at };
    const have = cart.items.get(e.product_id) ?? 0;
    const next = e.type === "cart_add" ? have + (e.qty ?? 1) : e.type === "cart_qty" ? (e.qty ?? 0) : 0;
    if (next > 0) cart.items.set(e.product_id, next);
    else cart.items.delete(e.product_id);
    cart.last = e.at;
    carts.set(e.visitor_id, cart);
  }
  const cutoff = now.getTime() - LEFT_AFTER_HOURS * 3600_000;
  const out: LeftCart[] = [];
  for (const [visitorId, cart] of carts) {
    if (cart.items.size === 0 || cart.last.getTime() > cutoff) continue;
    const mine = orders.filter((o) => o.visitor_id === visitorId);
    if (mine.some((o) => o.paid_at && o.paid_at >= cart.last)) continue;
    // Checkout opens after the last cart change, so a later open order means they reached Square.
    const reachedCheckout = mine.some((o) => o.status === "open" && o.created_at >= cart.last);
    out.push({
      visitorId,
      lastActivity: cart.last.toISOString(),
      items: [...cart.items].map(([id, qty]) => ({
        name: names.get(id) ?? "An item no longer in the shop",
        qty,
      })),
      stoppedAt: reachedCheckout ? "checkout" : "cart",
    });
  }
  return out.sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
}

const counts = async (sql: Sql, text: string, params: unknown[]): Promise<Count[]> =>
  (await sql.query<{ label: string; count: number }>(text, params)).rows;

export async function getStats(ctx: StoreCtx, req: ApiRequest): Promise<ApiResponse> {
  await requireStaff(ctx, req);
  const asked = Number(req.query.get("days"));
  const days = RANGES.find((d) => d === asked) ?? 30;
  await pruneEvents(ctx);
  const products = storeProducts(await ctx.square.catalog());
  const names = new Map(products.map((p) => [p.id, p.name]));
  const now = ctx.now();
  const since = new Date(now.getTime() - days * 864e5);

  const stats = await withBusiness(ctx.db, ctx.config.businessId, async (sql): Promise<StoreStats> => {
    const p = [since];
    const one = async (text: string, params: unknown[] = p) =>
      (await sql.query<{ n: number }>(text, params)).rows[0]?.n ?? 0;
    const byType = Object.fromEntries(
      (
        await sql.query<{ type: string; n: number }>(
          "SELECT type, count(*)::int AS n FROM store_events WHERE at >= $1 GROUP BY type",
          p,
        )
      ).rows.map((r) => [r.type, r.n]),
    ) as Record<string, number>;
    const cartEvents = (
      await sql.query<CartEvent>(
        `SELECT visitor_id, type, product_id, qty, at FROM store_events
         WHERE at >= $1 AND type IN ('cart_add', 'cart_remove', 'cart_qty') ORDER BY at`,
        p,
      )
    ).rows;
    const orders = (
      await sql.query<OrderRow & { subtotal_cents: number }>(
        "SELECT visitor_id, status, created_at, paid_at, subtotal_cents FROM store_orders WHERE created_at >= $1",
        p,
      )
    ).rows;
    const adds = await counts(
      sql,
      `SELECT product_id AS label, sum(coalesce(qty, 1))::int AS count FROM store_events
       WHERE at >= $1 AND type = 'cart_add' AND product_id IS NOT NULL GROUP BY product_id ORDER BY count DESC LIMIT 20`,
      p,
    );
    const paid = orders.filter((o) => o.status === "paid");
    return {
      days,
      visitors: await one(
        "SELECT count(DISTINCT visitor_id)::int AS n FROM store_events WHERE at >= $1 AND type = 'page_view'",
      ),
      pageViews: byType.page_view ?? 0,
      cartAdds: await one(
        "SELECT coalesce(sum(coalesce(qty, 1)), 0)::int AS n FROM store_events WHERE at >= $1 AND type = 'cart_add'",
      ),
      checkoutsStarted: orders.length,
      ordersPaid: paid.length,
      paidCents: paid.reduce((n, o) => n + o.subtotal_cents, 0),
      topPages: await counts(
        sql,
        `SELECT path AS label, count(*)::int AS count FROM store_events
         WHERE at >= $1 AND type = 'page_view' GROUP BY path ORDER BY count DESC, path LIMIT 10`,
        p,
      ),
      topGames: await counts(
        sql,
        `SELECT substring(path FROM '^/games/([a-z0-9-]+)') AS label, count(*)::int AS count FROM store_events
         WHERE at >= $1 AND type = 'page_view' AND path LIKE '/games/%' GROUP BY 1 ORDER BY count DESC, 1 LIMIT 10`,
        p,
      ),
      topClicks: await counts(
        sql,
        `SELECT label, count(*)::int AS count FROM store_events
         WHERE at >= $1 AND type = 'click' AND label IS NOT NULL GROUP BY label ORDER BY count DESC, label LIMIT 10`,
        p,
      ),
      // Each visitor's first page in the range says where they came from.
      sources: await counts(
        sql,
        `SELECT coalesce(source, 'Direct or unknown') AS label, count(*)::int AS count FROM (
           SELECT DISTINCT ON (visitor_id) source FROM store_events
           WHERE at >= $1 AND type = 'page_view' ORDER BY visitor_id, at
         ) firsts GROUP BY 1 ORDER BY count DESC, 1 LIMIT 10`,
        p,
      ),
      addsByProduct: adds.map((a) => ({
        label: names.get(a.label) ?? "An item no longer in the shop",
        count: a.count,
      })),
      leftCarts: leftCarts(cartEvents, orders, now, names),
      popup: {
        shown: byType.popup_shown ?? 0,
        closed: byType.popup_closed ?? 0,
        joined: byType.popup_joined ?? 0,
      },
      rolls: byType.roll ?? 0,
      vipJoins: await one("SELECT count(*)::int AS n FROM store_vip_signups WHERE created_at >= $1"),
      reviewsSent: await one("SELECT count(*)::int AS n FROM store_reviews WHERE created_at >= $1"),
    };
  });
  return ok(stats);
}
