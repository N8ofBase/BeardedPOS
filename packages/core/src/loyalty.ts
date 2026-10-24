// Beard Buddy, the store's own loyalty program. Every customer on a sale earns Beard
// Bucks on what they pay (after discounts, before tax), gets a birthday gift once a
// year, and trades 100 Bucks for $5 off a ticket. Bucks are whole numbers; money is cents.
import { assertCents } from "./money.ts";
import { isIsoDate, todayIso } from "./dates.ts";

export const PROGRAM_NAME = "Beard Buddy";
export const BUCKS_PER_REWARD = 100;
export const REWARD_CENTS = 500;
export const BIRTHDAY_BUCKS = 100;
/** The discount line a reward shows as on the ticket and receipt. */
export const REWARD_NAME = "Beard Bucks reward";

export type LedgerKind = "earn" | "birthday" | "redeem" | "take_back" | "give_back" | "adjust";

export const LEDGER_LABEL: Record<LedgerKind, string> = {
  earn: "Earned",
  birthday: "Birthday gift",
  redeem: "Used for $5 off",
  take_back: "Refund",
  give_back: "Reward given back",
  adjust: "Adjusted",
};

/** 1 Beard Buck per whole dollar paid before tax: $43.50 earns 43. */
export function bucksEarned(netCents: number): number {
  assertCents(netCents);
  return netCents > 0 ? Math.floor(netCents / 100) : 0;
}

/** How many rewards a ticket can take: one per 100 Bucks, each needing $5 left to take off. */
export function rewardsAllowed(balance: number, netCents: number): number {
  return Math.max(0, Math.min(Math.floor(balance / BUCKS_PER_REWARD), Math.floor(netCents / REWARD_CENTS)));
}

/**
 * The birthday gift is due in the customer's birthday month, once per calendar year.
 * lastGiftOn is the date of their last gift, if any.
 */
export function birthdayGiftDue(
  birthday: string | null,
  lastGiftOn: string | null,
  today: string = todayIso(),
): boolean {
  if (!birthday || !isIsoDate(birthday)) return false;
  if (birthday.slice(5, 7) !== today.slice(5, 7)) return false;
  return !lastGiftOn || lastGiftOn.slice(0, 4) !== today.slice(0, 4);
}

export interface RefundBucksInput {
  /** What the sale was paid before tax (subtotal less every discount). */
  saleNetCents: number;
  /** Before-tax amount refunded so far, this refund included. */
  refundedNetCents: number;
  /** Bucks this sale still counts as earned (earned less what refunds took back). */
  bucksHeld: number;
  /** Bucks spent on rewards on this sale, and how many of those were given back already. */
  bucksRedeemed: number;
  bucksGivenBack: number;
}

/**
 * What a refund does to the balance. Earned Bucks shrink to what the rest of the sale
 * still earns; a reward comes back only when the whole sale has been refunded.
 */
export function refundBucks(r: RefundBucksInput): { takeBack: number; giveBack: number } {
  const keep = bucksEarned(Math.max(0, r.saleNetCents - r.refundedNetCents));
  const takeBack = Math.max(0, r.bucksHeld - keep);
  const giveBack = r.refundedNetCents >= r.saleNetCents ? Math.max(0, r.bucksRedeemed - r.bucksGivenBack) : 0;
  return { takeBack, giveBack };
}

/** "240 Beard Bucks", "1 Beard Buck". */
export function bucksLabel(n: number): string {
  return `${n.toLocaleString("en-US")} Beard ${Math.abs(n) === 1 ? "Buck" : "Bucks"}`;
}
