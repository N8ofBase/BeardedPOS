// PIN sign-in for the hosted register. An owner or manager, signed in by email code, sets up a counter
// tablet: it gets its own long-lived cookie. On that tablet the sign-in screen lists the staff who have
// a PIN; each taps their name and enters it. A PIN works only with a set-up tablet's cookie, so nobody
// can try PINs from anywhere else, and five wrong tries lock that person's PIN for 15 minutes.
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { PIN_RULES, pinProblem, type Ctx } from "@bearded/core";
import type { StoreCtx } from "./context.ts";
import { withBusiness, type Sql } from "./db.ts";
import { newToken, sha256 } from "./handlers/codes.ts";
import { asObject, HttpError, ok, type ApiRequest, type ApiResponse } from "./http.ts";
import { posCookie, session, startSession } from "./register.ts";

export const TABLET_COOKIE = "bbg_pos_tablet";
// Browsers keep a cookie at most about 400 days; the server's expires_at is what counts.
const TABLET_COOKIE_SECONDS = 400 * 24 * 3600;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What the sign-in screen gets: the tablet's name and who can sign in with a PIN, or no tablet. */
export interface TabletInfo {
  tablet: { name: string } | null;
  staff: { id: string; name: string }[];
}

export interface TabletListItem {
  id: string;
  name: string;
  setUpBy: string;
  createdAt: string;
  lastUsedAt: string | null;
  thisTablet: boolean;
}

function scryptHash(pin: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(pin, salt, 32, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("base64url")}$${(await scryptHash(pin, salt)).toString("base64url")}`;
}

export async function pinMatches(pin: string, stored: string): Promise<boolean> {
  const [kind, salt, hash] = stored.split("$");
  if (kind !== "scrypt" || !salt || !hash) return false;
  const want = Buffer.from(hash, "base64url");
  const got = await scryptHash(pin, Buffer.from(salt, "base64url"));
  return got.length === want.length && timingSafeEqual(got, want);
}

const tabletCookie = (ctx: StoreCtx, token: string, maxAge: number) =>
  posCookie(ctx, TABLET_COOKIE, token, maxAge);

/** The set-up tablet this request comes from, or undefined. */
async function tabletOf(sql: Sql, req: ApiRequest): Promise<{ id: string; name: string } | undefined> {
  const token = req.cookies[TABLET_COOKIE];
  if (!token) return undefined;
  const { rows } = await sql.query<{ id: string; name: string }>(
    "SELECT id, name FROM pos_tablets WHERE token_hash = $1 AND expires_at > now()",
    [sha256(token)],
  );
  return rows[0];
}

async function signedIn(ctx: StoreCtx, req: ApiRequest): Promise<Ctx> {
  const me = await session(ctx, req);
  if (!me) throw new HttpError(401, "Sign in to use the register.");
  return me;
}

function requireManager(me: Ctx): void {
  if (me.role !== "owner" && me.role !== "manager")
    throw new HttpError(403, "Only an owner or manager can do that.");
}

/** Anyone sets their own PIN; owners set anyone's; managers set cashiers'. */
function canSetPinFor(me: Ctx, staffId: string, role: string): boolean {
  return staffId === me.staffId || me.role === "owner" || (me.role === "manager" && role === "cashier");
}

/** The sign-in screen: is this a set-up tablet, and who on staff has a PIN. Needs no session. */
async function tablet(ctx: StoreCtx, req: ApiRequest): Promise<ApiResponse> {
  const info = await withBusiness(ctx.db, ctx.config.businessId, async (sql): Promise<TabletInfo> => {
    const t = await tabletOf(sql, req);
    if (!t) return { tablet: null, staff: [] };
    const { rows } = await sql.query<{ id: string; name: string }>(
      `SELECT s.id, s.name FROM staff s JOIN staff_pins p ON p.staff_id = s.id
       WHERE s.active ORDER BY lower(s.name)`,
    );
    return { tablet: { name: t.name }, staff: rows };
  });
  return ok(info);
}

function minutesLeft(until: Date, now: Date): number {
  return Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 60_000));
}

/** Tap a name, enter the PIN. Only on a set-up tablet. */
async function pinSignIn(ctx: StoreCtx, req: ApiRequest): Promise<ApiResponse> {
  const body = asObject(req.body);
  const staffId = typeof body.staffId === "string" && UUID.test(body.staffId) ? body.staffId : "";
  const pin = typeof body.pin === "string" ? body.pin : "";
  // A wrong try must be counted, so the transaction returns the outcome and the error comes after it.
  const outcome = await withBusiness(
    ctx.db,
    ctx.config.businessId,
    async (sql): Promise<ApiResponse | HttpError> => {
      const t = await tabletOf(sql, req);
      if (!t)
        return new HttpError(401, "This tablet isn't set up for PINs any more. Sign in with email instead.");
      const { rows } = await sql.query<{
        name: string;
        pin_hash: string;
        failed_tries: number;
        locked_until: Date | null;
        now: Date;
      }>(
        `SELECT s.name, p.pin_hash, p.failed_tries, p.locked_until, now() AS now
         FROM staff s JOIN staff_pins p ON p.staff_id = s.id WHERE s.id = $1 AND s.active`,
        [staffId],
      );
      const row = rows[0];
      if (!row) return new HttpError(401, "That PIN didn’t match.");
      if (row.locked_until && row.locked_until > row.now)
        return new HttpError(
          429,
          `Too many wrong tries. ${row.name}'s PIN works again in ${minutesLeft(row.locked_until, row.now)} minutes, or sign in with email.`,
        );
      if (/^\d{4,6}$/.test(pin) && (await pinMatches(pin, row.pin_hash))) {
        await sql.query("UPDATE staff_pins SET failed_tries = 0, locked_until = NULL WHERE staff_id = $1", [
          staffId,
        ]);
        // A tablet in use stays set up: its 90 days start again.
        await sql.query(
          `UPDATE pos_tablets SET last_used_at = now(), expires_at = now() + make_interval(days => $2)
           WHERE id = $1`,
          [t.id, PIN_RULES.tabletDays],
        );
        return startSession(ctx, sql, staffId, t.id);
      }
      const tries = row.failed_tries + 1;
      if (tries >= PIN_RULES.maxTries) {
        await sql.query(
          `UPDATE staff_pins SET failed_tries = 0, locked_until = now() + make_interval(mins => $2)
           WHERE staff_id = $1`,
          [staffId, PIN_RULES.lockMinutes],
        );
        return new HttpError(
          429,
          `Too many wrong tries. ${row.name}'s PIN works again in ${PIN_RULES.lockMinutes} minutes, or sign in with email.`,
        );
      }
      await sql.query("UPDATE staff_pins SET failed_tries = $2 WHERE staff_id = $1", [staffId, tries]);
      const left = PIN_RULES.maxTries - tries;
      return new HttpError(401, `That PIN didn’t match. ${left} ${left === 1 ? "try" : "tries"} left.`);
    },
  );
  if (outcome instanceof HttpError) throw outcome;
  return outcome;
}

