// The register and the store's Square account, kept in step. Square is the home for items, prices
// and stock: a sync reads Square's catalog, counts and customers and brings them into the register
// (the rules are in packages/core/src/squareSync.ts), and adds register customers Square doesn't
// have. Each register stock change is sent to Square's Inventory API soon after it happens
// (sendStockToSquare), retried until Square takes it.
import { createHash } from "node:crypto";
import {
  applySquareSync,
  linkCustomer,
  loadSyncState,
  markStockSends,
  squareSyncStatus,
  waitingStockSends,
  type SquareSyncStatus,
  type SyncSummary,
} from "@bearded/api";
import {
  assertCan,
  planCustomers,
  planProducts,
  squareCustomer,
  type Ctx,
  type CustomerPlan,
  type ProductPlan,
  type SquareCustomer,
  type SquareShelfItem,
} from "@bearded/core";
import { withBusiness } from "@bearded/db";
import type { StoreCtx } from "../context.ts";
import { SquareApiStore, type CatalogObject } from "./live.ts";

const soldAt = (o: CatalogObject, location: string) =>
  !o.is_deleted &&
  (o.present_at_all_locations
    ? !(o.absent_at_location_ids ?? []).includes(location)
    : (o.present_at_location_ids ?? []).includes(location));

/** Square's API when this server talks to a real Square account (live or Sandbox), else null. */
export function squareApi(ctx: StoreCtx): SquareApiStore | null {
  return ctx.square instanceof SquareApiStore ? ctx.square : null;
}

/** Everything Square sells at the store's location, with SKUs, barcodes, costs and counts. */
export async function readSquareShelf(api: SquareApiStore): Promise<SquareShelfItem[]> {
  const locationId = await api.locationId();
  const objects: CatalogObject[] = [];
  let cursor: string | undefined;
  do {
    const q = new URLSearchParams({ types: "ITEM,CATEGORY" });
    if (cursor) q.set("cursor", cursor);
    const page = await api.call<{ objects?: CatalogObject[]; cursor?: string }>(
      "GET",
      `/v2/catalog/list?${q}`,
    );
    objects.push(...(page.objects ?? []));
    cursor = page.cursor;
  } while (cursor);

  const categories = new Map(
    objects
      .filter((o) => o.type === "CATEGORY")
      .map((o) => [o.id, (o as { category_data?: { name?: string } }).category_data?.name ?? null]),
  );
  const items: (SquareShelfItem & { tracks: boolean })[] = [];
  for (const item of objects) {
    if (item.type !== "ITEM" || !item.item_data || !soldAt(item, locationId)) continue;
    const data = item.item_data as NonNullable<CatalogObject["item_data"]> & {
      category_id?: string;
      categories?: { id?: string }[];
      reporting_category?: { id?: string };
    };
    const categoryId = data.reporting_category?.id ?? data.categories?.[0]?.id ?? data.category_id;
    const variations = data.variations ?? [];
    for (const v of variations) {
      const vd = v.item_variation_data as
        | (NonNullable<CatalogObject["item_variation_data"]> & {
            sku?: string;
            upc?: string;
            default_unit_cost?: { amount?: number };
          })
        | undefined;
      if (!vd || !soldAt(v, locationId)) continue;
      const override = vd.location_overrides?.find((l) => l.location_id === locationId);
      const tracks = override?.track_inventory ?? vd.track_inventory ?? false;
      const fixed = vd.pricing_type !== "VARIABLE_PRICING" && Number.isInteger(vd.price_money?.amount);
      const named = variations.length > 1 && vd.name && vd.name.trim().toLowerCase() !== "regular";
      items.push({
        variationId: v.id,
        name: named ? `${data.name ?? ""} (${vd.name!.trim()})` : (data.name ?? ""),
        sku: vd.sku?.trim() || null,
        barcode: vd.upc?.trim() || null,
        priceCents: fixed ? vd.price_money!.amount! : null,
        costCents: Number.isInteger(vd.default_unit_cost?.amount) ? vd.default_unit_cost!.amount! : null,
        category: (categoryId && categories.get(categoryId)) || null,
        tracksStock: tracks,
        stock: null,
        tracks,
      });
    }
  }

  const tracked = items.filter((i) => i.tracks).map((i) => i.variationId);
  const counts = new Map<string, number>();
  for (let i = 0; i < tracked.length; i += 500) {
    let countCursor: string | undefined;
    do {
      const page = await api.call<{
        counts?: { catalog_object_id: string; state: string; quantity?: string }[];
        cursor?: string;
      }>("POST", "/v2/inventory/counts/batch-retrieve", {
        catalog_object_ids: tracked.slice(i, i + 500),
        location_ids: [locationId],
        states: ["IN_STOCK"],
        cursor: countCursor,
      });
      for (const c of page.counts ?? [])
        counts.set(c.catalog_object_id, Math.max(0, Math.floor(Number(c.quantity ?? 0))));
      countCursor = page.cursor;
    } while (countCursor);
  }
  return items.map(({ tracks, ...i }) => ({ ...i, stock: tracks ? (counts.get(i.variationId) ?? 0) : null }));
}

