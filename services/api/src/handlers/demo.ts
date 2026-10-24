import { sql, type Transaction } from "kysely";
import type { DB } from "@pet-pos/db";
import { defineHandler } from "../handler.ts";
import { audit } from "../shared.ts";

export interface DemoCounts {
  customers: number;
  products: number;
  programs: number;
  punches: number;
  discounts: number;
}

async function counts(trx: Transaction<DB>): Promise<DemoCounts> {
  const n = async (table: "customers" | "products" | "astro_programs" | "astro_punches") =>
    (
      await trx
        .selectFrom(table)
        .select(sql<number>`count(*)::int`.as("n"))
        .where("is_demo", "=", true)
        .executeTakeFirstOrThrow()
    ).n;
  return {
    customers: await n("customers"),
    products: await n("products"),
    programs: await n("astro_programs"),
    punches: await n("astro_punches"),
    discounts: (
      await trx
        .selectFrom("discounts")
        .select(sql<number>`count(*)::int`.as("n"))
        .where("is_demo", "=", true)
        .where("archived_at", "is", null)
        .executeTakeFirstOrThrow()
    ).n,
  };
}

export const demoDataPreview = defineHandler<void, DemoCounts>({
  action: "demo.remove",
  async run(trx) {
    return counts(trx);
  },
});

/**
 * Deletes the sample records (is_demo) and nothing else. Punches go with their
 * customers; stock history goes with its products. The store,
 * its location and the (DEMO) sign-ins stay: in demo mode they're how you get in.
 * Records the user added are never touched (a product linked to a sample program
 * just loses the link).
 */
export const removeDemoData = defineHandler<void, DemoCounts>({
  action: "demo.remove",
  async run(trx, ctx) {
    const removed = await counts(trx);
    const customers = await trx
      .selectFrom("customers as c")
      .select(["c.id", "c.name"])
      .where("c.is_demo", "=", true)
      .execute();
    for (const c of customers)
      await audit(trx, ctx, {
        action: "customer.delete",
        entity: "customer",
        entityId: c.id,
        before: { name: c.name, via: "remove demo data" },
      });

    // Children first where a sample row could sit under a user's record.
    await trx.deleteFrom("astro_punches").where("is_demo", "=", true).execute();
    await trx.deleteFrom("customers").where("is_demo", "=", true).execute();
    await trx.deleteFrom("products").where("is_demo", "=", true).execute();
    await trx.deleteFrom("astro_programs").where("is_demo", "=", true).execute();
    // Sample discounts used on sales are archived, like any used discount, so receipts keep their names.
    const used = trx.selectFrom("sale_discounts").select("discount_id").where("discount_id", "is not", null);
    await trx
      .updateTable("discounts")
      .set({ archived_at: new Date(), active: false })
      .where("is_demo", "=", true)
      .where("id", "in", used)
      .execute();
    await trx.deleteFrom("discounts").where("is_demo", "=", true).where("archived_at", "is", null).execute();

    await audit(trx, ctx, {
      action: "demo.remove",
      entity: "business",
      entityId: ctx.businessId,
      after: { ...removed },
    });
    return removed;
  },
});
