// End-of-day drawer count. Everything is integer cents.
//   expected = starting cash + cash taken − cash handed back
//   over/short = counted − expected
//   deposit = counted − starting cash for tomorrow
import { AppError } from "./errors.ts";
import { formatMoney } from "./money.ts";

/** Bills and coins in the drawer, in cents, largest first. */
export const DENOMINATIONS = [10000, 5000, 2000, 1000, 500, 100, 25, 10, 5, 1] as const;
export type Denomination = (typeof DENOMINATIONS)[number];

export const DENOMINATION_LABEL: Record<Denomination, string> = {
  10000: "$100",
  5000: "$50",
  2000: "$20",
  1000: "$10",
  500: "$5",
  100: "$1",
  25: "Quarters",
  10: "Dimes",
  5: "Nickels",
  1: "Pennies",
};

/** A shortage bigger than this needs a note. */
export const SHORT_NOTE_CENTS = 500;

/** Total of a count by denomination ({"2000": 7}). Refuses unknown denominations and bad counts. */
export function countTotal(counts: Record<string, number>): number {
  let total = 0;
  for (const [k, n] of Object.entries(counts)) {
    const d = Number(k);
    if (!(DENOMINATIONS as readonly number[]).includes(d))
      throw new AppError("invalid", "That isn't a bill or coin the drawer holds.");
    if (!Number.isInteger(n) || n < 0 || n > 100_000)
      throw new AppError(
        "invalid",
        `The count for ${DENOMINATION_LABEL[d as Denomination]} must be a whole number.`,
      );
    total += d * n;
  }
  return total;
}

export function expectedCash(startingCents: number, cashInCents: number, cashOutCents: number): number {
  return startingCents + cashInCents - cashOutCents;
}

/** "Even", "Over $2.00", "Short $3.50". */
export function overShortLabel(overShortCents: number): string {
  if (overShortCents === 0) return "Even";
  return overShortCents > 0 ? `Over ${formatMoney(overShortCents)}` : `Short ${formatMoney(-overShortCents)}`;
}

/** What to take to the bank, leaving tomorrow's starting cash. Never below zero. */
export function depositFor(
  countedCents: number,
  floatCents: number,
): { depositCents: number; leaveCents: number } {
  const leave = Math.min(countedCents, floatCents);
  return { depositCents: countedCents - leave, leaveCents: leave };
}

/** True when the drawer is short by more than SHORT_NOTE_CENTS. */
export function needsShortNote(overShortCents: number): boolean {
  return overShortCents < -SHORT_NOTE_CENTS;
}
