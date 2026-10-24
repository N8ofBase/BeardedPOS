// Net profit and royalties per game. Everything is integer cents.
//
// For each sale line:
//   revenue = what was paid before tax (line total, after discounts) − refunds on the line
//   cost    = unit cost × units we no longer have: units sold − units refunded and put back on the shelf
// A unit refunded without restocking (damaged) still cost us, so its cost stays in.
// Royalty = floor(net profit × rate), and nothing when there's no profit.
import { assertCents } from "./money.ts";

export interface ProfitLine {
  qty: number;
  /** What was paid for the line after discounts, before tax. */
  lineTotalCents: number;
  /** Our cost per unit when the line was rung. */
  unitCostCents: number;
  /** Money given back on the line, before tax. */
  refundedCents: number;
  /** Units refunded and put back on the shelf. */
  restockedQty: number;
  /** Units refunded and not put back (damaged, gone). */
  writtenOffQty: number;
}

export interface Profit {
  /** Units sold less every unit refunded. */
  units: number;
  revenueCents: number;
  costCents: number;
  profitCents: number;
}

export const NO_PROFIT: Profit = { units: 0, revenueCents: 0, costCents: 0, profitCents: 0 };

export function lineProfit(l: ProfitLine): Profit {
  for (const c of [l.lineTotalCents, l.unitCostCents, l.refundedCents]) assertCents(c);
  const revenue = l.lineTotalCents - l.refundedCents;
  const cost = l.unitCostCents * (l.qty - l.restockedQty);
  if (!Number.isSafeInteger(cost)) throw new RangeError("Amount too large to total exactly");
  return {
    units: l.qty - l.restockedQty - l.writtenOffQty,
    revenueCents: revenue,
    costCents: cost,
    profitCents: revenue - cost,
  };
}

export function addProfit(a: Profit, b: Profit): Profit {
  return {
    units: a.units + b.units,
    revenueCents: a.revenueCents + b.revenueCents,
    costCents: a.costCents + b.costCents,
    profitCents: a.profitCents + b.profitCents,
  };
}

/** Royalty owed on a game's net profit at a rate in thousandths of a percent (7.5% = 7500). */
export function royaltyCents(profitCents: number, rateMpct: number): number {
  assertCents(profitCents);
  if (!Number.isSafeInteger(rateMpct) || rateMpct < 0 || rateMpct > 100_000)
    throw new RangeError(`Royalty rate must be 0 to 100%, got ${rateMpct} mpct`);
  if (profitCents <= 0 || rateMpct === 0) return 0;
  const p = profitCents * rateMpct;
  if (!Number.isSafeInteger(p)) throw new RangeError("Amount too large to total exactly");
  return Math.floor(p / 100_000);
}
