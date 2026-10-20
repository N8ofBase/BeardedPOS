// A customer's order history: register sales and orders imported from the old system.
import { sql } from "kysely";
import { AppError, importedLabel } from "@pet-pos/core";
import { defineHandler } from "../handler.ts";

export interface HistoryOrder {
  id: string;
  source: "register" | "import";
  /** "#1043" for our receipts, "Imported #A-1043" or "Imported order" for imports. */
  label: string;
  date: Date;
  items: string;
  totalCents: number;
  refundedCents: number;
}

export interface CustomerHistory {
  orders: number;
  /** Net of refunds. */
  totalSpentCents: number;
  firstVisit: Date | null;
  lastVisit: Date | null;
  mostBought: { name: string; qty: number }[];
  page: HistoryOrder[];
  /** Pass as `before` for the next page. */
  next: string | null;
}

const PAGE = 25;

export const customerHistory = defineHandler<{ id: string; before?: string | null }, CustomerHistory>({
  action: "customers.view",
  async run(trx, _ctx, { id, before }) {
    const c = await trx.selectFrom("customers").select("id").where("id", "=", id).executeTakeFirst();
    if (!c) throw new AppError("not_found", "That customer doesn't exist anymore.");

    const sum = await trx
      .selectFrom("sales")
      .select([
        sql<number>`count(*)::int`.as("orders"),
        sql<number>`coalesce(sum(total_cents - refunded_cents), 0)::int`.as("spent"),
        sql<Date | null>`min(created_at)`.as("first"),
        sql<Date | null>`max(created_at)`.as("last"),
      ])
      .where("customer_id", "=", id)
      .where("status", "=", "paid")
      .executeTakeFirstOrThrow();

    // Units refunded come off, so a returned item doesn't count as "most bought".
    const most = await trx
      .selectFrom("sale_lines as l")
      .innerJoin("sales as s", "s.id", "l.sale_id")
      .select([
        sql<string>`min(l.name)`.as("name"),
        sql<number>`(sum(l.qty) - coalesce(sum((SELECT sum(rl.qty) FROM refund_lines rl WHERE rl.sale_line_id = l.id)), 0))::int`.as(
          "qty",
        ),
      ])
      .where("s.customer_id", "=", id)
      .where("s.status", "=", "paid")
      .groupBy(sql`coalesce(l.product_id::text, lower(l.name))`)
      .orderBy("qty", "desc")
      .orderBy("name")
      .limit(5)
      .execute();

    let q = trx
      .selectFrom("sales as s")
      .select([
        "s.id",
        "s.source",
        "s.receipt_number",
        "s.import_key",
        "s.created_at",
        "s.total_cents",
        "s.refunded_cents",
        sql<string>`(SELECT string_agg(l.qty || '× ' || l.name, ', ' ORDER BY l.position) FROM sale_lines l WHERE l.sale_id = s.id)`.as(
          "items",
        ),
      ])
      .where("s.customer_id", "=", id)
      .where("s.status", "=", "paid");
    if (before) q = q.where("s.created_at", "<", new Date(before));
    const rows = await q
      .orderBy("s.created_at", "desc")
      .limit(PAGE + 1)
      .execute();
    const page = rows.slice(0, PAGE);
    return {
      orders: sum.orders,
      totalSpentCents: sum.spent,
      firstVisit: sum.first ? new Date(sum.first) : null,
      lastVisit: sum.last ? new Date(sum.last) : null,
      mostBought: most.filter((m) => m.qty > 0),
      page: page.map((r) => ({
        id: r.id,
        source: r.source,
        label: r.source === "import" ? importedLabel(r.import_key) : `#${r.receipt_number}`,
        date: r.created_at,
        items: r.items ?? "",
        totalCents: r.total_cents,
        refundedCents: r.refunded_cents,
      })),
      next: rows.length > PAGE ? new Date(page[page.length - 1]!.created_at).toISOString() : null,
    };
  },
});
