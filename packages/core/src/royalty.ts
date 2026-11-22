// Royalties by sale type. Each game can pay several people (a designer, an artist), each with a
// rate for counter sales, one for website orders and one for wholesale to stores, on the game's
// net profit or on its sales. Everything is integer cents; rates are thousandths of a percent.
//
// A month's statement adds up every movement of a game in that month: sale lines (positive) and
// refunds made in the month (negative), so a month already paid never changes later. For each
// person, game and sale type: base = net profit or sales, royalty = floor(base × rate), and nothing
// when the base is zero or less.
import { assertCents } from "./money.ts";
import { royaltyCents } from "./profit.ts";

export type SaleType = "retail" | "online" | "wholesale";
export const SALE_TYPES: readonly SaleType[] = ["retail", "online", "wholesale"];
export const SALE_TYPE_LABELS: Record<SaleType, string> = {
  retail: "Counter",
  online: "Website",
  wholesale: "Wholesale",
};

export type RoyaltyBasis = "profit" | "sales";
export const BASIS_LABELS: Record<RoyaltyBasis, string> = {
  profit: "Net profit",
  sales: "Sales",
};

/** Thousandths of a percent per sale type: 7.5% = 7500. */
export type RoyaltyRates = Record<SaleType, number>;

/** One movement of a game: a sale line, or a refund on one (negative amounts and units). */
export interface RoyaltyEntry {
  productId: string;
  saleType: SaleType;
  units: number;
  /** Paid after discounts, before tax; negative for money given back. */
  revenueCents: number;
  /** Our cost of the units that left the shelf; negative for units put back. */
  costCents: number;
}

/** What one person earns on one game. */
export interface RoyaltyTerms {
  payeeId: string;
  productId: string;
  basis: RoyaltyBasis;
  rates: RoyaltyRates;
}

export interface RoyaltyCell {
  saleType: SaleType;
  units: number;
  revenueCents: number;
  costCents: number;
  profitCents: number;
  /** What the rate applies to: net profit or sales, by the terms' basis. */
  baseCents: number;
  rateMpct: number;
  royaltyCents: number;
}

export interface RoyaltyGame {
  productId: string;
  basis: RoyaltyBasis;
  /** Only sale types the game moved in, in SALE_TYPES order. */
  cells: RoyaltyCell[];
  royaltyCents: number;
}

export interface RoyaltyStatement {
  payeeId: string;
  games: RoyaltyGame[];
  royaltyCents: number;
}

interface Sum {
  units: number;
  revenueCents: number;
  costCents: number;
}

/** Adds up entries per game and sale type. */
export function sumEntries(entries: RoyaltyEntry[]): Map<string, Map<SaleType, Sum>> {
  const games = new Map<string, Map<SaleType, Sum>>();
  for (const e of entries) {
    assertCents(e.revenueCents);
    assertCents(e.costCents);
    const byType = games.get(e.productId) ?? new Map<SaleType, Sum>();
    const s = byType.get(e.saleType) ?? { units: 0, revenueCents: 0, costCents: 0 };
    const next = {
      units: s.units + e.units,
      revenueCents: s.revenueCents + e.revenueCents,
      costCents: s.costCents + e.costCents,
    };
    if (!Number.isSafeInteger(next.revenueCents) || !Number.isSafeInteger(next.costCents))
      throw new RangeError("Amount too large to total exactly");
    byType.set(e.saleType, next);
    games.set(e.productId, byType);
  }
  return games;
}

/** Royalty on one game and sale type under one person's terms. */
export function royaltyCell(
  saleType: SaleType,
  sum: Sum,
  basis: RoyaltyBasis,
  rateMpct: number,
): RoyaltyCell {
  const profitCents = sum.revenueCents - sum.costCents;
  const baseCents = basis === "profit" ? profitCents : sum.revenueCents;
  return {
    saleType,
    ...sum,
    profitCents,
    baseCents,
    rateMpct,
    royaltyCents: royaltyCents(baseCents, rateMpct),
  };
}

/**
 * Each person's statement for the period: every game they earn on that moved, by sale type.
 * People whose games didn't move are left out. Statements and games keep the order of `terms`.
 */
export function royaltyStatements(entries: RoyaltyEntry[], terms: RoyaltyTerms[]): RoyaltyStatement[] {
  const sums = sumEntries(entries);
  const byPayee = new Map<string, RoyaltyStatement>();
  for (const t of terms) {
    const types = sums.get(t.productId);
    if (!types) continue;
    const cells = SALE_TYPES.filter((st) => types.has(st)).map((st) =>
      royaltyCell(st, types.get(st)!, t.basis, t.rates[st]),
    );
    const game: RoyaltyGame = {
      productId: t.productId,
      basis: t.basis,
      cells,
      royaltyCents: cells.reduce((n, c) => n + c.royaltyCents, 0),
    };
    const s = byPayee.get(t.payeeId) ?? { payeeId: t.payeeId, games: [], royaltyCents: 0 };
    s.games.push(game);
    s.royaltyCents += game.royaltyCents;
    byPayee.set(t.payeeId, s);
  }
  return [...byPayee.values()];
}

/** Plain-English problems with one person's terms on a game. Empty when they can be saved. */
export function validateRoyaltyTerms(t: { basis: string; rates: Record<string, unknown> }): string[] {
  const e: string[] = [];
  if (t.basis !== "profit" && t.basis !== "sales") e.push("Pick net profit or sales.");
  for (const st of SALE_TYPES) {
    const r = t.rates[st];
    if (typeof r !== "number" || !Number.isInteger(r) || r < 0 || r > 100_000)
      e.push(`${SALE_TYPE_LABELS[st]} rate must be 0 to 100%.`);
  }
  return e;
}

/** Cents as a plain amount for a spreadsheet: -450 → "-4.50". */
export function centsText(cents: number): string {
  assertCents(cents);
  const a = Math.abs(cents);
  return `${cents < 0 ? "-" : ""}${Math.floor(a / 100)}.${String(a % 100).padStart(2, "0")}`;
}

/** CSV text: every cell quoted when it needs to be, lines ending in CRLF as spreadsheets expect. */
export function toCsv(rows: (string | number)[][]): string {
  const cell = (v: string | number) => {
    const s = String(v);
    // A leading = + - @ would run as a formula in a spreadsheet; a quote mark keeps it text.
    const safe = /^[=+\-@]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
    return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
