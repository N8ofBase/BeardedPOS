// Reverses an import batch, newest change first: deletes rows it created, puts back
// fields it changed (unless someone has changed them since), re-adds punch rows it
// replaced, and reverses stock it moved with a new move.
import { sql, type Transaction } from "kysely";
import { AppError, type Ctx } from "@pet-pos/core";
import type { DB, ImportEntity } from "@pet-pos/db";
import { audit, currentLocationId } from "../shared.ts";
import { sameValue } from "./base.ts";

const TABLE: Record<Exclude<ImportEntity, "stock">, string> = {
  customer: "customers",
  pet: "pets",
  vaccination: "vaccinations",
  product: "products",
  program: "astro_programs",
  punch: "astro_punches",
  sale: "sales",
};

const NOUN: Record<ImportEntity, string> = {
  customer: "Customer",
  pet: "Pet",
  vaccination: "Vaccination",
  product: "Product",
  program: "Program",
  punch: "Punch card",
  stock: "Stock",
  sale: "Order",
};

export interface UndoResult {
  deleted: number;
  restored: number;
  /** Fields changed again after the import, so undo left them alone. */
  kept: string[];
}

async function rowById(trx: Transaction<DB>, table: string, id: string) {
  const { rows } = await sql<
    Record<string, unknown>
  >`SELECT * FROM ${sql.table(table)} WHERE id = ${id}`.execute(trx);
  return rows[0];
}

export async function undoBatch(trx: Transaction<DB>, ctx: Ctx, batchId: string): Promise<UndoResult> {
  const batch = await trx
    .selectFrom("import_batches")
    .selectAll()
    .where("id", "=", batchId)
    .executeTakeFirst();
  if (!batch) throw new AppError("not_found", "That import doesn't exist.");
  if (batch.status === "undone") throw new AppError("conflict", "This import was already undone.");

  const changes = await trx
    .selectFrom("import_changes")
    .selectAll()
    .where("batch_id", "=", batchId)
    .orderBy("seq", "desc")
    .execute();

  const result: UndoResult = { deleted: 0, restored: 0, kept: [] };
  for (const c of changes) {
    if (c.entity === "stock") {
      const qty = Number((c.after as { qty?: number } | null)?.qty ?? 0);
      const exists = await trx
        .selectFrom("products")
        .select("id")
        .where("id", "=", c.entity_id)
        .executeTakeFirst();
      if (exists && qty !== 0) {
        await trx
          .insertInto("inventory_moves")
          .values({
            business_id: ctx.businessId,
            product_id: c.entity_id,
            location_id: await currentLocationId(trx),
            qty_change: -qty,
            reason: "adjust",
            staff_id: ctx.staffId,
            note: "Undo import",
          })
          .execute();
        result.restored++;
      }
      continue;
    }

    const table = TABLE[c.entity];
    const current = await rowById(trx, table, c.entity_id);
    const label = `${NOUN[c.entity]}${current?.name ? ` "${String(current.name)}"` : ""}`;

    if (c.op === "created") {
      if (!current) continue;
      if (c.entity === "sale") {
        // The app role can't delete sales; this function deletes imported orders only.
        await sql`SELECT delete_imported_sale(${c.entity_id})`.execute(trx);
        result.deleted++;
        continue;
      }
      if (c.entity === "customer") {
        const pets = await trx
          .selectFrom("pets")
          .select("id")
          .where("customer_id", "=", c.entity_id)
          .execute();
        await audit(trx, ctx, {
          action: "customer.delete",
          entity: "customer",
          entityId: c.entity_id,
          before: { name: current.name, pets: pets.length, via: "import undo" },
        });
      }
      await sql`DELETE FROM ${sql.table(table)} WHERE id = ${c.entity_id}`.execute(trx);
      result.deleted++;
    } else if (c.op === "updated") {
      if (!current) {
        result.kept.push(`${NOUN[c.entity]} changed by this import was deleted since`);
        continue;
      }
      const before = c.before ?? {};
      const restore: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(c.after ?? {})) {
        if (sameValue(current[k], v)) restore[k] = before[k] ?? null;
        else result.kept.push(`${label}: ${k.replace(/_/g, " ")} was changed after the import, kept`);
      }
      if (!Object.keys(restore).length) continue;
      const sets = Object.entries(restore).map(([k, v]) => sql`${sql.ref(k)} = ${v}`);
      await sql`UPDATE ${sql.table(table)} SET ${sql.join(sets)} WHERE id = ${c.entity_id}`.execute(trx);
      result.restored++;
      if (
        c.entity === "product" &&
        ("price_cents" in restore || "cost_cents" in restore || "wholesale_cents" in restore)
      ) {
        await audit(trx, ctx, {
          action: "product.price_change",
          entity: "product",
          entityId: c.entity_id,
          before: {
            price_cents: current.price_cents,
            cost_cents: current.cost_cents,
            wholesale_cents: current.wholesale_cents,
          },
          after: {
            price_cents: restore.price_cents ?? current.price_cents,
            cost_cents: restore.cost_cents ?? current.cost_cents,
            // A wholesale price can be restored to blank, so null here is a real value.
            wholesale_cents: "wholesale_cents" in restore ? restore.wholesale_cents : current.wholesale_cents,
            via: "import undo",
          },
        });
      }
    } else if (c.op === "deleted" && c.before && !current) {
      const entries = Object.entries(c.before);
      await sql`INSERT INTO ${sql.table(table)} (${sql.join(entries.map(([k]) => sql.ref(k)))})
        VALUES (${sql.join(entries.map(([, v]) => v))})`.execute(trx);
      result.restored++;
    }
  }

  await trx
    .updateTable("import_batches")
    .set({ status: "undone", undone_at: new Date() })
    .where("id", "=", batchId)
    .execute();
  await audit(trx, ctx, {
    action: "import.undo",
    entity: "import_batch",
    entityId: batchId,
    after: { deleted: result.deleted, restored: result.restored, kept: result.kept.length },
  });
  return result;
}
