// Beard Buddy accounts for shoppers: sign in with an email code (signing in is joining), see Beard
// Bucks, and add a name and birthday. Staff sign-in is separate (staff.ts): its own codes, sessions
// and cookie, so a shopper's session never opens Behind the Beard.
import type { Account, AccountUpdate, CodeResponse, StaffBuddy } from "@bearded/store-core";
import type { StoreCtx } from "../context.ts";
import { withBusiness, type Sql } from "../db.ts";
import { asObject, HttpError, ok, type ApiRequest, type ApiResponse } from "../http.ts";
import { bucksBalance, ledgerHistory, storeToday } from "../loyalty.ts";
import { CODE_MINUTES, issueCode, newToken, readEmail, sha256, useCode, wrongCode } from "./codes.ts";
import { requireStaff } from "./staff.ts";

export const BUDDY_COOKIE = "bbg_buddy";
const SESSION_DAYS = 30;
const NAME_MAX = 60;
/** A birthday can't be moved again for this long after it's set, so the gift can't be farmed. */
const BIRTHDAY_LOCK_DAYS = 365;

function buddyCookie(ctx: StoreCtx, token: string, maxAgeSeconds: number): string {
  return [
    `${BUDDY_COOKIE}=${token}`,
    "Path=/api",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${maxAgeSeconds}`,
    ...(ctx.config.secureCookies ? ["Secure"] : []),
  ].join("; ");
}

/** Sends a sign-in code to any email: anyone can join Beard Buddy. */
export async function requestBuddyCode(ctx: StoreCtx, req: ApiRequest): Promise<ApiResponse> {
  const email = readEmail(asObject(req.body));
  const code = await withBusiness(ctx.db, ctx.config.businessId, (sql) =>
    issueCode(sql, "store_customer_codes", ctx.config.businessId, email),
  );
  await ctx.mailer.send(
    email,
    `Your Beard Buddy code: ${code}`,
    `Enter it on the Bearded Board Games site to see your Beard Bucks. It works for ${CODE_MINUTES} minutes.`,
  );
  const sent: CodeResponse = { sent: true };
  // Offline there's no email, so the code comes back to show on screen.
  return ok(ctx.square.mode === "offline" ? { ...sent, devCode: code } : sent);
}

export async function buddySignIn(ctx: StoreCtx, req: ApiRequest): Promise<ApiResponse> {
  const body = asObject(req.body);
  const email = readEmail(body);
  const token = newToken();
  const { businessId } = ctx.config;
  // A wrong try is counted even though sign-in fails, so the error is thrown after the commit.
  const signedIn = await withBusiness(ctx.db, businessId, async (sql) => {
    if (!(await useCode(sql, "store_customer_codes", email, body.code))) return false;
    const { rows } = await sql.query<{ id: string }>(
      `INSERT INTO store_customers (business_id, email) VALUES ($1, $2)
       ON CONFLICT (business_id, lower(email)) DO UPDATE SET email = store_customers.email
       RETURNING id`,
      [businessId, email],
    );
    await sql.query(
      `INSERT INTO store_customer_sessions (business_id, customer_id, token_hash, expires_at)
       VALUES ($1, $2, $3, now() + make_interval(days => $4))`,
      [businessId, rows[0]!.id, sha256(token), SESSION_DAYS],
    );
    return true;
  });
  if (!signedIn) throw wrongCode();
  return {
    status: 200,
    body: await withBusiness(ctx.db, businessId, async (sql) =>
      loadAccount(sql, (await sessionCustomer(sql, token))!, storeToday(ctx.now())),
    ),
    headers: { "Set-Cookie": buddyCookie(ctx, token, SESSION_DAYS * 86_400) },
  };
}

async function sessionCustomer(sql: Sql, token: string): Promise<string | undefined> {
  const { rows } = await sql.query<{ customer_id: string }>(
    "SELECT customer_id FROM store_customer_sessions WHERE token_hash = $1 AND expires_at > now()",
    [sha256(token)],
  );
  return rows[0]?.customer_id;
}

/** The signed-in shopper's id, or null for a guest. Runs inside the caller's transaction. */
export async function currentCustomer(sql: Sql, req: ApiRequest): Promise<string | null> {
  const token = req.cookies[BUDDY_COOKIE];
  return (token && (await sessionCustomer(sql, token))) || null;
}

const notSignedIn = () => new HttpError(401, "Sign in to see your Beard Bucks.");

async function loadAccount(sql: Sql, customerId: string, today: string): Promise<Account> {
  const { rows } = await sql.query<{
    email: string;
    name: string | null;
    birthday: string | null;
    birthday_set_on: string | null;
  }>(
    `SELECT email, name, to_char(birthday, 'YYYY-MM-DD') AS birthday,
            to_char(birthday_set_on, 'YYYY-MM-DD') AS birthday_set_on
     FROM store_customers WHERE id = $1`,
    [customerId],
  );
  const c = rows[0]!;
  return {
    email: c.email,
    name: c.name,
    birthday: c.birthday,
    birthdayLocked: birthdayLocked(c.birthday, c.birthday_set_on, today),
    ...(await bucksBalance(sql, customerId)),
    history: await ledgerHistory(sql, customerId),
  };
}

function birthdayLocked(birthday: string | null, setOn: string | null, today: string): boolean {
  if (!birthday || !setOn) return false;
  const days = (Date.parse(today) - Date.parse(setOn)) / 86_400_000;
  return days < BIRTHDAY_LOCK_DAYS;
}

export async function getAccount(ctx: StoreCtx, req: ApiRequest): Promise<ApiResponse> {
  return ok(
    await withBusiness(ctx.db, ctx.config.businessId, async (sql) => {
      const id = await currentCustomer(sql, req);
      if (!id) throw notSignedIn();
      return loadAccount(sql, id, storeToday(ctx.now()));
    }),
  );
}

function readUpdate(raw: unknown, today: string): AccountUpdate {
  const body = asObject(raw);
  const out: AccountUpdate = {};
  if (body.name !== undefined) {
    if (typeof body.name !== "string" || body.name.trim().length > NAME_MAX)
      throw new HttpError(400, `Keep your name to ${NAME_MAX} characters.`);
    out.name = body.name.trim();
  }
  if (body.birthday !== undefined) {
    const b = body.birthday;
    const valid =
      b === null ||
      (typeof b === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(b) &&
        new Date(`${b}T00:00:00Z`).toISOString().slice(0, 10) === b &&
        b >= "1900-01-01" &&
        b <= today);
    if (!valid) throw new HttpError(400, "Check your birthday: pick a real date that’s already happened.");
    out.birthday = b as string | null;
  }
  return out;
}

export async function saveAccount(ctx: StoreCtx, req: ApiRequest): Promise<ApiResponse> {
  const today = storeToday(ctx.now());
  const update = readUpdate(req.body, today);
  return ok(
    await withBusiness(ctx.db, ctx.config.businessId, async (sql) => {
      const id = await currentCustomer(sql, req);
      if (!id) throw notSignedIn();
      if (update.name !== undefined)
        await sql.query("UPDATE store_customers SET name = nullif($2, '') WHERE id = $1", [id, update.name]);
      if (update.birthday !== undefined) {
        const { rows } = await sql.query<{ birthday: string | null; birthday_set_on: string | null }>(
          `SELECT to_char(birthday, 'YYYY-MM-DD') AS birthday, to_char(birthday_set_on, 'YYYY-MM-DD') AS birthday_set_on
           FROM store_customers WHERE id = $1 FOR UPDATE`,
          [id],
        );
        const c = rows[0]!;
        if (c.birthday !== update.birthday) {
          if (birthdayLocked(c.birthday, c.birthday_set_on, today))
            throw new HttpError(409, "Your birthday was set this year. Email us if it needs fixing.");
          await sql.query(
            "UPDATE store_customers SET birthday = $2, birthday_set_on = CASE WHEN $2::date IS NULL THEN NULL ELSE $3::date END WHERE id = $1",
            [id, update.birthday, today],
          );
        }
      }
      return loadAccount(sql, id, today);
    }),
  );
}

export async function buddySignOut(ctx: StoreCtx, req: ApiRequest): Promise<ApiResponse> {
  const token = req.cookies[BUDDY_COOKIE];
  if (token)
    await withBusiness(ctx.db, ctx.config.businessId, (sql) =>
      sql.query("DELETE FROM store_customer_sessions WHERE token_hash = $1", [sha256(token)]),
    );
  return { status: 204, headers: { "Set-Cookie": buddyCookie(ctx, "", 0) } };
}

/** The Beard Buddies tab: every shopper with an account, biggest balance first. */
export async function staffBuddies(ctx: StoreCtx, req: ApiRequest): Promise<ApiResponse> {
  await requireStaff(ctx, req);
  const rows = await withBusiness(
    ctx.db,
    ctx.config.businessId,
    async (sql) =>
      (
        await sql.query<{
          id: string;
          email: string;
          name: string | null;
          balance: number;
          paid_orders: number;
          last_order_at: Date | null;
          created_at: Date;
        }>(
          `SELECT c.id, c.email, c.name, c.created_at,
             (SELECT coalesce(sum(bucks), 0)::int FROM store_loyalty_ledger l WHERE l.customer_id = c.id) AS balance,
             (SELECT count(*)::int FROM store_orders o WHERE o.customer_id = c.id AND o.status = 'paid') AS paid_orders,
             (SELECT max(paid_at) FROM store_orders o WHERE o.customer_id = c.id AND o.status = 'paid') AS last_order_at
           FROM store_customers c
           ORDER BY balance DESC, c.created_at DESC LIMIT 500`,
        )
      ).rows,
  );
  return ok(
    rows.map((r): StaffBuddy => ({
      id: r.id,
      email: r.email,
      name: r.name,
      balance: r.balance,
      paidOrders: r.paid_orders,
      lastOrderAt: r.last_order_at?.toISOString() ?? null,
      joinedAt: r.created_at.toISOString(),
    })),
  );
}

/** One shopper's Bucks history, for staff. */
export async function staffBuddyHistory(ctx: StoreCtx, req: ApiRequest, id: string): Promise<ApiResponse> {
  await requireStaff(ctx, req);
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(404, "We couldn’t find that Beard Buddy.");
  return ok(await withBusiness(ctx.db, ctx.config.businessId, (sql) => ledgerHistory(sql, id, 200)));
}
