import { sql, type Transaction } from "kysely";
import { AppError, cleanProduct, isUniqueViolation, validateProduct, type ProductInput } from "@pet-pos/core";
import type { DB, MoveReason, TaxClass } from "@pet-pos/db";
import { defineHandler } from "../handler.ts";
import { audit, currentLocationId, likePattern, requireInt } from "../shared.ts";

export interface ProductRow {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  brand: string | null;
  category: string;
  priceCents: number;
  costCents: number;
  taxClass: TaxClass;
  reorderAt: number;
  onHand: number;
  astroProgramId: string | null;
  astroProgramName: string | null;
  offerLabel: string | null;
  offerCents: number | null;
  active: boolean;
}

export interface MoveRow {
  id: string;
  qtyChange: number;
  reason: MoveReason;
  note: string | null;
  staffName: string | null;
  createdAt: Date;
}

// Shared select for product rows with stock and program name.
function productQuery(trx: Transaction<DB>) {
  return trx
    .selectFrom("products as p")
    .leftJoin("inventory_levels as l", "l.product_id", "p.id")
    .leftJoin("astro_programs as a", "a.id", "p.astro_program_id")
    .select((eb) => [
      "p.id",
      "p.sku",
      "p.barcode",
      "p.name",
      "p.brand",
      "p.category",
      "p.price_cents as priceCents",
      "p.cost_cents as costCents",
      "p.tax_class as taxClass",
      "p.reorder_at as reorderAt",
      eb.fn.coalesce("l.on_hand", sql<number>`0`).as("onHand"),
      "p.astro_program_id as astroProgramId",
      "a.name as astroProgramName",
      "p.astro_offer_label as offerLabel",
      "p.astro_offer_cents as offerCents",
      "p.active",
    ]);
}

export interface ListProductsInput {
  q?: string;
  lowOnly?: boolean;
  category?: string;
  includeArchived?: boolean;
}

/** Inventory list: low stock first, then by name, as in the prototype. */
export const listProducts = defineHandler<ListProductsInput, ProductRow[]>({
  action: "products.view",
  async run(trx, _ctx, input = {}) {
    let q = productQuery(trx);
    if (!input.includeArchived) q = q.where("p.active", "=", true);
    if (input.category) q = q.where("p.category", "=", input.category);
    const text = input.q?.trim();
    if (text) {
      const pat = likePattern(text);
      q = q.where((eb) =>
        eb.or([
          eb("p.sku", "ilike", pat),
          eb("p.barcode", "ilike", pat),
          eb("p.name", "ilike", pat),
          eb("p.brand", "ilike", pat),
          eb("p.category", "ilike", pat),
        ]),
      );
    }
    if (input.lowOnly) q = q.where(sql<boolean>`coalesce(l.on_hand, 0) <= p.reorder_at`);
    return q
      .orderBy(sql`coalesce(l.on_hand, 0) <= p.reorder_at`, "desc")
      .orderBy("p.name")
      .limit(500)
      .execute();
  },
});

/** Scan lookup: SKU in any case, or exact barcode. Active products only. */
export const findByCode = defineHandler<{ code: string }, ProductRow | null>({
  action: "products.view",
  async run(trx, _ctx, { code }) {
    const c = code.trim();
    if (!c) return null;
    const row = await productQuery(trx)
      .where("p.active", "=", true)
      .where((eb) => eb.or([eb(eb.fn("lower", ["p.sku"]), "=", c.toLowerCase()), eb("p.barcode", "=", c)]))
      .executeTakeFirst();
    return row ?? null;
  },
});

export const getProduct = defineHandler<{ id: string }, { product: ProductRow; moves: MoveRow[] }>({
  action: "products.view",
  async run(trx, _ctx, { id }) {
    const product = await productQuery(trx).where("p.id", "=", id).executeTakeFirst();
    if (!product) throw new AppError("not_found", "That product doesn't exist.");
    const moves = await trx
      .selectFrom("inventory_moves as m")
      .leftJoin("staff as s", "s.id", "m.staff_id")
      .select([
        "m.id",
        "m.qty_change as qtyChange",
        "m.reason",
        "m.note",
        "s.name as staffName",
        "m.created_at as createdAt",
      ])
      .where("m.product_id", "=", id)
      .orderBy("m.created_at", "desc")
      .limit(20)
      .execute();
    return { product, moves };
  },
});

export interface SaveProductInput extends ProductInput {
  id?: string;
  /** New products only: stock already on the shelf. Recorded as an "Opening count" move. */
  openingOnHand?: number;
}

