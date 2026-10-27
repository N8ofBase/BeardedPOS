// Beard Buddy online: the register's rules (packages/core/src/loyalty.ts), plus what the store
// adds on top. A web order can use rewards only when the shopper is signed in.
import { LEDGER_LABEL as REGISTER_LABEL, rewardsAllowed as registerRewards } from "@bearded/core/loyalty";
import type { LedgerKind as RegisterKind } from "@bearded/core/loyalty";

export {
  BIRTHDAY_BUCKS,
  birthdayGiftDue,
  BUCKS_PER_REWARD,
  bucksEarned,
  bucksLabel,
  PROGRAM_NAME,
  REWARD_CENTS,
  REWARD_NAME,
} from "@bearded/core/loyalty";

/** An open checkout keeps its Bucks this long, so the same Bucks can't pay for two orders. */
export const HOLD_HOURS = 24;

/** Joining Beard Buddy online gives this many Bucks once, ready to use on the first order. */
export const WELCOME_BUCKS = 100;

/** A web order must be at least this, before tax and rewards, to use Beard Bucks. */
export const MIN_REWARD_ORDER_CENTS = 2500;

/** The register's kinds, plus the welcome gift, which only the web store gives. */
export type LedgerKind = RegisterKind | "welcome";

export const LEDGER_LABEL: Record<LedgerKind, string> = { ...REGISTER_LABEL, welcome: "Welcome gift" };

/** The register's rule (one reward per 100 Bucks and per $5), but none below the web order minimum. */
export function rewardsAllowed(balance: number, subtotalCents: number): number {
  return subtotalCents < MIN_REWARD_ORDER_CENTS ? 0 : registerRewards(balance, subtotalCents);
}
