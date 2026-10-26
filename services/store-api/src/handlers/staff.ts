// Behind the Beard: one-time-code sign-in for the team, and review moderation.
import type { CodeResponse, ReviewAction, StaffReview } from "@bearded/store-core";
import type { StoreConfig, StoreCtx } from "../context.ts";
import { withBusiness } from "../db.ts";
import { asObject, HttpError, ok, type ApiRequest, type ApiResponse } from "../http.ts";
import { CODE_MINUTES, issueCode, newToken, readEmail, sha256, useCode, wrongCode } from "./codes.ts";
import { REVIEW_COLUMNS, toReview, type ReviewRow } from "./people.ts";

export const STAFF_COOKIE = "bbg_staff";
const SESSION_HOURS = 12;

export function isStaffEmail(config: StoreConfig, email: string): boolean {
  const e = email.trim().toLowerCase();
  return config.staff.some((s) => {
    const rule = s.trim().toLowerCase();
    return rule.startsWith("@") ? e.endsWith(rule) : e === rule;
  });
}

/** Sends a sign-in code. The answer is the same for any email, so it can't be used to find staff addresses. */
export async function requestCode(ctx: StoreCtx, req: ApiRequest): Promise<ApiResponse> {
  const email = readEmail(asObject(req.body));
  const sent: CodeResponse = { sent: true };
  if (!isStaffEmail(ctx.config, email)) return ok(sent);
  const code = await withBusiness(ctx.db, ctx.config.businessId, (sql) =>
    issueCode(sql, "store_staff_codes", ctx.config.businessId, email),
  );
  await ctx.mailer.send(
    email,
    `Your Behind the Beard code: ${code}`,
    `It works for ${CODE_MINUTES} minutes.`,
  );
  // Offline there's no email, so the code comes back to show on screen.
  return ok(ctx.square.mode === "offline" ? { ...sent, devCode: code } : sent);
}

export function sessionCookie(ctx: StoreCtx, token: string, maxAgeSeconds: number): string {
  return [
    `${STAFF_COOKIE}=${token}`,
    "Path=/api/staff",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${maxAgeSeconds}`,
    ...(ctx.config.secureCookies ? ["Secure"] : []),
  ].join("; ");
}

export async function signIn(ctx: StoreCtx, req: ApiRequest): Promise<ApiResponse> {
  const body = asObject(req.body);
  const email = readEmail(body);
  const token = newToken();
  // A wrong try must be counted even though sign-in fails, so the transaction returns the outcome
  // and the error is thrown after it commits.
  const signedIn = await withBusiness(ctx.db, ctx.config.businessId, async (sql) => {
    if (!(await useCode(sql, "store_staff_codes", email, body.code))) return false;
    await sql.query(
      `INSERT INTO store_staff_sessions (business_id, email, token_hash, expires_at)
       VALUES ($1, $2, $3, now() + make_interval(hours => $4))`,
      [ctx.config.businessId, email, sha256(token), SESSION_HOURS],
    );
    return true;
  });
  if (!signedIn) throw wrongCode();
  return {
    status: 200,
    body: { email },
    headers: { "Set-Cookie": sessionCookie(ctx, token, SESSION_HOURS * 3600) },
  };
}

/** The signed-in staff email, or a 401 that sends the screen back to sign-in. */
export async function requireStaff(ctx: StoreCtx, req: ApiRequest): Promise<string> {
  const token = req.cookies[STAFF_COOKIE];
  const email =
    token &&
    (await withBusiness(ctx.db, ctx.config.businessId, async (sql) => {
      const { rows } = await sql.query<{ email: string }>(
        "SELECT email FROM store_staff_sessions WHERE token_hash = $1 AND expires_at > now()",
        [sha256(token)],
      );
      return rows[0]?.email;
    }));
  // A staff member removed from the list loses access at once, even mid-session.
  if (!email || !isStaffEmail(ctx.config, email)) throw new HttpError(401, "Sign in to Behind the Beard.");
  return email;
}

export async function me(ctx: StoreCtx, req: ApiRequest): Promise<ApiResponse> {
  return ok({ email: await requireStaff(ctx, req) });
}

export async function signOut(ctx: StoreCtx, req: ApiRequest): Promise<ApiResponse> {
  const token = req.cookies[STAFF_COOKIE];
  if (token)
    await withBusiness(ctx.db, ctx.config.businessId, (sql) =>
      sql.query("DELETE FROM store_staff_sessions WHERE token_hash = $1", [sha256(token)]),
    );
  return { status: 204, headers: { "Set-Cookie": sessionCookie(ctx, "", 0) } };
}

const STATUSES = ["pending", "approved", "hidden"] as const;

export async function staffReviews(ctx: StoreCtx, req: ApiRequest): Promise<ApiResponse> {
  await requireStaff(ctx, req);
  const status = STATUSES.find((s) => s === req.query.get("status")) ?? "pending";
  const rows = await withBusiness(
    ctx.db,
    ctx.config.businessId,
    async (sql) =>
      (
        await sql.query<ReviewRow>(
          `SELECT ${REVIEW_COLUMNS} FROM store_reviews WHERE status = $1 ORDER BY created_at DESC LIMIT 500`,
          [status],
        )
      ).rows,
  );
  return ok(
    rows.map((r): StaffReview => ({
      ...toReview(r),
      email: r.email,
      status: r.status,
      createdAt: r.created_at.toISOString(),
    })),
  );
}

const ACTIONS: Record<ReviewAction, string> = {
  approve: "status = 'approved', approved_at = coalesce(approved_at, now())",
  hide: "status = 'hidden', featured = false",
  feature: "status = 'approved', approved_at = coalesce(approved_at, now()), featured = true",
  unfeature: "featured = false",
};

export async function moderateReview(ctx: StoreCtx, req: ApiRequest, id: string): Promise<ApiResponse> {
  await requireStaff(ctx, req);
  const action = asObject(req.body).action as ReviewAction;
  const set = ACTIONS[action];
  if (!set || !/^[0-9a-f-]{36}$/i.test(id))
    throw new HttpError(400, "Pick approve, hide, feature or unfeature.");
  const found = await withBusiness(
    ctx.db,
    ctx.config.businessId,
    async (sql) =>
      (await sql.query(`UPDATE store_reviews SET ${set} WHERE id = $1 RETURNING id`, [id])).rows.length,
  );
  if (!found) throw new HttpError(404, "That review is gone.");
  return { status: 204 };
}
