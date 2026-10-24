// Pricing a ticket. The register shows these numbers as you go; the server reruns
// the same function with current prices at checkout. Everything is integer cents.
//
// Order of discounts (each works on what's left after the one before):
//   1. item discounts
//   2. whole-ticket discounts, spread across lines in proportion
//   3. Beard Bucks rewards ($5 each), spread the same way
// Discounts always lower the taxable amount. Tax is rounded once per sale, half up.
import { AppError } from "./errors.ts";
import { REWARD_CENTS, REWARD_NAME } from "./loyalty.ts";
import { assertCents } from "./money.ts";

export interface TicketLine {
  key: string;
  productId: string | null;
  name: string;
  unitPriceCents: number;
  qty: number;
  taxClass: "standard" | "exempt";
}

export interface DiscountRule {
  id: string;
  name: string;
  kind: "percent" | "fixed";
  /** Thousandths of a percent: 20% = 20000. */
  percentMpct: number | null;
  amountCents: number | null;
  scope: "ticket" | "line";
  combinable: boolean;
}

export interface AppliedStoreDiscount {
  rule: DiscountRule;
  /** The line it applies to, for item discounts. */
  lineKey: string | null;
}

export interface PriceInput {
  lines: TicketLine[];
  storeDiscounts: AppliedStoreDiscount[];
  taxRateMpct: number;
  /** Beard Bucks rewards used on this ticket, $5 off each. */
  rewards?: number;
}

export interface PricedDiscount {
  name: string;
  amountCents: number;
  lineKey: string | null;
  /** Null for a Beard Bucks reward. */
  discountId: string | null;
}

export interface PricedLine {
  key: string;
  grossCents: number;
  discountCents: number;
  netCents: number;
  taxBaseCents: number;
}

export interface PricedSale {
  lines: PricedLine[];
  discounts: PricedDiscount[];
  subtotalCents: number;
  discountCents: number;
  taxableCents: number;
  taxCents: number;
  totalCents: number;
}

/** n × num / den, rounded half up, for non-negative integers. Exact while n × num < 2^53. */
export function mulDivRoundHalfUp(n: number, num: number, den: number): number {
  const p = n * num;
  if (!Number.isSafeInteger(p)) throw new RangeError("Amount too large to price exactly");
  return Math.floor((p + Math.floor(den / 2)) / den);
}

/** Percent of an amount: mpct is thousandths of a percent. */
export function percentOf(cents: number, mpct: number): number {
  return mulDivRoundHalfUp(cents, mpct, 100_000);
}

export function taxOn(taxableCents: number, rateMpct: number): number {
  return mulDivRoundHalfUp(taxableCents, rateMpct, 100_000);
}

/**
 * Spreads an amount over weights in proportion (largest remainder method): each
 * share is rounded down, then the leftover cents go to the shares that lost the
 * most to rounding (ties to the larger weight). Shares never exceed their weight.
 */
export function allocate(amount: number, weights: number[]): number[] {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0 || amount <= 0) return weights.map(() => 0);
  if (amount >= total) return [...weights];
  const exact = weights.map((w) => amount * w);
  const shares = exact.map((e) => Math.floor(e / total));
  let left = amount - shares.reduce((a, b) => a + b, 0);
  const order = weights
    .map((w, i) => ({ i, w, rem: exact[i]! % total }))
    .sort((a, b) => b.rem - a.rem || b.w - a.w || a.i - b.i);
  for (const { i } of order) {
    if (left === 0) break;
    shares[i]!++;
    left--;
  }
  return shares;
}

function ruleAmount(rule: DiscountRule, base: number): number {
  if (base <= 0) return 0;
  if (rule.kind === "percent") return Math.min(base, percentOf(base, rule.percentMpct ?? 0));
  return Math.min(base, rule.amountCents ?? 0);
}

/** Refuses stacking that the discounts don't allow. */
function checkStacking(applied: AppliedStoreDiscount[]): void {
  const groups = new Map<string, AppliedStoreDiscount[]>();
  for (const a of applied) {
    const k = a.rule.scope === "ticket" ? "ticket" : `line:${a.lineKey}`;
    groups.set(k, [...(groups.get(k) ?? []), a]);
  }
  for (const [k, list] of groups) {
    if (new Set(list.map((a) => a.rule.id)).size !== list.length)
      throw new AppError(
        "invalid",
        `${list[0]!.rule.name} is already on this ${k === "ticket" ? "ticket" : "item"}.`,
      );
    if (list.length > 1 && list.some((a) => !a.rule.combinable))
      throw new AppError(
        "invalid",
        k === "ticket"
          ? "Only one whole-ticket discount at a time. Remove the other one first."
          : "This item already has a discount. Remove it first.",
      );
  }
}

