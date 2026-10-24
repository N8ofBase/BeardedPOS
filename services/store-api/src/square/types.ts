import type { SquareCatalog } from "@bearded/store-core";

export type SquareMode = "offline" | "sandbox" | "live";

/** Everything the store asks of Square. Offline, SnapshotStore answers from a saved catalog. */
export interface SquareStore {
  readonly mode: SquareMode;
  catalog(): Promise<SquareCatalog>;
  /** Creates Square's payment page for an order we've already priced. */
  createPaymentLink(order: {
    id: string;
    lines: { productId: string; qty: number }[];
    redirectUrl: string;
  }): Promise<{ url: string; squareOrderId: string | null; paymentLinkId: string | null }>;
  /** Whether Square's order for a checkout has been paid. */
  orderPaid(squareOrderId: string): Promise<boolean>;
  /** Adds the email to Square Customers (no-op when it's already there). */
  upsertCustomer(email: string): Promise<void>;
  /** True when this email paid for a Square order: shown as "Bought from us" on reviews. */
  hasPaidOrder(email: string): Promise<boolean>;
}