/** Square's customer directory, tidied (phones 10 digits, emails lower case). */
export async function readSquareCustomers(api: SquareApiStore): Promise<SquareCustomer[]> {
  const out: SquareCustomer[] = [];
  let cursor: string | undefined;
  do {
    const q = new URLSearchParams({ limit: "100" });
    if (cursor) q.set("cursor", cursor);
    const page = await api.call<{
      customers?: Parameters<typeof squareCustomer>[0][];
      cursor?: string;
    }>("GET", `/v2/customers?${q}`);
    for (const c of page.customers ?? []) {
      const s = squareCustomer(c);
      if (s) out.push(s);
    }
    cursor = page.cursor;
  } while (cursor);
  return out;
}

/** Adds one register customer to Square. The key makes a retry return the same customer. */
async function addSquareCustomer(
  api: SquareApiStore,
  c: { id: string; name: string; phone: string | null; email: string | null },
): Promise<string> {
  const [given, ...rest] = c.name.trim().split(/\s+/);
  const r = await api.call<{ customer?: { id?: string } }>("POST", "/v2/customers", {
    // Square caps keys at 45 characters.
    idempotency_key: `bbg-pos-${createHash("sha256").update(c.id).digest("hex").slice(0, 36)}`,
    given_name: given,
    ...(rest.length ? { family_name: rest.join(" ") } : {}),
    ...(c.email ? { email_address: c.email } : {}),
    ...(c.phone ? { phone_number: `+1${c.phone}` } : {}),
    note: "Added from the Bearded Board Games register.",
  });
  if (!r.customer?.id) throw new Error("Square answered without a customer id.");
  return r.customer.id;
}

/** What a sync would do, for the Settings screen's preview. */
export interface SyncPreview {
  newProducts: { name: string; priceCents: number; stock: number | null }[];
  priceChanges: { name: string; fromCents: number; toCents: number }[];
  stockChanges: { name: string; from: number; to: number }[];
  linkedProducts: number;
  unchangedProducts: number;
  skipped: { name: string; reason: string }[];
  onlyInRegister: string[];
  newCustomers: number;
  linkedCustomers: number;
  customersToSquare: number;
  duplicateCustomers: number;
}

function preview(
  state: Awaited<ReturnType<typeof loadSyncState>>,
  p: ProductPlan,
  c: CustomerPlan,
): SyncPreview {
  const byId = new Map(state.shelf.map((s) => [s.id, s]));
  return {
    newProducts: p.create.map((n) => ({
      name: n.item.name,
      priceCents: n.item.priceCents!,
      stock: n.item.stock,
    })),
    priceChanges: p.update
      .filter((u) => u.changes.priceCents !== undefined)
      .map((u) => ({
        name: u.item.name,
        fromCents: byId.get(u.productId)!.priceCents,
        toCents: u.changes.priceCents!,
      })),
    stockChanges: p.update
      .filter((u) => u.stockTo !== null)
      .map((u) => ({ name: u.item.name, from: u.stockFrom, to: u.stockTo! })),
    linkedProducts: p.update.filter((u) => u.match !== "linked").length,
    unchangedProducts: p.unchanged,
    skipped: p.skipped.map((s) => ({ name: s.item.name, reason: s.reason })),
    onlyInRegister: p.onlyInRegister.map((o) => o.name),
    newCustomers: c.create.length,
    linkedCustomers: c.link.length,
    customersToSquare: c.push.length,
    duplicateCustomers: c.duplicates.length,
  };
}

