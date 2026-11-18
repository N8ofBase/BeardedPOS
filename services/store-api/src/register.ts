// The hosted register (apps/web) under /api/pos: staff sign in with an email code, then call the
// register's handlers by name. The staff member, role and business come from the session, never from
// the request, and every handler runs through invoke(), which checks the role and sets row-level
// security. Only active staff with an email in the register's Settings can sign in, by email code or,
// on a tablet an owner or manager has set up, by tapping their name and entering a PIN (registerPins.ts).
import type { Kysely } from "kysely";
import { handlers, invoke, type HandlerName } from "@bearded/api";
import { AppError, isRole, type Ctx, type ErrorCode } from "@bearded/core";
import type { DB } from "@bearded/db";
import type { StoreCtx } from "./context.ts";
import { withBusiness, type Sql } from "./db.ts";
import { sendStockToSquare, squareApi, syncRegister, syncStatus } from "./square/registerSync.ts";
import { asObject, HttpError, ok, type ApiRequest, type ApiResponse } from "./http.ts";
import {
  CODE_MINUTES,
  issueCode,
  newToken,
  readEmail,
  sha256,
  useCode,
  wrongCode,
} from "./handlers/codes.ts";
import { handlePins } from "./registerPins.ts";

export const POS_COOKIE = "bbg_pos";
export const SESSION_HOURS = 12;

const STATUS: Record<ErrorCode, number> = { invalid: 400, forbidden: 403, not_found: 404, conflict: 409 };

/** What the register's screens get back for a refused call: the sentence to show and the form fields. */
export interface PosError {
  error: string;
  code: ErrorCode;
  fields: Record<string, string>;
}

