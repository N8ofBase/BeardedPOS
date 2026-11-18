// The live register's card payments open the Square POS app on this phone or tablet. Before the
// page leaves for Square, the sale and payment are remembered here, so the return page (and a
// register opened again by hand) can pick the sale back up. Per device; safe to lose: the server
// still knows the payment is waiting.
import { squarePosPlatform, squarePosUrl, type SquarePosPlatform } from "@bearded/core";
import type { CardHandoff } from "@bearded/api";

const KEY = "bearded.card.handoff";

export interface WaitingHandoff {
  saleId: string;
  paymentId: string;
  amountCents: number;
  handoff: CardHandoff;
}

export function thisDevice(): SquarePosPlatform {
  if (typeof navigator === "undefined") return "other";
  return squarePosPlatform(navigator.userAgent, navigator.maxTouchPoints ?? 0);
}

export function rememberHandoff(h: WaitingHandoff | null): void {
  try {
    if (h) localStorage.setItem(KEY, JSON.stringify(h));
    else localStorage.removeItem(KEY);
  } catch {
    // Blocked storage: the server still has the waiting payment.
  }
}

export function waitingHandoff(): WaitingHandoff | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as WaitingHandoff) : null;
  } catch {
    return null;
  }
}

/** Leaves for the Square POS app. False when this device can't run it. */
export function openSquarePos(h: WaitingHandoff): boolean {
  const url = squarePosUrl(thisDevice(), h.handoff);
  if (!url) return false;
  rememberHandoff(h);
  window.location.href = url;
  return true;
}
