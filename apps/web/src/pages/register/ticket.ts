// The ticket being rung up: lines, customer and discounts. Priced in the
// browser with the same priceSale() the server reruns at checkout, and kept in this
// browser so a reload doesn't lose a sale in progress.
import { priceSale, type PricedSale, type TicketLine } from "@pet-pos/core";
import type { DiscountRow, ProductRow, RegisterCustomer, TicketInput } from "@pet-pos/api";

export interface TicketLineState {
  key: string;
  product: ProductRow;
  qty: number;
}

export interface TicketDiscountState {
  discount: DiscountRow;
  lineKey: string | null;
  note: string | null;
  approvedBy: string | null;
  approverName: string | null;
}

export interface Ticket {
  lines: TicketLineState[];
  customer: RegisterCustomer | null;
  discounts: TicketDiscountState[];
}

export const EMPTY_TICKET: Ticket = { lines: [], customer: null, discounts: [] };

/** True when nothing is on the ticket to pay for. */
export function isEmpty(t: Ticket): boolean {
  return !t.lines.length;
}

let seq = 0;
const newKey = () => `${Date.now().toString(36)}-${(seq++).toString(36)}`;

/** Adds one of a product, or one more of a line already on the ticket. */
export function addProduct(t: Ticket, product: ProductRow, qty = 1): Ticket {
  const existing = t.lines.find((l) => l.product.id === product.id);
  if (existing)
    return {
      ...t,
      lines: t.lines.map((l) => (l === existing ? { ...l, qty: Math.min(9999, l.qty + qty), product } : l)),
    };
  return { ...t, lines: [...t.lines, { key: newKey(), product, qty }] };
}

export function setQty(t: Ticket, key: string, qty: number): Ticket {
  if (qty <= 0) {
    return {
      ...t,
      lines: t.lines.filter((l) => l.key !== key),
      discounts: t.discounts.filter((d) => d.lineKey !== key),
    };
  }
  return { ...t, lines: t.lines.map((l) => (l.key === key ? { ...l, qty: Math.min(9999, qty) } : l)) };
}

export function removeDiscount(t: Ticket, index: number): Ticket {
  return { ...t, discounts: t.discounts.filter((_, i) => i !== index) };
}

/** What the server needs: ids and choices, never prices. */
export function toInput(t: Ticket): TicketInput {
  return {
    customerId: t.customer?.card.id ?? null,
    lines: t.lines.map((l) => ({
      key: l.key,
      productId: l.product.id,
      qty: l.qty,
    })),
    discounts: t.discounts.map((d) => ({
      discountId: d.discount.id,
      lineKey: d.lineKey,
      note: d.note ?? undefined,
      approvedBy: d.approvedBy,
    })),
  };
}

function ticketLines(t: Ticket): TicketLine[] {
  return t.lines.map((l): TicketLine => ({
    key: l.key,
    productId: l.product.id,
    name: l.product.name,
    unitPriceCents: l.product.priceCents,
    qty: l.qty,
    taxClass: l.product.taxClass,
  }));
}

export interface TicketPrice {
  priced: PricedSale | null;
  /** Why the ticket can't be priced as it stands (e.g. two discounts that don't combine). */
  problem: string | null;
}

/** Prices the ticket for the screen. */
export function priceTicket(t: Ticket, taxRateMpct: number): TicketPrice {
  try {
    const priced = priceSale({
      lines: ticketLines(t),
      storeDiscounts: t.discounts.map((d) => ({
        rule: d.discount,
        lineKey: d.discount.scope === "line" ? d.lineKey : null,
      })),
      taxRateMpct,
    });
    return { priced, problem: null };
  } catch (err) {
    return { priced: null, problem: err instanceof Error ? err.message : "This ticket can't be priced." };
  }
}

const KEY = (staffId: string) => `petpos.ticket.${staffId}`;

export function loadTicket(staffId: string): Ticket {
  try {
    const raw = localStorage.getItem(KEY(staffId));
    if (!raw) return EMPTY_TICKET;
    const t = JSON.parse(raw) as Ticket;
    return Array.isArray(t.lines) ? { ...EMPTY_TICKET, ...t } : EMPTY_TICKET;
  } catch {
    return EMPTY_TICKET;
  }
}

export function saveTicket(staffId: string, t: Ticket): void {
  try {
    if (isEmpty(t) && !t.customer && !t.discounts.length) localStorage.removeItem(KEY(staffId));
    else localStorage.setItem(KEY(staffId), JSON.stringify(t));
  } catch {
    // Private mode: the ticket just won't survive a reload.
  }
}