/** Create or update a product. A price or cost change is written to the audit log. */
export const saveProduct = defineHandler<SaveProductInput, { id: string }>({
  action: "products.edit",
  async run(trx, ctx, input) {
    const p = cleanProduct(input);
    const errors = validateProduct(p);
    const first = Object.values(errors)[0];
    if (first) throw new AppError("invalid", first, errors as Record<string, string>);

    const values = {
      sku: p.sku,
      barcode: p.barcode,
      name: p.name,
      brand: p.brand,
      category: p.category,
      price_cents: p.priceCents,
      cost_cents: p.costCents,
      tax_class: p.taxClass,
      reorder_at: p.reorderAt,
      astro_program_id: p.astroProgramId,
      astro_offer_label: p.offerLabel,
      astro_offer_cents: p.offerCents,
    };

    try {
      if (!input.id) {
        const row = await trx
          .insertInto("products")
          .values({ ...values, business_id: ctx.businessId })
          .returning("id")
          .executeTakeFirstOrThrow();
        const opening = input.openingOnHand ?? 0;
        requireInt(opening, "On hand", { min: 0, max: 1_000_000 });
        if (opening > 0) {
          await trx
            .insertInto("inventory_moves")
            .values({
              business_id: ctx.businessId,
              product_id: row.id,
              location_id: await currentLocationId(trx),
              qty_change: opening,
              reason: "adjust",
              staff_id: ctx.staffId,
              note: "Opening count",
            })
            .execute();
        }
        return { id: row.id };
      }

      const before = await trx
        .selectFrom("products")
        .select(["price_cents", "cost_cents"])
        .where("id", "=", input.id)
        .executeTakeFirst();
      if (!before) throw new AppError("not_found", "That product doesn't exist.");
      await trx.updateTable("products").set(values).where("id", "=", input.id).execute();

      if (before.price_cents !== p.priceCents || before.cost_cents !== p.costCents) {
        await audit(trx, ctx, {
          action: "product.price_change",
          entity: "product",
          entityId: input.id,
          before: { price_cents: before.price_cents, cost_cents: before.cost_cents },
          after: { price_cents: p.priceCents, cost_cents: p.costCents },
        });
      }
      return { id: input.id };
    } catch (err) {
      if (isUniqueViolation(err, "products_sku_per_business"))
        throw new AppError("conflict", "That SKU already exists.", { sku: "That SKU already exists." });
      if (isUniqueViolation(err, "products_barcode_per_business"))
        throw new AppError("conflict", "Another product already has that barcode.", {
          barcode: "Another product already has that barcode.",
        });
      if ((err as { code?: string }).code === "23503")
        throw new AppError("invalid", "That Astro program doesn't exist anymore. Pick another.");
      throw err;
    }
  },
});

/** Hides a product from the list (or brings it back). Products are never deleted: their history stays. */
export const archiveProduct = defineHandler<{ id: string; archived: boolean }, void>({
  action: "products.edit",
  async run(trx, _ctx, { id, archived }) {
    const res = await trx
      .updateTable("products")
      .set({ active: !archived })
      .where("id", "=", id)
      .executeTakeFirst();
    if (res.numUpdatedRows === 0n) throw new AppError("not_found", "That product doesn't exist.");
  },
});

async function onHandOf(trx: Transaction<DB>, productId: string): Promise<number> {
  const row = await trx
    .selectFrom("inventory_levels")
    .select("on_hand")
    .where("product_id", "=", productId)
    .executeTakeFirst();
  return row?.on_hand ?? 0;
}

export const receiveStock = defineHandler<
  { productId: string; qty: number; note?: string },
  { onHand: number }
>({
  action: "inventory.adjust",
  async run(trx, ctx, { productId, qty, note }) {
    requireInt(qty, "Quantity received", { min: 1, max: 100_000 });
    const exists = await trx
      .selectFrom("products")
      .select("id")
      .where("id", "=", productId)
      .executeTakeFirst();
    if (!exists) throw new AppError("not_found", "That product doesn't exist.");
    await trx
      .insertInto("inventory_moves")
      .values({
        business_id: ctx.businessId,
        product_id: productId,
        location_id: await currentLocationId(trx),
        qty_change: qty,
        reason: "receive",
        staff_id: ctx.staffId,
        note: note?.trim() || null,
      })
      .execute();
    return { onHand: await onHandOf(trx, productId) };
  },
});

export interface CountLine {
  productId: string;
  counted: number;
}

export interface CountResult {
  counted: number;
  changed: { productId: string; before: number; after: number }[];
}

/** Count mode: writes an adjustment for each difference; lines that already match change nothing. */
export const saveCounts = defineHandler<{ lines: CountLine[] }, CountResult>({
  action: "inventory.adjust",
  async run(trx, ctx, { lines }) {
    if (!lines.length) throw new AppError("invalid", "Scan at least one item before saving.");
    if (lines.length > 1000) throw new AppError("invalid", "Save counts in batches of up to 1,000 items.");
    const ids = new Set<string>();
    for (const l of lines) {
      requireInt(l.counted, "Count", { min: 0, max: 1_000_000 });
      if (ids.has(l.productId)) throw new AppError("invalid", "The same item is in the count twice.");
      ids.add(l.productId);
    }
    const locationId = await currentLocationId(trx);
    const changed: CountResult["changed"] = [];
    for (const l of lines) {
      const exists = await trx
        .selectFrom("products")
        .select("id")
        .where("id", "=", l.productId)
        .executeTakeFirst();
      if (!exists) throw new AppError("not_found", "An item in the count doesn't exist anymore.");
      const before = await onHandOf(trx, l.productId);
      const diff = l.counted - before;
      if (diff === 0) continue;
      await trx
        .insertInto("inventory_moves")
        .values({
          business_id: ctx.businessId,
          product_id: l.productId,
          location_id: locationId,
          qty_change: diff,
          reason: "adjust",
          staff_id: ctx.staffId,
          note: "Count",
        })
        .execute();
      changed.push({ productId: l.productId, before, after: l.counted });
    }
    return { counted: lines.length, changed };
  },
});
