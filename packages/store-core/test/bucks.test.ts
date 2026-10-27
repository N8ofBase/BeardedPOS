import { describe, expect, it } from "vitest";
import { LEDGER_LABEL, MIN_REWARD_ORDER_CENTS, rewardsAllowed } from "../src/bucks.ts";

describe("rewards on web orders", () => {
  it("allows none below $25, then one per 100 Bucks and per $5", () => {
    expect(MIN_REWARD_ORDER_CENTS).toBe(2500);
    expect(rewardsAllowed(1000, 2499)).toBe(0);
    expect(rewardsAllowed(1000, 2500)).toBe(5);
    expect(rewardsAllowed(100, 5000)).toBe(1);
    expect(rewardsAllowed(99, 5000)).toBe(0);
  });

  it("names the welcome gift in the history", () => {
    expect(LEDGER_LABEL.welcome).toBe("Welcome gift");
    expect(LEDGER_LABEL.earn).toBe("Earned");
  });
});
