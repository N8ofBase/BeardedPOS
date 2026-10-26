// Offline Square: the catalog from a saved read-only copy, and checkout through our own preview page.
import type { SquareCatalog } from "@bearded/store-core";
// Imported rather than read from disk, so the Lambda bundle carries it.
import saved from "./snapshot.json" with { type: "json" };
import type { SquareStore } from "./types.ts";

export function loadSnapshot(): SquareCatalog {
  return structuredClone(saved) as SquareCatalog;
}

export class SnapshotStore implements SquareStore {
  readonly mode = "offline" as const;
  private readonly saved: SquareCatalog;

  constructor(catalog: SquareCatalog = loadSnapshot()) {
    this.saved = catalog;
  }

  async catalog() {
    return this.saved;
  }

  async createPaymentLink(order: { id: string }) {
    return { url: `/checkout-preview/${order.id}`, squareOrderId: null, paymentLinkId: null };
  }

  // Offline orders are paid on the preview page, never in Square.
  async orderPaid() {
    return false;
  }

  async upsertCustomer() {}

  async hasPaidOrder() {
    return false;
  }
}