/** A register cookie: only ever sent to /api/pos, never readable by the page. */
export function posCookie(ctx: StoreCtx, name: string, token: string, maxAgeSeconds: number): string {
  return [
    `${name}=${token}`,
    "Path=/api/pos",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${maxAgeSeconds}`,
    ...(ctx.config.secureCookies ? ["Secure"] : []),
  ].join("; ");
}

const cookie = (ctx: StoreCtx, token: string, maxAgeSeconds: number) =>
  posCookie(ctx, POS_COOKIE, token, maxAgeSeconds);

/** Starts a register session for a staff member and returns the response that sets its cookie. */
export async function startSession(
  ctx: StoreCtx,
  sql: Sql,
  staffId: string,
  tabletId: string | null,
): Promise<ApiResponse> {
  const token = newToken();
  await sql.query(
    `INSERT INTO pos_staff_sessions (business_id, staff_id, token_hash, expires_at, tablet_id)
     VALUES ($1, $2, $3, now() + make_interval(hours => $4), $5)`,
    [ctx.config.businessId, staffId, sha256(token), SESSION_HOURS, tabletId],
  );
  return {
    status: 200,
    body: { signedIn: true },
    headers: { "Set-Cookie": cookie(ctx, token, SESSION_HOURS * 3600) },
  };
}

async function activeStaffByEmail(sql: Sql, email: string): Promise<string | undefined> {
  const { rows } = await sql.query<{ id: string }>(
    "SELECT id FROM staff WHERE lower(email) = $1 AND active",
    [email],
  );
  return rows[0]?.id;
}

/** Sends a code to active staff. The answer is the same for any email, so it can't find staff addresses. */
async function requestCode(ctx: StoreCtx, req: ApiRequest): Promise<ApiResponse> {
  const email = readEmail(asObject(req.body));
  const { businessId } = ctx.config;
  const code = await withBusiness(ctx.db, businessId, async (sql) =>
    (await activeStaffByEmail(sql, email)) ? issueCode(sql, "pos_staff_codes", businessId, email) : null,
  );
  if (code)
    await ctx.mailer.send(email, `Your register code: ${code}`, `It works for ${CODE_MINUTES} minutes.`);
  // Offline there's no email, so the code comes back to show on screen.
  return ok(code && ctx.square.mode === "offline" ? { sent: true, devCode: code } : { sent: true });
}

async function signIn(ctx: StoreCtx, req: ApiRequest): Promise<ApiResponse> {
  const body = asObject(req.body);
  const email = readEmail(body);
  // A wrong try is counted even though sign-in fails, so the error is thrown after the commit.
  const signedIn = await withBusiness(ctx.db, ctx.config.businessId, async (sql) => {
    if (!(await useCode(sql, "pos_staff_codes", email, body.code))) return null;
    const staffId = await activeStaffByEmail(sql, email);
    return staffId ? startSession(ctx, sql, staffId, null) : null;
  });
  if (!signedIn) throw wrongCode();
  return signedIn;
}

async function signOut(ctx: StoreCtx, req: ApiRequest): Promise<ApiResponse> {
  const token = req.cookies[POS_COOKIE];
  if (token)
    await withBusiness(ctx.db, ctx.config.businessId, (sql) =>
      sql.query("DELETE FROM pos_staff_sessions WHERE token_hash = $1", [sha256(token)]),
    );
  return { status: 200, body: { signedIn: false }, headers: { "Set-Cookie": cookie(ctx, "", 0) } };
}

/** The signed-in staff member, or null. A session ends when its staff member is made inactive. */
export async function session(ctx: StoreCtx, req: ApiRequest): Promise<Ctx | null> {
  const token = req.cookies[POS_COOKIE];
  if (!token) return null;
  const { businessId } = ctx.config;
  const row = await withBusiness(ctx.db, businessId, async (sql) => {
    const { rows } = await sql.query<{ id: string; role: string }>(
      `SELECT s.id, s.role FROM pos_staff_sessions x JOIN staff s ON s.id = x.staff_id
       WHERE x.token_hash = $1 AND x.expires_at > now() AND s.active`,
      [sha256(token)],
    );
    return rows[0];
  });
  return row && isRole(row.role) ? { businessId, staffId: row.id, role: row.role } : null;
}

async function call(ctx: StoreCtx, pos: Kysely<DB>, req: ApiRequest, name: string): Promise<ApiResponse> {
  const staff = await session(ctx, req);
  if (!staff) throw new HttpError(401, "Sign in to use the register.");
  // Only the registry's own names: never a name that reaches the object's prototype.
  if (!Object.hasOwn(handlers, name)) throw new HttpError(404, "Not found.");
  const input = asObject(req.body ?? {}).input;
  try {
    const output = (await invoke(pos, staff, name as HandlerName, input as never)) ?? null;
    // A sale, refund or count may have changed stock: Square hears about it now. A failure is
    // kept and retried, and never fails the register's own call.
    await sendStockToSquare(ctx).catch((e: unknown) => console.error("square stock send failed", e));
    return ok({ output });
  } catch (e) {
    if (e instanceof AppError) {
      const body: PosError = { error: e.message, code: e.code, fields: e.fields };
      return { status: STATUS[e.code], body };
    }
    throw e;
  }
}

/** Settings, Square: when it last synced, and a preview or a sync. Owners and managers. */
async function square(ctx: StoreCtx, req: ApiRequest, what: "status" | "sync"): Promise<ApiResponse> {
  const staff = await session(ctx, req);
  if (!staff) throw new HttpError(401, "Sign in to use the register.");
  try {
    if (what === "status") return ok(await syncStatus(ctx, staff));
    if (!squareApi(ctx)) throw new AppError("invalid", "This register isn't connected to a Square account.");
    return ok(await syncRegister(ctx, staff, asObject(req.body ?? {}).apply === true));
  } catch (e) {
    if (e instanceof AppError) {
      const body: PosError = { error: e.message, code: e.code, fields: e.fields };
      return { status: STATUS[e.code], body };
    }
    console.error("square sync failed", e);
    // A Postgres error carries a five-character SQLSTATE code: the register's database refused
    // something. Anything else is Square or the network. Either way the owner sees what failed
    // (Square's own message names only the request, never the token).
    const why = e as { code?: unknown; constraint?: unknown; message?: unknown } | null;
    const detail = typeof why?.message === "string" ? why.message.slice(0, 200) : "";
    const fromDatabase = typeof why?.code === "string" && /^[0-9A-Z]{5}$/.test(why.code);
    return {
      status: 502,
      body: {
        error: fromDatabase
          ? `The register couldn't save what came from Square. Nothing was changed. (${typeof why?.constraint === "string" ? why.constraint : detail})`
          : `Square didn't answer. Try again in a minute. (${detail})`,
      },
    };
  }
}

/** Handles /api/pos/* when the register is set up on this server, else null. */
export async function handleRegister(ctx: StoreCtx, req: ApiRequest): Promise<ApiResponse | null> {
  const m = /^\/api\/pos\/(.+)$/.exec(req.path);
  if (!m) return null;
  if (!ctx.pos) return { status: 404, body: { error: "Not found." } };
  if (req.method !== "POST") return { status: 405, body: { error: "Not found." } };
  const route = m[1]!;
  if (route === "code") return requestCode(ctx, req);
  if (route === "session") return signIn(ctx, req);
  if (route === "signout") return signOut(ctx, req);
  const pins = await handlePins(ctx, req, route);
  if (pins) return pins;
  if (route === "square/status" || route === "square/sync")
    return square(ctx, req, route.slice(7) as "status" | "sync");
  const handler = /^call\/([A-Za-z]+)$/.exec(route);
  if (handler) return call(ctx, ctx.pos, req, handler[1]!);
  return { status: 404, body: { error: "Not found." } };
}
