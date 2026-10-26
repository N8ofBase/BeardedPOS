// Beard Buddy online: the register's rules (packages/core/src/loyalty.ts), plus what the store
// adds on top. A web order can use rewards only when the shopper is signed in.
export {
  BIRTHDAY_BUCKS,
  birthdayGiftDue,
  BUCKS_PER_REWARD,
  bucksEarned,
  bucksLabel,
  LEDGER_LABEL,
  PROGRAM_NAME,
  REWARD_CENTS,
  REWARD_NAME,
  rewardsAllowed,
  type LedgerKind,
} from "@bearded/core/loyalty";

/** An open checkout keeps its Bucks this long, so the same Bucks can't pay for two orders. */
export const HOLD_HOURS = 24;
