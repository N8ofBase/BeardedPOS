// Square's Point of Sale API for mobile web: the register opens the Square POS app on the same
// phone or tablet with the amount, the customer pays there (Square Reader, or a tap on the phone
// where Square's app allows it), and the app sends the browser back to the return page. This file
// only builds that link and reads the answer; whether the card was really paid is checked on the
// server with Square (services/store-api/src/square/pos.ts).

/** What the link carries. Nothing here is secret: the application id is public. */
export interface SquarePosRequest {
  applicationId: string;
  callbackUrl: string;
  /** Our one-time reference; Square hands it back unchanged. */
  state: string;
  amountCents: number;
  currency: string;
  note: string;
}

export type SquarePosPlatform = "ios" | "android" | "other";

/** The return page, under the register's own address: `${siteUrl}/register/square-return`. */
export function squareReturnUrl(siteUrl: string): string {
  return `${siteUrl.replace(/\/+$/, "")}/register/square-return`;
}

/** Which Square POS app link this device takes. iPadOS reports itself as a Mac with a touch screen. */
export function squarePosPlatform(userAgent: string, maxTouchPoints = 0): SquarePosPlatform {
  if (/iPhone|iPad|iPod/.test(userAgent)) return "ios";
  if (/Macintosh/.test(userAgent) && maxTouchPoints > 1) return "ios";
  if (/Android/.test(userAgent)) return "android";
  return "other";
}

const NOTE_MAX = 500;

/** The link that opens the Square POS app, or null on a device that can't run it (a laptop). */
export function squarePosUrl(platform: SquarePosPlatform, r: SquarePosRequest): string | null {
  const note = r.note.slice(0, NOTE_MAX);
  if (platform === "ios") {
    const data = {
      amount_money: { amount: r.amountCents, currency_code: r.currency },
      callback_url: r.callbackUrl,
      client_id: r.applicationId,
      version: "1.3",
      notes: note,
      state: r.state,
      options: { supported_tender_types: ["CREDIT_CARD"], auto_return: true, skip_receipt: true },
    };
    return `square-commerce-v1://payment/create?data=${encodeURIComponent(JSON.stringify(data))}`;
  }
  if (platform === "android") {
    const e = encodeURIComponent;
    return [
      "intent:#Intent",
      "action=com.squareup.pos.action.CHARGE",
      "package=com.squareup",
      `S.com.squareup.pos.WEB_CALLBACK_URI=${e(r.callbackUrl)}`,
      `S.com.squareup.pos.CLIENT_ID=${e(r.applicationId)}`,
      "S.com.squareup.pos.API_VERSION=v2.0",
      `i.com.squareup.pos.TOTAL_AMOUNT=${r.amountCents}`,
      `S.com.squareup.pos.CURRENCY_CODE=${e(r.currency)}`,
      "S.com.squareup.pos.TENDER_TYPES=com.squareup.pos.TENDER_CARD",
      `S.com.squareup.pos.REQUEST_METADATA=${e(r.state)}`,
      `S.com.squareup.pos.NOTE=${e(note)}`,
      "l.com.squareup.pos.AUTO_RETURN_TIMEOUT_MS=3200",
      "end",
    ].join(";");
  }
  return null;
}

/** What the Square POS app said, read from the return page's address. */
export interface SquarePosAnswer {
  state: string;
  transactionId?: string;
  errorCode?: string;
  errorDescription?: string;
}

/** A query string's parameters (core runs without the DOM, so no URLSearchParams). */
function queryParams(search: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of search.replace(/^\?/, "").split("&")) {
    if (!part) continue;
    const i = part.indexOf("=");
    const decode = (x: string) => {
      try {
        return decodeURIComponent(x.replace(/\+/g, " "));
      } catch {
        return "";
      }
    };
    const key = decode(i < 0 ? part : part.slice(0, i));
    if (!out.has(key)) out.set(key, i < 0 ? "" : decode(part.slice(i + 1)));
  }
  return out;
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/**
 * Reads the return page's query string. iOS sends one `data` parameter holding JSON; Android sends
 * separate com.squareup.pos.* parameters. Null when it isn't an answer from Square at all.
 */
export function readSquarePosAnswer(search: string): SquarePosAnswer | null {
  const q = queryParams(search);
  const data = q.get("data");
  if (data) {
    let d: Record<string, unknown>;
    try {
      d = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return null;
    }
    if (!d || typeof d !== "object") return null;
    const state = str(d.state);
    if (!state) return null;
    const ok = d.status === "ok";
    return {
      state,
      ...(ok && str(d.transaction_id) ? { transactionId: str(d.transaction_id) } : {}),
      ...(!ok ? { errorCode: str(d.error_code) ?? "unknown_error" } : {}),
    };
  }
  const state = str(q.get("com.squareup.pos.REQUEST_METADATA"));
  if (!state) return null;
  const errorCode = str(q.get("com.squareup.pos.ERROR_CODE"));
  const transactionId = str(q.get("com.squareup.pos.SERVER_TRANSACTION_ID"));
  const errorDescription = str(q.get("com.squareup.pos.ERROR_DESCRIPTION"));
  return {
    state,
    ...(errorCode ? { errorCode } : transactionId ? { transactionId } : {}),
    ...(errorCode && errorDescription ? { errorDescription } : {}),
  };
}
