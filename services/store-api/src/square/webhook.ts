// Square's webhook: Square calls this when a payment or order changes, so a paid website order is
// marked paid even when the shopper closes the tab before the thank-you page. Every call is checked
// against Square's signature first. The body is only a hint: we look the order up and ask Square
// whether it's paid before marking anything.
import { createHmac, timingSafeEqual } from "node:crypto";
import type { StoreCtx } from "../context.ts";
import { withBusiness } from "../db.ts";
import { HttpError, ok, type ApiRequest, type ApiResponse } from "../http.ts";
import { markPaid } from "../handlers/shop.ts";
import { storeToday } from "../loyalty.ts";
import { creditSquareAppSale } from "../squareAppBucks.ts";

export const SIGNATURE_HEADER = "x-square-hmacsha256-signature";

/**
 * Square signs the notification URL followed by the raw body with the subscription's signature key
 * (HMAC-SHA256, base64). The URL must be exactly the one saved in Square's Webhooks page.
 */
export function squareSignature(signatureKey: string, notificationUrl: string, rawBody: string): string {
  return createHmac("sha256", signatureKey)
    .update(notificationUrl + rawBody)
    .digest("base64");
}

export function validSquareSignature(
  signatureKey: string,
  notificationUrl: string,
  rawBody: string,
  signature: string | undefined,
): boolean {
  if (!signature) return false;
  const want = Buffer.from(squareSignature(signatureKey, notificationUrl, rawBody));
  const got = Buffer.from(signature);
  return want.length === got.length && timingSafeEqual(want, got);
}

/** The Square order id a payment or order event is about, if any. */
export function eventOrderId(event: unknown): string | undefined {
  const e = event as {
    type?: string;
    data?: { object?: Record<string, { order_id?: unknown; id?: unknown } | undefined> };
  };
  const object = e?.data?.object ?? {};
  const id =
    object.payment?.order_id ??
    object.order_updated?.order_id ??
    object.order_created?.order_id ??
    object.order?.id;
  return typeof id === "string" && id ? id : undefined;
}

export async function squareWebhook(ctx: StoreCtx, req: ApiRequest): Promise<ApiResponse> {
  const hook = ctx.config.squareWebhook;
  if (!hook) throw new HttpError(404, "Not found.");
  const raw = req.rawBody ?? "";
  if (!validSquareSignature(hook.signatureKey, hook.url, raw, req.headers[SIGNATURE_HEADER])) {
    console.warn("square webhook: bad signature");
    throw new HttpError(403, "Bad signature.");
  }
  const squareOrderId = eventOrderId(req.body);
  if (!squareOrderId) return ok({ ok: true });
  const { businessId } = ctx.config;
  const order = await withBusiness(ctx.db, businessId, async (sql) => {
    const { rows } = await sql.query<{ id: string; status: string }>(
      "SELECT id, status FROM store_orders WHERE square_order_id = $1",
      [squareOrderId],
    );
    return rows[0];
  });
  // Not a website order: maybe a sale rung in the Square app, which earns its customer's Bucks.
  if (!order) {
    await squareAppSale(ctx, squareOrderId);
    return ok({ ok: true });
  }
  // Already done: nothing to do, and Square stops retrying.
  if (order.status !== "open") return ok({ ok: true });
  // Square may still be finishing the payment; a later event (or the thank-you page) catches it.
  if (!(await ctx.square.orderPaid(squareOrderId))) return ok({ ok: true });
  const marked = await withBusiness(ctx.db, businessId, (sql) =>
    markPaid(sql, order.id, storeToday(ctx.now())),
  );
  if (marked) console.log(`square webhook: order ${order.id} paid`);
  return ok({ ok: true });
}

/**
 * Beard Bucks for a sale rung only in the Square app, when the register shares this database. A
 * failure is logged and never fails the webhook: Square would only retry the same thing.
 */
async function squareAppSale(ctx: StoreCtx, squareOrderId: string): Promise<void> {
  if (!ctx.pos || !ctx.square.appSale) return;
  try {
    const sale = await ctx.square.appSale(squareOrderId);
    if (!sale) return;
    const result = await withBusiness(ctx.db, ctx.config.businessId, (sql) =>
      creditSquareAppSale(sql, ctx.config.businessId, sale, storeToday(ctx.now())),
    );
    if (result === "credited")
      console.log(`square webhook: Square app sale ${squareOrderId} earned Beard Bucks`);
    if (result === "no_match")
      console.log(`square webhook: Square app sale ${squareOrderId}: no Beard Buddy matches its customer`);
  } catch (e) {
    console.error(`square webhook: Square app sale ${squareOrderId} not credited`, e);
  }
}
