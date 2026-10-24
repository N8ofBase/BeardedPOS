// Routes /api requests to handlers. Errors come back as { error } with a sentence the site shows as is.
import type { StoreCtx } from "./context.ts";
import { HttpError, type ApiRequest, type ApiResponse } from "./http.ts";
import { logEvents } from "./handlers/events.ts";
import { joinVip, listReviews, submitReview } from "./handlers/people.ts";
import { checkout, getCatalog, getPreviewOrder, payPreviewOrder } from "./handlers/shop.ts";
import { me, moderateReview, requestCode, signIn, signOut, staffReviews } from "./handlers/staff.ts";
import { getStats } from "./handlers/stats.ts";

type Route = [
  method: string,
  pattern: RegExp,
  run: (ctx: StoreCtx, req: ApiRequest, id: string) => Promise<ApiResponse>,
];

const ROUTES: Route[] = [
  ["GET", /^\/api\/catalog$/, getCatalog],
  ["POST", /^\/api\/checkout$/, checkout],
  ["GET", /^\/api\/checkout-preview\/([^/]+)$/, (ctx, _req, id) => getPreviewOrder(ctx, id)],
  ["POST", /^\/api\/checkout-preview\/([^/]+)\/pay$/, (ctx, _req, id) => payPreviewOrder(ctx, id)],
  ["POST", /^\/api\/vip$/, joinVip],
  ["GET", /^\/api\/reviews$/, listReviews],
  ["POST", /^\/api\/reviews$/, submitReview],
  ["POST", /^\/api\/events$/, logEvents],
  ["POST", /^\/api\/staff\/code$/, requestCode],
  ["POST", /^\/api\/staff\/session$/, signIn],
  ["GET", /^\/api\/staff\/me$/, me],
  ["POST", /^\/api\/staff\/signout$/, signOut],
  ["GET", /^\/api\/staff\/reviews$/, staffReviews],
  ["POST", /^\/api\/staff\/reviews\/([^/]+)$/, moderateReview],
  ["GET", /^\/api\/staff\/stats$/, getStats],
];

export async function handle(ctx: StoreCtx, req: ApiRequest): Promise<ApiResponse> {
  const matches = ROUTES.filter(([, pattern]) => pattern.test(req.path));
  const route = matches.find(([method]) => method === req.method);
  if (!route) return { status: matches.length ? 405 : 404, body: { error: "Not found." } };
  // Bodies must be JSON, which also keeps other sites' plain form posts out.
  if (
    req.method === "POST" &&
    req.body !== undefined &&
    !req.headers["content-type"]?.includes("application/json")
  )
    return { status: 415, body: { error: "Send JSON." } };
  try {
    const id = decodeURIComponent(route[1].exec(req.path)?.[1] ?? "");
    return await route[2](ctx, req, id);
  } catch (e) {
    if (e instanceof HttpError) return { status: e.status, body: { error: e.message } };
    console.error("store api error", e);
    return { status: 500, body: { error: "Something went wrong on our side. Try again in a minute." } };
  }
}