/** An owner or manager sets up the tablet they're signed in on. Setting it up again replaces it. */
async function setUpTablet(ctx: StoreCtx, req: ApiRequest): Promise<ApiResponse> {
  const me = await signedIn(ctx, req);
  requireManager(me);
  const raw = asObject(req.body ?? {}).name;
  const name = (typeof raw === "string" ? raw.trim() : "").slice(0, 60) || "Counter tablet";
  const token = newToken();
  await withBusiness(ctx.db, ctx.config.businessId, async (sql) => {
    const old = req.cookies[TABLET_COOKIE];
    if (old) await sql.query("DELETE FROM pos_tablets WHERE token_hash = $1", [sha256(old)]);
    await sql.query(
      `INSERT INTO pos_tablets (business_id, name, token_hash, set_up_by, expires_at)
       VALUES ($1, $2, $3, $4, now() + make_interval(days => $5))`,
      [ctx.config.businessId, name, sha256(token), me.staffId, PIN_RULES.tabletDays],
    );
  });
  return {
    status: 200,
    body: { tablet: { name } },
    headers: { "Set-Cookie": tabletCookie(ctx, token, TABLET_COOKIE_SECONDS) },
  };
}

async function listTablets(ctx: StoreCtx, req: ApiRequest): Promise<ApiResponse> {
  const me = await signedIn(ctx, req);
  requireManager(me);
  const token = req.cookies[TABLET_COOKIE];
  const rows = await withBusiness(
    ctx.db,
    ctx.config.businessId,
    async (sql) =>
      (
        await sql.query<{
          id: string;
          name: string;
          set_up_by: string;
          created_at: Date;
          last_used_at: Date | null;
          token_hash: string;
        }>(
          `SELECT t.id, t.name, s.name AS set_up_by, t.created_at, t.last_used_at, t.token_hash
           FROM pos_tablets t JOIN staff s ON s.id = t.set_up_by
           WHERE t.expires_at > now() ORDER BY t.created_at`,
        )
      ).rows,
  );
  return ok(
    rows.map((r): TabletListItem => ({
      id: r.id,
      name: r.name,
      setUpBy: r.set_up_by,
      createdAt: r.created_at.toISOString(),
      lastUsedAt: r.last_used_at?.toISOString() ?? null,
      thisTablet: !!token && sha256(token) === r.token_hash,
    })),
  );
}

