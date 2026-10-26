// What the store's /api endpoints take and return. Shared by the site and the store server.
import type { LedgerKind } from "@bearded/core/loyalty";
import type { CartLine } from "./cart.ts";
import type { Review } from "./reviews.ts";

export interface CheckoutRequest {
  lines: CartLine[];
  visitorId?: string;
  /** Beard Bucks rewards to use: 100 Bucks = $5 off each. Signed-in shoppers only. */
  rewards?: number;
}

export interface CheckoutResponse {
  /** Where to send the shopper: Square's payment page, or the preview page when offline. */
  url: string;
  orderId: string;
}

export interface OrderLine {
  productId: string;
  name: string;
  qty: number;
  priceCents: number;
}

/** What the thank-you page may know about an order: no lines, no amounts. */
export interface OrderStatus {
  status: "open" | "paid" | "cancelled";
  /** Once paid, for a signed-in shopper's order: what the order did to their Beard Bucks. */
  bucks?: OrderBucks;
}

export interface OrderBucks {
  earned: number;
  used: number;
  birthday: number;
  /** Only when the shopper who placed it is the one asking. */
  balance?: number;
}

export interface OrderView {
  id: string;
  status: "open" | "paid" | "cancelled";
  lines: OrderLine[];
  subtotalCents: number;
  /** The Beard Bucks reward taken off, in cents (0 when none). */
  discountCents: number;
}

/** A review as staff see it: with the reviewer's email and its status. */
export interface StaffReview extends Review {
  email: string;
  status: "pending" | "approved" | "hidden";
  createdAt: string;
}

export type ReviewAction = "approve" | "hide" | "feature" | "unfeature";

export interface StaffMe {
  email: string;
}

export interface CodeResponse {
  sent: true;
  /** Offline only: the code, since no email is sent. */
  devCode?: string;
}

export interface Count {
  label: string;
  count: number;
}

export interface LeftCart {
  visitorId: string;
  lastActivity: string;
  items: { name: string; qty: number }[];
  /** "cart": never started checkout. "checkout": opened Square's page and didn't pay. */
  stoppedAt: "cart" | "checkout";
}

export interface StoreStats {
  days: number;
  visitors: number;
  pageViews: number;
  cartAdds: number;
  checkoutsStarted: number;
  ordersPaid: number;
  paidCents: number;
  topPages: Count[];
  topGames: Count[];
  topClicks: Count[];
  sources: Count[];
  addsByProduct: Count[];
  leftCarts: LeftCart[];
  popup: { shown: number; closed: number; joined: number };
  rolls: number;
  vipJoins: number;
  reviewsSent: number;
}

/** Errors come back as { error } with a sentence the site can show as is. */
export interface ApiErrorBody {
  error: string;
}

/** One move of a shopper's Beard Bucks, newest first on the account page. */
export interface LedgerEntry {
  kind: LedgerKind;
  bucks: number;
  at: string;
  /** The web order it belongs to, when there is one. */
  orderId: string | null;
}

/** A signed-in shopper's Beard Buddy account. */
export interface Account {
  email: string;
  name: string | null;
  /** "YYYY-MM-DD", or null when not given. */
  birthday: string | null;
  /** True once the birthday can't be changed again for now (a year after it was set). */
  birthdayLocked: boolean;
  /** What they can spend now: every entry, less Bucks held by open checkouts. */
  balance: number;
  held: number;
  history: LedgerEntry[];
}

export interface AccountUpdate {
  name?: string;
  birthday?: string | null;
}

/** A shopper on the Beard Buddies tab in Behind the Beard. */
export interface StaffBuddy {
  id: string;
  email: string;
  name: string | null;
  balance: number;
  paidOrders: number;
  lastOrderAt: string | null;
  joinedAt: string;
}