export function priceSale(input: PriceInput): PricedSale {
  const { lines, storeDiscounts, taxRateMpct, rewards = 0 } = input;
  if (!Number.isSafeInteger(taxRateMpct) || taxRateMpct < 0) throw new TypeError("Bad tax rate");
  checkStacking(storeDiscounts);

  const keys = new Set<string>();
  const work = lines.map((l) => {
    assertCents(l.unitPriceCents);
    if (l.unitPriceCents < 0) throw new AppError("invalid", `${l.name} has a negative price.`);
    if (!Number.isInteger(l.qty) || l.qty < 1 || l.qty > 9999)
      throw new AppError("invalid", `Quantity for ${l.name} must be 1 to 9999.`);
    if (keys.has(l.key)) throw new TypeError(`Duplicate line key ${l.key}`);
    keys.add(l.key);
    const gross = l.unitPriceCents * l.qty;
    return { line: l, gross, net: gross };
  });
  const byKey = new Map(work.map((w) => [w.line.key, w]));
  const discounts: PricedDiscount[] = [];

  // 1. Item discounts.
  for (const a of storeDiscounts.filter((d) => d.rule.scope === "line")) {
    const w = a.lineKey ? byKey.get(a.lineKey) : undefined;
    if (!w) throw new AppError("invalid", `Pick the item for ${a.rule.name}.`);
    const amt = ruleAmount(a.rule, w.net);
    w.net -= amt;
    discounts.push({
      name: a.rule.name,
      amountCents: amt,
      lineKey: w.line.key,
      discountId: a.rule.id,
    });
  }

  // 2. Whole-ticket discounts, each on what's left, spread across lines.
  for (const a of storeDiscounts.filter((d) => d.rule.scope === "ticket")) {
    const base = work.reduce((s, w) => s + w.net, 0);
    const amt = ruleAmount(a.rule, base);
    const shares = allocate(
      amt,
      work.map((w) => w.net),
    );
    work.forEach((w, i) => (w.net -= shares[i]!));
    discounts.push({
      name: a.rule.name,
      amountCents: amt,
      lineKey: null,
      discountId: a.rule.id,
    });
  }

  // 3. Beard Bucks rewards: $5 each, and each needs $5 left on the ticket to take off.
  if (!Number.isInteger(rewards) || rewards < 0) throw new TypeError("Bad reward count");
  if (rewards > 0) {
    const base = work.reduce((s, w) => s + w.net, 0);
    if (rewards * REWARD_CENTS > base)
      throw new AppError(
        "invalid",
        rewards === 1
          ? "A Beard Bucks reward needs at least $5 on the ticket."
          : `${rewards} Beard Bucks rewards need at least $${(rewards * REWARD_CENTS) / 100} on the ticket.`,
      );
    const amt = rewards * REWARD_CENTS;
    const shares = allocate(
      amt,
      work.map((w) => w.net),
    );
    work.forEach((w, i) => (w.net -= shares[i]!));
    discounts.push({
      name: rewards === 1 ? REWARD_NAME : `${REWARD_NAME} ×${rewards}`,
      amountCents: amt,
      lineKey: null,
      discountId: null,
    });
  }

  const priced: PricedLine[] = work.map((w) => {
    const taxBase = w.line.taxClass === "standard" ? w.net : 0;
    return {
      key: w.line.key,
      grossCents: w.gross,
      discountCents: w.gross - w.net,
      netCents: w.net,
      taxBaseCents: taxBase,
    };
  });
  const subtotal = priced.reduce((s, l) => s + l.grossCents, 0);
  const discount = priced.reduce((s, l) => s + l.discountCents, 0);
  const taxable = priced.reduce((s, l) => s + l.taxBaseCents, 0);
  const tax = taxOn(taxable, taxRateMpct);
  return {
    lines: priced,
    discounts,
    subtotalCents: subtotal,
    discountCents: discount,
    taxableCents: taxable,
    taxCents: tax,
    totalCents: subtotal - discount + tax,
  };
}

/** Change for a cash payment, or null when the cash isn't enough. */
export function changeDue(dueCents: number, tenderedCents: number): number | null {
  assertCents(dueCents);
  assertCents(tenderedCents);
  return tenderedCents >= dueCents ? tenderedCents - dueCents : null;
}

/** Quick cash buttons: exact, then the next bills up ($5, $10, $20, $50, $100). */
export function cashSuggestions(dueCents: number): number[] {
  const out = [dueCents];
  for (const bill of [500, 1000, 2000, 5000, 10000]) {
    const up = Math.ceil(dueCents / bill) * bill;
    if (up > dueCents && !out.includes(up)) out.push(up);
  }
  return out.slice(0, 4);
}

/** "20%" or "$5.00", for discount buttons. */
export function discountValueLabel(rule: Pick<DiscountRule, "kind" | "percentMpct" | "amountCents">): string {
  if (rule.kind === "percent") {
    const m = rule.percentMpct ?? 0;
    const frac = String(m % 1000)
      .padStart(3, "0")
      .replace(/0+$/, "");
    return `${Math.trunc(m / 1000)}${frac ? `.${frac}` : ""}%`;
  }
  const c = rule.amountCents ?? 0;
  return `$${Math.trunc(c / 100)}.${String(c % 100).padStart(2, "0")}`;
}
