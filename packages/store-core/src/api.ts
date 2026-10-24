// What the store's /api endpoints take and return. Shared by the site and the store server.
import type { CartLine } from "./cart.ts";
import type { Review } from "./reviews.ts";

export interface CheckoutRequest {
  lines: CartLine[];
  visitorId?: string;
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

export interface OrderView {
  id: string;
  status: "open" | "paid" | "cancelled";
  lines: OrderLine[];
  subtotalCents: number;
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