/** Removes a tablet; whoever is signed in on it with a PIN is signed out. */
async function removeTablet(ctx: StoreCtx, req: ApiRequest): Promise<ApiResponse> {
  const me = await signedIn(ctx, req);
  requireManager(me);
  const id = asObject(req.body).id;
  if (typeof id !== "string" || !UUID.test(id)) throw new HttpError(400, "Pick a tablet to remove.");
  const removed = await withBusiness(
    ctx.db,
    ctx.config.businessId,
    async (sql) =>
      (
        await sql.query<{ token_hash: string }>(
          "DELETE FROM pos_tablets WHERE id = $1 RETURNING token_hash",
          [id],
        )
      ).rows[0],
  );
  if (!removed) throw new HttpError(404, "That tablet is already gone.");
  const token = req.cookies[TABLET_COOKIE];
  const here = !!token && sha256(token) === removed.token_hash;
  return {
    status: 200,
    body: { removed: true },
    ...(here ? { headers: { "Set-Cookie": tabletCookie(ctx, "", 0) } } : {}),
  };
}

/** Which of the staff this person may set a PIN for already have one. */
async function pins(ctx: StoreCtx, req: ApiRequest): Promise<ApiResponse> {
  const me = await signedIn(ctx, req);
  const rows = await withBusiness(
    ctx.db,
    ctx.config.businessId,
    async (sql) =>
      (
        await sql.query<{ id: string; role: string }>(
          "SELECT s.id, s.role FROM staff s JOIN staff_pins p ON p.staff_id = s.id",
        )
      ).rows,
  );
  return ok({ staffIds: rows.filter((r) => canSetPinFor(me, r.id, r.role)).map((r) => r.id) });
}

/** Sets (or resets) a staff member's PIN. A new PIN also clears a lockout. */
async function setPin(ctx: StoreCtx, req: ApiRequest): Promise<ApiResponse> {
  const me = await signedIn(ctx, req);
  const body = asObject(req.body);
  const staffId = typeof body.staffId === "string" && UUID.test(body.staffId) ? body.staffId : me.staffId;
  const pin = typeof body.pin === "string" ? body.pin : "";
  const problem = pinProblem(pin);
  if (problem) return { status: 400, body: { error: problem, code: "invalid", fields: { pin: problem } } };
  const hash = await hashPin(pin);
  const outcome = await withBusiness(ctx.db, ctx.config.businessId, async (sql) => {
    const { rows } = await sql.query<{ role: string }>("SELECT role FROM staff WHERE id = $1", [staffId]);
    const target = rows[0];
    if (!target) return "missing" as const;
    if (!canSetPinFor(me, staffId, target.role)) return "forbidden" as const;
    await sql.query(
      `INSERT INTO staff_pins (business_id, staff_id, pin_hash) VALUES ($1, $2, $3)
       ON CONFLICT (business_id, staff_id)
       DO UPDATE SET pin_hash = EXCLUDED.pin_hash, failed_tries = 0, locked_until = NULL`,
      [ctx.config.businessId, staffId, hash],
    );
    return "ok" as const;
  });
  if (outcome === "missing") throw new HttpError(404, "That staff member is gone.");
  if (outcome === "forbidden") throw new HttpError(403, "Only an owner can set that person's PIN.");
  return ok({ saved: true });
}

/** Handles the PIN and tablet routes under /api/pos, else null. */
export function handlePins(ctx: StoreCtx, req: ApiRequest, route: string): Promise<ApiResponse> | null {
  switch (route) {
    case "tablet":
      return tablet(ctx, req);
    case "pin-session":
      return pinSignIn(ctx, req);
    case "tablet/setup":
      return setUpTablet(ctx, req);
    case "tablets":
      return listTablets(ctx, req);
    case "tablet/remove":
      return removeTablet(ctx, req);
    case "pins":
      return pins(ctx, req);
    case "pin":
      return setPin(ctx, req);
    default:
      return null;
  }
}
