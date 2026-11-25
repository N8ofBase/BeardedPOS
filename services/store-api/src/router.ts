// Routes /api requests to handlers. Errors come back as { error } with a sentence the site shows as is.
import type { StoreCtx } from "./context.ts";
import { HttpError, type ApiRequest, type ApiResponse } from "./http.ts";
import {
  buddySignIn,
  buddySignOut,
  getAccount,
  requestBuddyCode,
  saveAccount,
  staffBuddies,
  staffBuddyHistory,
} from "./handlers/account.ts";
import { logEvents } from "./handlers/events.ts";
import { chooseOldSite, oldSiteChoices } from "./handlers/oldSite.ts";
import { joinVip, listReviews, submitReview } from "./handlers/people.ts";
import {
  getStaffSite,
  publishedSite,
  publishSite,
  restoreVersion,
  saveDraft,
  siteImage,
  uploadImage,
} from "./handlers/site.ts";
import { checkout, getCatalog, getOrderStatus, getPreviewOrder, payPreviewOrder } from "./handlers/shop.ts";
import {
  me,
  moderateReview,
  squareAccount,
  requestCode,
  signIn,
  signOut,
  staffReviews,
} from "./handlers/staff.ts";
import { getStats } from "./handlers/stats.ts";
import { playGame } from "./handlers/play.ts";
import { handleRegister } from "./register.ts";
import { unsubscribeRoute } from "./emailQueue.ts";
import { squareWebhook } from "./square/webhook.ts";

type Route = [
  method: string,
  pattern: RegExp,
  run: (ctx: StoreCtx, req: ApiRequest, id: string) => Promise<ApiResponse>,
];

const ROUTES: Route[] = [
  ["GET", /^\/api\/catalog$/, getCatalog],
  ["POST", /^\/api\/square\/webhook$/, squareWebhook],
  ["POST", /^\/api\/checkout$/, checkout],
  ["GET", /^\/api\/orders\/([^/]+)$/, getOrderStatus],
  ["GET", /^\/api\/checkout-preview\/([^/]+)$/, (ctx, _req, id) => getPreviewOrder(ctx, id)],
  ["POST", /^\/api\/checkout-preview\/([^/]+)\/pay$/, (ctx, _req, id) => payPreviewOrder(ctx, id)],
  ["POST", /^\/api\/account\/code$/, requestBuddyCode],
  ["POST", /^\/api\/account\/session$/, buddySignIn],
  ["POST", /^\/api\/account\/signout$/, buddySignOut],
  ["GET", /^\/api\/account$/, getAccount],
  ["POST", /^\/api\/account$/, saveAccount],
  ["GET", /^\/api\/play\/([^/]+)$/, playGame],
  ["POST", /^\/api\/vip$/, joinVip],
  ["GET", /^\/api\/reviews$/, listReviews],
  ["POST", /^\/api\/reviews$/, submitReview],
  ["POST", /^\/api\/events$/, logEvents],
  ["GET", /^\/api\/unsubscribe$/, unsubscribeRoute],
  ["POST", /^\/api\/unsubscribe$/, unsubscribeRoute],
  ["POST", /^\/api\/staff\/code$/, requestCode],
  ["POST", /^\/api\/staff\/session$/, signIn],
  ["GET", /^\/api\/staff\/me$/, me],
  ["GET", /^\/api\/staff\/square$/, squareAccount],
  ["POST", /^\/api\/staff\/signout$/, signOut],
  ["GET", /^\/api\/staff\/reviews$/, staffReviews],
  ["POST", /^\/api\/staff\/reviews\/([^/]+)$/, moderateReview],
  ["GET", /^\/api\/staff\/stats$/, getStats],
  ["GET", /^\/api\/staff\/old-site$/, oldSiteChoices],
  ["GET", /^\/api\/staff\/buddies$/, staffBuddies],
  ["GET", /^\/api\/staff\/buddies\/([^/]+)$/, staffBuddyHistory],
  ["POST", /^\/api\/staff\/old-site\/([^/]+)$/, chooseOldSite],
  ["GET", /^\/api\/site$/, publishedSite],
  ["GET", /^\/api\/site\/images\/([^/]+)$/, siteImage],
  ["GET", /^\/api\/staff\/site$/, getStaffSite],
  ["POST", /^\/api\/staff\/site\/draft$/, saveDraft],
  ["POST", /^\/api\/staff\/site\/publish$/, publishSite],
  ["POST", /^\/api\/staff\/site\/images$/, uploadImage],
  ["POST", /^\/api\/staff\/site\/restore\/([^/]+)$/, restoreVersion],
];

/** Picture uploads are bigger than any other store request (the editor shrinks them first). */
export const UPLOAD_PATH = "/api/staff/site/images";
export const MAX_UPLOAD_BODY = 3 * 1024 * 1024;

export async function handle(ctx: StoreCtx, req: ApiRequest): Promise<ApiResponse> {
  const matches = ROUTES.filter(([, pattern]) => pattern.test(req.path));
  const route = matches.find(([method]) => method === req.method);
  const register = req.path.startsWith("/api/pos/");
  if (!route && !register) return { status: matches.length ? 405 : 404, body: { error: "Not found." } };
  // Bodies must be JSON, which also keeps other sites' plain form posts out.
  if (
    req.method === "POST" &&
    req.body !== undefined &&
    !req.headers["content-type"]?.includes("application/json")
  )
    return { status: 415, body: { error: "Send JSON." } };
  try {
    if (!route) return (await handleRegister(ctx, req))!;
    const id = decodeURIComponent(route[1].exec(req.path)?.[1] ?? "");
    return await route[2](ctx, req, id);
  } catch (e) {
    if (e instanceof HttpError) return { status: e.status, body: { error: e.message } };
    console.error("store api error", e);
    return { status: 500, body: { error: "Something went wrong on our side. Try again in a minute." } };
  }
}
