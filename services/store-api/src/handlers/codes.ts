// One-time email codes, shared by Behind the Beard and Beard Buddy sign-in. Each keeps its own
// table, so a shopper's code can never sign anyone in to the staff pages.
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { looksLikeEmail } from "@bearded/store-core";
import type { Sql } from "../db.ts";
import { HttpError } from "../http.ts";

export const CODE_MINUTES = 10;
const CODE_TRIES = 5;
const CODES_PER_HOUR = 5;

/** The two code tables. Never a value from a request: it goes into the SQL text. */
export type CodeTable = "store_staff_codes" | "store_customer_codes";

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const newToken = () => randomBytes(32).toString("base64url");

export function readEmail(body: Record<string, unknown>): string {
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!looksLikeEmail(email)) throw new HttpError(400, "Check the email address, like name@example.com.");
  return email;
}

export const wrongCode = () =>
  new HttpError(401, "That code didn’t match or has expired. Ask for a new one.");

/** Stores a new code for the email and returns it to send. At most five an hour per email. */
export async function issueCode(
  sql: Sql,
  table: CodeTable,
  businessId: string,
  email: string,
): Promise<string> {
  const { rows } = await sql.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM ${table} WHERE email = $1 AND created_at > now() - interval '1 hour'`,
    [email],
  );
  if ((rows[0]?.n ?? 0) >= CODES_PER_HOUR)
    throw new HttpError(429, "That’s a lot of codes. Wait an hour, or use the last one we sent.");
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await sql.query(
    `INSERT INTO ${table} (business_id, email, code_hash, expires_at)
     VALUES ($1, $2, $3, now() + make_interval(mins => $4))`,
    [businessId, email, sha256(code), CODE_MINUTES],
  );
  return code;
}

/**
 * Uses up the email's latest code if it matches. A wrong try is counted, so the caller must let the
 * transaction commit and throw wrongCode() after it when this returns false.
 */
export async function useCode(sql: Sql, table: CodeTable, email: string, raw: unknown): Promise<boolean> {
  const code = typeof raw === "string" ? raw.replace(/\s/g, "") : "";
  const { rows } = await sql.query<{ id: string; code_hash: string; attempts: number }>(
    `SELECT id, code_hash, attempts FROM ${table}
     WHERE email = $1 AND used_at IS NULL AND expires_at > now()
     ORDER BY created_at DESC LIMIT 1`,
    [email],
  );
  const row = rows[0];
  if (!row) return false;
  const match =
    row.attempts < CODE_TRIES &&
    /^\d{6}$/.test(code) &&
    timingSafeEqual(Buffer.from(sha256(code)), Buffer.from(row.code_hash));
  await sql.query(
    match
      ? `UPDATE ${table} SET used_at = now() WHERE id = $1`
      : `UPDATE ${table} SET attempts = attempts + 1 WHERE id = $1`,
    [row.id],
  );
  return match;
}
