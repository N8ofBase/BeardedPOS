// Offline Square: the catalog from a saved read-only copy, and checkout through our own preview page.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SquareCatalog } from "@bearded/store-core";
import type { SquareStore } from "./types.ts";

export function loadSnapshot(): SquareCatalog {
  return JSON.parse(
    readFileSync(join(fileURLToPath(import.meta.url), "../snapshot.json"), "utf8"),
  ) as SquareCatalog;
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

  async upsertCustomer() {}

  async hasPaidOrder() {
    return false;
  }
}
