// Customer accounts for the public pages: sign-in with a one-time code, sessions,
// and the signed-in customer's own details.
import { sql, type Transaction } from "kysely";
import { AppError, CODE_RULES, codeFromBytes, formatPhone, normalizeContact } from "@bearded/core";
import type { DB } from "@bearded/db";
import { definePublic, type SignedCtx } from "./handler.ts";

type Trx = Transaction<DB>;

async function sha256(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

function randomHex(bytes: number): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

// ---- the store ----

export interface StoreInfo {
  storeName: string;
  logo: string | null;
  brandColor: string | null;
}

export const storeInfo = definePublic<void, StoreInfo>({
  signedIn: false,
  async run(trx, ctx) {
    const b = await trx
      .selectFrom("businesses")
      .select(["name", "logo_data", "brand_color"])
      .where("id", "=", ctx.businessId)
      .executeTakeFirstOrThrow();
    return { storeName: b.name, logo: b.logo_data, brandColor: b.brand_color };
  },
});

// ---- sign-in with a one-time code ----

export interface CodeSent {
  /** "a text to (212) 555-0100" or "an email to pat@example.com" */
  sentTo: string;
  /** Demo mode only: the code, shown on screen instead of sent. */
  demoCode?: string;
}

export const requestCode = definePublic<{ contact: string }, CodeSent>({
  signedIn: false,
  async run(trx, ctx, { contact }) {
    const c = normalizeContact(contact ?? "");
    if (!c) throw new AppError("invalid", "Enter a 10-digit mobile number or an email address.");
    const recent = await trx
      .selectFrom("customer_login_codes")
      .select(["created_at"])
      .where("contact", "=", c.value)
      .where("created_at", ">", new Date(Date.now() - 3600_000))
      .execute();
    if (recent.filter((r) => r.created_at.getTime() > Date.now() - 60_000).length >= CODE_RULES.perMinute)
      throw new AppError("invalid", "A code was just sent. Wait a minute before asking for another.");
    if (recent.length >= CODE_RULES.perHour)
      throw new AppError("invalid", "Too many codes asked for. Try again in an hour.");
    const b = new Uint8Array(3);
    crypto.getRandomValues(b);
    const code = codeFromBytes(b);
    await trx
      .insertInto("customer_login_codes")
      .values({
        business_id: ctx.businessId,
        contact: c.value,
        code_hash: await sha256(`${ctx.businessId}:${c.value}:${code}`),
        expires_at: new Date(Date.now() + CODE_RULES.expiresMinutes * 60_000),
      })
      .execute();
    // Hosted mode sends the code by text or email here; the demo shows it instead.
    return {
      sentTo: c.kind === "phone" ? `a text to ${formatPhone(c.value)}` : `an email to ${c.value}`,
      ...(ctx.demo ? { demoCode: code } : {}),
    };
  },
});

export type VerifyResult =
  | { status: "signed_in"; token: string; name: string }
  /** The code is right but there's no customer yet: ask for their name and verify again. */
  | { status: "needs_name" }
  /**
   * A wrong code. Returned rather than thrown, so the try is counted: an error would
   * roll the count back along with the transaction.
   */
  | { status: "wrong"; message: string };

export const verifyCode = definePublic<{ contact: string; code: string; name?: string }, VerifyResult>({
  signedIn: false,
  async run(trx, ctx, { contact, code, name }) {
    const c = normalizeContact(contact ?? "");
    if (!c) throw new AppError("invalid", "Enter a 10-digit mobile number or an email address.");
    const row = await trx
      .selectFrom("customer_login_codes")
      .select(["id", "code_hash", "expires_at", "attempts", "used_at"])
      .where("contact", "=", c.value)
      .orderBy("created_at", "desc")
      .limit(1)
      .executeTakeFirst();
    const wrong = "That code isn't right. Check it, or ask for a new one.";
    if (!row || row.used_at) throw new AppError("invalid", wrong);
    if (row.expires_at < new Date())
      throw new AppError("invalid", "That code has expired. Ask for a new one.");
    if (row.attempts >= CODE_RULES.maxTries)
      throw new AppError("invalid", "Too many tries. Ask for a new code.");
    if (row.code_hash !== (await sha256(`${ctx.businessId}:${c.value}:${(code ?? "").trim()}`))) {
      await trx
        .updateTable("customer_login_codes")
        .set({ attempts: row.attempts + 1 })
        .where("id", "=", row.id)
        .execute();
      return { status: "wrong", message: wrong };
    }
    let customer = await trx
      .selectFrom("customers")
      .select(["id", "name"])
      .where(c.kind === "phone" ? "phone" : sql<string>`lower(email)`, "=", c.value)
      .executeTakeFirst();
    if (!customer) {
      const n = name?.trim();
      if (!n) return { status: "needs_name" };
      customer = await trx
        .insertInto("customers")
        .values({
          business_id: ctx.businessId,
          name: n.slice(0, 120),
          ...(c.kind === "phone" ? { phone: c.value } : { email: c.value }),
        })
        .returning(["id", "name"])
        .executeTakeFirstOrThrow();
    }
    await trx
      .updateTable("customer_login_codes")
      .set({ used_at: new Date() })
      .where("id", "=", row.id)
      .execute();
    const token = randomHex(32);
    await trx
      .insertInto("customer_sessions")
      .values({
        business_id: ctx.businessId,
        customer_id: customer.id,
        token_hash: await sha256(token),
        expires_at: new Date(Date.now() + CODE_RULES.sessionDays * 86_400_000),
      })
      .execute();
    return { status: "signed_in", token, name: customer.name };
  },
});

/** Finds the customer for a session token, or null. Used by invokePublic. */
export async function customerForToken(trx: Trx, token: string | null): Promise<string | null> {
  if (!token) return null;
  const s = await trx
    .selectFrom("customer_sessions")
    .select(["id", "customer_id", "expires_at"])
    .where("token_hash", "=", await sha256(token))
    .executeTakeFirst();
  if (!s || s.expires_at < new Date()) return null;
  await trx
    .updateTable("customer_sessions")
    .set({ last_seen_at: new Date() })
    .where("id", "=", s.id)
    .execute();
  return s.customer_id;
}

export const signOut = definePublic<{ token: string }, void>({
  signedIn: false,
  async run(trx, _ctx, { token }) {
    await trx
      .deleteFrom("customer_sessions")
      .where("token_hash", "=", await sha256(token))
      .execute();
  },
});

// ---- the customer's account ----

export interface MyAccount {
  name: string;
  phone: string | null;
  email: string | null;
}

export const myAccount = definePublic<void, MyAccount>({
  signedIn: true,
  async run(trx, ctx) {
    const { customerId } = ctx as SignedCtx;
    return trx
      .selectFrom("customers")
      .select(["name", "phone", "email"])
      .where("id", "=", customerId)
      .executeTakeFirstOrThrow();
  },
});
