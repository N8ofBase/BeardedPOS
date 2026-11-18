// The live register's card reader: the Square POS app on the same phone or tablet. The register
// opens the app with the amount (packages/core/src/squarePos.ts builds the link), the customer pays
// there with the Square Reader, and Square sends the browser back with a transaction id. Before the
// register counts it as paid, confirm() asks Square's Orders API about that transaction: a paid
// card payment, exactly this amount, at our location, taken after the hand-off started. Refunds go
// through Square's Refunds API. The access token stays on the server.
import { randomUUID } from "node:crypto";
import { AppError, formatMoney } from "@bearded/core";
import { handoffRef, type ConfirmedCard, type PaymentTerminal, type TerminalCharge } from "@bearded/api";
import { SquareApiError, type SquareApiStore } from "./live.ts";

interface Money {
  amount?: number;
  currency?: string;
}
interface Tender {
  id?: string;
  type?: string;
  amount_money?: Money;
  tip_money?: Money;
  card_details?: { status?: string };
}
export interface PosOrder {
  id: string;
  location_id?: string;
  state?: string;
  created_at?: string;
  tenders?: Tender[];
}

export interface SquarePosOptions {
  api: SquareApiStore;
  /** The Square app's application id: public, shown in Square's Developer Dashboard. */
  applicationId: string;
  /** The register's return page, e.g. https://bbg-live.prismcortex.net/register/square-return. */
  callbackUrl: string;
  currency?: string;
  /** Waits between looks while Square catches up with a brand-new payment (tests pass 0). */
  retryMs?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Why a Square order isn't the card payment we're waiting for, or null when it is. Tips added in
 * the Square app are on top of the amount, so they're left out of the check.
 */
export function orderProblem(
  order: PosOrder,
  expect: { amountCents: number; locationId: string; since: Date },
): string | null {
  if (order.location_id !== expect.locationId) return "That Square payment was taken at another location.";
  if (order.created_at && Date.parse(order.created_at) < expect.since.getTime())
    return "That Square payment is older than this sale.";
  const cards = (order.tenders ?? []).filter((t) => t.type === "CARD");
  if (cards.length === 0) return "Square shows no card payment on that transaction.";
  if (cards.length > 1 || (order.tenders ?? []).length > 1)
    return "Square shows that transaction split over several payments. Refund it in the Square app and charge again.";
  const card = cards[0]!;
  if (card.card_details?.status && card.card_details.status !== "CAPTURED")
    return "Square hasn't finished that card payment.";
  const paid = (card.amount_money?.amount ?? 0) - (card.tip_money?.amount ?? 0);
  if (paid !== expect.amountCents)
    return `Square took ${formatMoney(paid)}, not ${formatMoney(expect.amountCents)}. Refund it in the Square app and charge again.`;
  if (!card.id) return "Square didn't give that card payment an id.";
  return null;
}

// No constructor parameter properties: the store's code runs on Node's type stripping too.
export class SquarePosTerminal implements PaymentTerminal {
  readonly name = "Square POS app";
  readonly kind = "square-pos";
  private readonly opts: SquarePosOptions;

  constructor(opts: SquarePosOptions) {
    if (!opts.applicationId) throw new Error("The Square POS hand-off needs the Square application id.");
    this.opts = opts;
  }

  async charge(amountCents: number, _saleId: string, note: string): Promise<TerminalCharge> {
    const state = handoffRef();
    return {
      providerRef: state,
      handoff: {
        applicationId: this.opts.applicationId,
        callbackUrl: this.opts.callbackUrl,
        state,
        amountCents,
        currency: this.opts.currency ?? "USD",
        note,
      },
    };
  }

  /** Square's order for a transaction id, waiting a little for a brand-new one to show up. */
  private async order(transactionId: string): Promise<PosOrder | null> {
    const wait = this.opts.retryMs ?? 1500;
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await this.opts.api.call<{ order?: PosOrder }>(
          "GET",
          `/v2/orders/${encodeURIComponent(transactionId)}`,
        );
        if (r.order) return r.order;
      } catch (e) {
        if (!(e instanceof SquareApiError && e.status === 404)) throw e;
      }
      if (attempt >= 2) return null;
      await sleep(wait);
    }
  }

  async confirm(transactionId: string, amountCents: number, since: Date): Promise<ConfirmedCard> {
    if (!/^[A-Za-z0-9_-]{1,192}$/.test(transactionId))
      throw new AppError("invalid", "Square's answer had a transaction id this register can't read.");
    const order = await this.order(transactionId);
    if (!order) throw new AppError("not_found", "Square doesn't know that transaction yet. Tap Find it in Square.");
    const problem = orderProblem(order, { amountCents, locationId: await this.opts.api.locationId(), since });
    if (problem) throw new AppError("invalid", problem);
    return { paymentRef: order.tenders!.find((t) => t.type === "CARD")!.id! };
  }

  async find(amountCents: number, since: Date): Promise<string[]> {
    const locationId = await this.opts.api.locationId();
    const r = await this.opts.api.call<{ orders?: PosOrder[] }>("POST", "/v2/orders/search", {
      location_ids: [locationId],
      query: {
        filter: {
          date_time_filter: { created_at: { start_at: since.toISOString() } },
          state_filter: { states: ["COMPLETED"] },
        },
        sort: { sort_field: "CREATED_AT", sort_order: "DESC" },
      },
      limit: 50,
    });
    return (r.orders ?? [])
      .filter((o) => orderProblem(o, { amountCents, locationId, since }) === null)
      .map((o) => o.id);
  }

  async refund(paymentRef: string, amountCents: number): Promise<{ refundRef: string }> {
    try {
      const r = await this.opts.api.call<{ refund?: { id?: string } }>("POST", "/v2/refunds", {
        idempotency_key: randomUUID(),
        payment_id: paymentRef,
        amount_money: { amount: amountCents, currency: this.opts.currency ?? "USD" },
        reason: "Refund from the register",
      });
      if (!r.refund?.id) throw new Error("Square answered without a refund id.");
      return { refundRef: r.refund.id };
    } catch (e) {
      console.error("square refund failed", e);
      // Nothing is saved when this throws: the refund is all or nothing.
      throw new AppError(
        "invalid",
        "Square didn't take the refund, so nothing was refunded. Try again, or refund it in the Square app.",
      );
    }
  }
}
