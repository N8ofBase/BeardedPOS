// Copies the store's items from the saved Prism Cortex catalog into the Square Sandbox, so checkout
// can be tried with Square's test cards. Sandbox only, items the store sells only, and items the
// Sandbox already has (by name) are left alone, so running it twice adds nothing.
import { randomUUID } from "node:crypto";
import { extraItems, gameItems, matchKey, type SquareCatalog, type SquareItem } from "@bearded/store-core";
import type { SquareApiStore } from "./live.ts";

export interface SeedItem {
  name: string;
  productType: string;
  variations: { name: string; priceCents: number; stock: number | null }[];
}

export interface SeedPlan {
  add: SeedItem[];
  /** Store items the Sandbox already has. */
  skip: string[];
}

const listed = new Set([...gameItems.flatMap((g) => g.items), ...extraItems].map((i) => matchKey(i.square)));

/** What to add: listed items with a fixed price, grouped by Square item, minus what the Sandbox has. */
export function planSeed(saved: SquareCatalog, sandbox: SquareCatalog): SeedPlan {
  const have = new Set(sandbox.items.map((i) => matchKey(i.name)));
  const byItem = new Map<string, SquareItem[]>();
  for (const i of saved.items) {
    if (!listed.has(matchKey(i.name)) || i.priceCents === null) continue;
    byItem.set(i.itemId, [...(byItem.get(i.itemId) ?? []), i]);
  }
  const plan: SeedPlan = { add: [], skip: [] };
  for (const variations of byItem.values()) {
    const first = variations[0]!;
    if (have.has(matchKey(first.name))) {
      plan.skip.push(first.name);
      continue;
    }
    plan.add.push({
      name: first.name,
      productType: first.productType,
      variations: variations.map((v) => ({
        name: v.variationName ?? "Regular",
        priceCents: v.priceCents!,
        stock: v.tracksStock ? (v.stock ?? 0) : null,
      })),
    });
  }
  return plan;
}

/** Creates the planned items in the Sandbox and sets their stock. Returns how many variations were added. */
export async function applySeed(square: SquareApiStore, plan: SeedPlan, currency: string): Promise<number> {
  if (square.mode !== "sandbox") throw new Error("The seed only writes to the Square Sandbox.");
  if (plan.add.length === 0) return 0;
  const locationId = await square.locationId();
  const stock = new Map<string, number>();
  const objects = plan.add.map((item, i) => ({
    type: "ITEM",
    id: `#item-${i}`,
    present_at_all_locations: true,
    item_data: {
      name: item.name,
      product_type: item.productType === "DIGITAL" ? "DIGITAL" : "REGULAR",
      variations: item.variations.map((v, j) => {
        const id = `#var-${i}-${j}`;
        if (v.stock !== null) stock.set(id, v.stock);
        return {
          type: "ITEM_VARIATION",
          id,
          present_at_all_locations: true,
          item_variation_data: {
            name: v.name,
            pricing_type: "FIXED_PRICING",
            price_money: { amount: v.priceCents, currency },
            track_inventory: v.stock !== null,
          },
        };
      }),
    },
  }));
  const upserted = await square.call<{ id_mappings?: { client_object_id: string; object_id: string }[] }>(
    "POST",
    "/v2/catalog/batch-upsert",
    { idempotency_key: randomUUID(), batches: [{ objects }] },
  );
  const ids = new Map((upserted.id_mappings ?? []).map((m) => [m.client_object_id, m.object_id]));
  const at = new Date().toISOString();
  const changes = [...stock].map(([tempId, quantity]) => ({
    type: "PHYSICAL_COUNT",
    physical_count: {
      catalog_object_id: ids.get(tempId),
      location_id: locationId,
      state: "IN_STOCK",
      quantity: String(quantity),
      occurred_at: at,
    },
  }));
  for (let i = 0; i < changes.length; i += 100)
    await square.call("POST", "/v2/inventory/changes/batch-create", {
      idempotency_key: randomUUID(),
      changes: changes.slice(i, i + 100),
    });
  return objects.reduce((n, o) => n + o.item_data.variations.length, 0);
}
