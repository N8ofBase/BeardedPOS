// Net profit per game and the royalty it earns. The math is lineProfit() / royaltyCents()
// in core; this only gathers the lines. Register sales only, like the day totals: imported
// orders were sold in the old system and have no cost we can trust.
import { sql, type Transaction } from "kysely";
import { addProfit, AppError, lineProfit, NO_PROFIT, royaltyCents, type Profit } from "@pet-pos/core";
import type { DB } from "@pet-pos/db";
import { defineHandler } from "../handler.ts";

export interface GameProfitRow extends Profit {
  productId: string;
  name: string;
  sku: string | null;
  royaltyMpct: number;
  royaltyPayee: string | null;
  royaltyCents: number;
  /** Lines rung before costs were saved on sales; they use today's cost. */
  estimatedCostLines: number;
}

export interface ProfitReport {
  games: GameProfitRow[];
  totals: Profit & { royaltyCents: number };
}

/**
 * Every paid register sale line with what it earned, ready for lineProfit(). Callers add
 * their own filter (a date range, one customer).
 */
export function profitLineQuery(trx: Transaction<DB>) {
  return trx
    .selectFrom("sale_lines as l")
    .innerJoin("sales as s", "s.id", "l.sale_id")
    .innerJoin("products as p", "p.id", "l.product_id")
    .select([
      "p.id as productId",
      "p.name",
      "p.sku",
      "p.royalty_mpct as royaltyMpct",
      "p.royalty_payee as royaltyPayee",
      "l.qty",
      "l.line_total_cents as lineTotalCents",
      "l.unit_cost_cents as savedCostCents",
      "p.cost_cents as currentCostCents",
      sql<number>`coalesce((SELECT sum(rl.amount_cents) FROM refund_lines rl WHERE rl.sale_line_id = l.id), 0)::int`.as(
        "refundedCents",
      ),
      sql<number>`coalesce((SELECT sum(rl.qty) FROM refund_lines rl JOIN refunds r ON r.id = rl.refund_id WHERE rl.sale_line_id = l.id AND r.restock), 0)::int`.as(
        "restockedQty",
      ),
      sql<number>`coalesce((SELECT sum(rl.qty) FROM refund_lines rl JOIN refunds r ON r.id = rl.refund_id WHERE rl.sale_line_id = l.id AND NOT r.restock), 0)::int`.as(
        "writtenOffQty",
      ),
    ])
    .where("s.source", "=", "register")
    .where("s.status", "=", "paid");
}

/**
 * Profit by game for sales rung from `from` up to `to` (ISO times), net of every refund
 * on those sales. Most profitable first.
 */
export const profitByGame = defineHandler<{ from: string; to: string }, ProfitReport>({
  action: "sales.view",
  async run(trx, _ctx, { from, to }) {
    const start = new Date(from);
    const end = new Date(to);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end)
      throw new AppError("invalid", "Pick a start date before the end date.");

    const lines = await profitLineQuery(trx)
      .where("s.created_at", ">=", start)
      .where("s.created_at", "<", end)
      .execute();

    const games = new Map<string, GameProfitRow>();
    for (const l of lines) {
      const p = lineProfit({ ...l, unitCostCents: l.savedCostCents ?? l.currentCostCents });
      const g = games.get(l.productId) ?? {
        productId: l.productId,
        name: l.name,
        sku: l.sku,
        royaltyMpct: l.royaltyMpct,
        royaltyPayee: l.royaltyPayee,
        royaltyCents: 0,
        estimatedCostLines: 0,
        ...NO_PROFIT,
      };
      games.set(l.productId, {
        ...g,
        ...addProfit(g, p),
        estimatedCostLines: g.estimatedCostLines + (l.savedCostCents === null ? 1 : 0),
      });
    }

    let totals = { ...NO_PROFIT, royaltyCents: 0 };
    const rows = [...games.values()].map((g) => {
      const row = { ...g, royaltyCents: royaltyCents(g.profitCents, g.royaltyMpct) };
      totals = { ...addProfit(totals, row), royaltyCents: totals.royaltyCents + row.royaltyCents };
      return row;
    });
    rows.sort((a, b) => b.profitCents - a.profitCents || a.name.localeCompare(b.name));
    return { games: rows, totals };
  },
});
