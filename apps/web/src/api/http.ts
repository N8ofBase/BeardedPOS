import { AppError, type ErrorCode } from "@bearded/core";
import type { Api } from "./client.ts";

/** The server said the session is gone (signed out elsewhere, expired, or made inactive). */
export class SignedOutError extends Error {
  constructor() {
    super("Sign in to use the register.");
    this.name = "SignedOutError";
  }
}

// Timestamps arrive as JSON strings; the screens expect Dates, as in the demo. Dates without a time
// ("YYYY-MM-DD") stay strings, as they do in the demo.
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function reviveDates(_key: string, value: unknown): unknown {
  return typeof value === "string" && TIMESTAMP.test(value) ? new Date(value) : value;
}

const CODES: ErrorCode[] = ["forbidden", "not_found", "invalid", "conflict"];

/** POSTs JSON under /api/pos and turns a refusal into the AppError the screens already show. */
export async function posFetch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api/pos/${path}`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text, reviveDates) : null;
  } catch {
    // Not JSON: a gateway or network page. Handled below by status.
  }
  if (res.ok) return data as T;
  // A handler call refused for no session; sign-in's own 401 (a wrong code) carries its sentence.
  if (res.status === 401 && path.startsWith("call/")) throw new SignedOutError();
  const e = (data ?? {}) as { error?: unknown; code?: unknown; fields?: unknown };
  if (typeof e.error === "string") {
    const code = CODES.includes(e.code as ErrorCode) ? (e.code as ErrorCode) : "invalid";
    const fields = e.fields && typeof e.fields === "object" ? (e.fields as Record<string, string>) : {};
    throw new AppError(code, e.error, fields);
  }
  throw new Error(`Request failed (${res.status})`);
}

/** The hosted register: every handler call goes to the server, as the signed-in staff member. */
export function createHttpApi(onSignedOut: () => void): Api {
  return {
    async call(name, ...input) {
      try {
        const r = await posFetch<{ output: unknown }>(`call/${name}`, { input: input[0] });
        return r.output as never;
      } catch (e) {
        if (e instanceof SignedOutError) onSignedOut();
        throw e;
      }
    },
  };
}
