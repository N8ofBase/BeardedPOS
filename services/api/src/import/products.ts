import { sql } from "kysely";
import { parseCount, parseMoney, parseTaxPercent } from "@bearded/core";
import { audit, currentLocationId } from "../shared.ts";
import { diff, Skip, text, type Row, type RowCtx, type RowResult } from "./base.ts";

function count(rc: RowCtx, raw: string | undefined, what: string): number | undefined {
  if (raw === undefined) return undefined;
  const n = parseCount(raw);
  if (n === undefined) rc.warn(`${what} "${raw}" isn't a whole number, left as it was`);
  return n ?? undefined;
}

/** Products file: matched on SKU (any case), then barcode. On hand becomes a stock move. */
export async function productRow(r: Row, rc: RowCtx): Promise<RowResult> {
  const sku = text(r.sku);
  const barcode = text(r.barcode);
  if (!sku && !barcode) throw new Skip("Needs a SKU or barcode");

  let existing = sku
    ? await rc.trx
        .selectFrom("products")
        .selectAll()
        .where(sql`lower(sku)`, "=", sku.toLowerCase())
        .executeTakeFirst()
    : undefined;
  let matchedByBarcode = false;
  if (!existing && barcode) {
    existing = await rc.trx
      .selectFrom("products")
      .selectAll()
      .where("barcode", "=", barcode)
      .executeTakeFirst();
    matchedByBarcode = !!existing;
  }
  const name = text(r.name);
  if (!existing && (!sku || !name)) throw new Skip("Needs both SKU and name");
  // A distributor file can list our product under its own item code: keep our SKU.
  if (matchedByBarcode && sku && existing && sku.toLowerCase() !== existing.sku.toLowerCase())
    rc.warn(`Matched by barcode to SKU ${existing.sku}; SKU left as it was`);

  const values: Record<string, unknown> = {
    sku: matchedByBarcode ? undefined : sku,
    barcode: barcode,
    name,
    brand: text(r.brand),
    category: text(r.category),
    reorder_at: count(rc, r.reorderAt, "Reorder at"),
  };
  if (text(r.price)) {
    const price = parseMoney(r.price!);
    if (price === null) throw new Skip("Price isn't an amount like 12.99");
    values.price_cents = price;
  } else if (!existing) throw new Skip("New products need a price");
  if (text(r.cost)) {
    const cost = parseMoney(r.cost!);
    if (cost === null) rc.warn(`Cost "${r.cost}" isn't an amount, left as it was`);
    else values.cost_cents = cost;
  }
  if (text(r.wholesale)) {
    const wholesale = parseMoney(r.wholesale!);
    if (wholesale === null) rc.warn(`Wholesale price "${r.wholesale}" isn't an amount, left as it was`);
    else values.wholesale_cents = wholesale;
  }
  if (text(r.royalty)) {
    // Royalty rates use the same thousandths-of-a-percent form as tax rates.
    const rate = parseTaxPercent(r.royalty!);
    if (rate === null) rc.warn(`Royalty "${r.royalty}" isn't a percent from 0 to 100, left as it was`);
    else values.royalty_mpct = rate;
  }
  const payee = text(r.royaltyPayee);
  if (payee && payee.length > 100) rc.warn("Royalty payee is over 100 characters, left as it was");
  else if (payee) values.royalty_payee = payee;
  const onHand = count(rc, r.onHand, "On hand");

  let productId: string;
  let action: RowResult["action"];
  if (existing) {
    productId = existing.id;
    action = "update";
    const d = diff(existing, values);
    if (d) {
      await rc.trx.updateTable("products").set(d.after).where("id", "=", existing.id).execute();
      await rc.changes.add("product", existing.id, "updated", d.before, d.after);
      if ("price_cents" in d.after || "cost_cents" in d.after || "wholesale_cents" in d.after) {
        await audit(rc.trx, rc.ctx, {
          action: "product.price_change",
          entity: "product",
          entityId: existing.id,
          before: {
            price_cents: existing.price_cents,
            cost_cents: existing.cost_cents,
            wholesale_cents: existing.wholesale_cents,
          },
          after: {
            price_cents: (d.after.price_cents as number | undefined) ?? existing.price_cents,
            cost_cents: (d.after.cost_cents as number | undefined) ?? existing.cost_cents,
            wholesale_cents: (d.after.wholesale_cents as number | undefined) ?? existing.wholesale_cents,
            via: "import",
          },
        });
      }
    }
  } else {
    const row = { ...Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined)) };
    if (!row.category) row.category = "Other";
    const inserted = await rc.trx
      .insertInto("products")
      .values({
        ...row,
        sku: sku!,
        name: name!,
        price_cents: values.price_cents as number,
        business_id: rc.ctx.businessId,
        import_batch_id: rc.changes.batchId,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    productId = inserted.id;
    action = "new";
    await rc.changes.add("product", productId, "created", null, row);
  }

  if (onHand !== undefined) {
    const level = await rc.trx
      .selectFrom("inventory_levels")
      .select("on_hand")
      .where("product_id", "=", productId)
      .executeTakeFirst();
    const qty = onHand - (level?.on_hand ?? 0);
    if (qty !== 0) {
      await rc.trx
        .insertInto("inventory_moves")
        .values({
          business_id: rc.ctx.businessId,
          product_id: productId,
          location_id: await currentLocationId(rc.trx),
          qty_change: qty,
          reason: "adjust",
          staff_id: rc.ctx.staffId,
          note: action === "new" ? "Opening count (import)" : "Import",
        })
        .execute();
      if (action === "update") await rc.changes.add("stock", productId, "moved", null, { qty });
    }
  }
  return { action, label: name ?? existing!.name };
}
