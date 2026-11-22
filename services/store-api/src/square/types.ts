import type { SquareCatalog } from "@bearded/store-core";

export type SquareMode = "offline" | "sandbox" | "live";

/** A finished sale rung in the Square app, with the customer the cashier added to it there. */
export interface SquareAppSale {
  orderId: string;
  /** Square's payment (tender) ids: the register keeps these for its own card sales. */
  paymentIds: string[];
  /** Notes on its payments: the register's hand-offs say "Receipt #12". */
  notes: string[];
  /** What was paid before tax and tips, after discounts, in cents. */
  netCents: number;
  /** The customer on the sale, or null when none was added. */
  customer: { email: string | null; phone: string | null } | null;
}

/** Everything the store asks of Square. Offline, SnapshotStore answers from a saved catalog. */
export interface SquareStore {
  readonly mode: SquareMode;
  catalog(): Promise<SquareCatalog>;
  /** Creates Square's payment page for an order we've already priced. */
  createPaymentLink(order: {
    id: string;
    lines: { productId: string; qty: number }[];
    redirectUrl: string;
    /** The Beard Bucks reward, as one discount on the whole order (0 when none). */
    discountCents?: number;
    /** A signed-in shopper's email, filled in on Square's page for them. */
    buyerEmail?: string;
    /** The catalog's currency, for the discount. */
    currency?: string;
  }): Promise<{ url: string; squareOrderId: string | null; paymentLinkId: string | null }>;
  /** Whether Square's order for a checkout has been paid. */
  orderPaid(squareOrderId: string): Promise<boolean>;
  /** Adds the email to Square Customers (no-op when it's already there). */
  upsertCustomer(email: string): Promise<void>;
  /** True when this email paid for a Square order: shown as "Bought from us" on reviews. */
  hasPaidOrder(email: string): Promise<boolean>;
  /**
   * A completed sale at our location, for Beard Bucks on sales rung only in the Square app. Null
   * when Square has no such order, it isn't finished, or it was taken at another location.
   */
  appSale?(squareOrderId: string): Promise<SquareAppSale | null>;
  /** Which Square shop and location this is, so staff can see the store is on the right account. */
  account?(): Promise<{ merchant: string; location: string }>;
}