export interface SyncResult {
  preview: SyncPreview;
  /** Present once the changes were made. */
  applied?: SyncSummary & { customersToSquare: number };
}

/**
 * Reads Square and compares it with the register. With `apply`, brings the changes in and adds the
 * register's own customers to Square. Waiting stock changes go to Square first, so the counts
 * compared are current. Owners and managers.
 */
export async function syncRegister(ctx: StoreCtx, staff: Ctx, apply: boolean): Promise<SyncResult> {
  assertCan(staff.role, "products.edit");
  const api = squareApi(ctx);
  if (!api || !ctx.pos) throw new Error("This register isn't connected to a Square account.");
  const pos = ctx.pos;
  await sendStockToSquare(ctx).catch((e: unknown) =>
    console.error("square stock send before sync failed", e),
  );
  const [items, people] = await Promise.all([readSquareShelf(api), readSquareCustomers(api)]);

  const planned = await withBusiness(pos, staff.businessId, async (trx) => {
    const state = await loadSyncState(trx);
    const p = planProducts(items, state.shelf, state.waiting);
    const c = planCustomers(people, state.customers);
    return { state, p, c, applied: apply ? await applySquareSync(trx, staff, p, c) : undefined };
  });
  const result: SyncResult = { preview: preview(planned.state, planned.p, planned.c) };
  if (!planned.applied) return result;

  // Register customers Square doesn't have: added one by one, so one refusal doesn't stop the rest.
  let pushed = 0;
  for (const customer of planned.c.push) {
    try {
      const id = await addSquareCustomer(api, customer);
      await withBusiness(pos, staff.businessId, (trx) => linkCustomer(trx, customer.id, id));
      pushed++;
    } catch (e) {
      console.error(`square: couldn't add register customer ${customer.id}`, e);
    }
  }
  console.log(`square sync: ${JSON.stringify(planned.applied)}, ${pushed} customer(s) added to Square`);
  return { ...result, applied: { ...planned.applied, customersToSquare: pushed } };
}

/**
 * Sends waiting register stock changes to Square's Inventory API, oldest first, in one batch. A
 * failure is counted on each change and tried again next time. Returns how many were sent.
 */
export async function sendStockToSquare(ctx: StoreCtx): Promise<number> {
  const api = squareApi(ctx);
  if (!api || !ctx.pos) return 0;
  const locationId = await api.locationId();
  return withBusiness(ctx.pos, ctx.config.businessId, async (trx) => {
    const sends = await waitingStockSends(trx);
    if (sends.length === 0) return 0;
    const ids = sends.map((s) => s.id);
    try {
      await api.call("POST", "/v2/inventory/changes/batch-create", {
        // The same changes always get the same key, so a retry after a lost answer isn't counted twice.
        idempotency_key: createHash("sha256").update(ids.join(",")).digest("hex").slice(0, 45),
        ignore_unchanged_counts: true,
        changes: sends.map((s) => ({
          type: "ADJUSTMENT",
          adjustment: {
            catalog_object_id: s.squareVariationId,
            location_id: locationId,
            quantity: String(Math.abs(s.qtyChange)),
            // A sale leaves the shelf as sold; anything coming in (received, returned) goes in stock.
            from_state: s.qtyChange < 0 ? "IN_STOCK" : "NONE",
            to_state: s.qtyChange < 0 ? "SOLD" : "IN_STOCK",
            occurred_at: s.createdAt.toISOString(),
          },
        })),
      });
      await markStockSends(trx, ids, null);
      return ids.length;
    } catch (e) {
      console.error("square stock send failed", e);
      await markStockSends(trx, ids, e instanceof Error ? e.message : String(e));
      return 0;
    }
  });
}

/** For the Settings screen: when Square was last synced and what's waiting to send. */
export async function syncStatus(
  ctx: StoreCtx,
  staff: Ctx,
): Promise<SquareSyncStatus & { connected: boolean }> {
  if (!ctx.pos) throw new Error("The register isn't on this server.");
  const status = await withBusiness(ctx.pos, staff.businessId, squareSyncStatus);
  return { ...status, connected: squareApi(ctx) !== null };
}
