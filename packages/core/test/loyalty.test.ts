import { describe, expect, it } from "vitest";
import {
  birthdayGiftDue,
  bucksEarned,
  bucksLabel,
  priceSale,
  refundBucks,
  rewardsAllowed,
  type TicketLine,
} from "../src/index.ts";

const line = (key: string, cents: number, qty = 1): TicketLine => ({
  key,
  productId: key,
  name: key,
  unitPriceCents: cents,
  qty,
  taxClass: "standard",
});

describe("earning", () => {
  it("gives 1 Buck per whole dollar", () => {
    expect(bucksEarned(4350)).toBe(43);
    expect(bucksEarned(99)).toBe(0);
    expect(bucksEarned(0)).toBe(0);
    expect(() => bucksEarned(1.5)).toThrow();
  });
});

describe("rewards", () => {
  it("allows one per 100 Bucks while the ticket has $5 left for each", () => {
    expect(rewardsAllowed(240, 6499)).toBe(2);
    expect(rewardsAllowed(240, 899)).toBe(1);
    expect(rewardsAllowed(240, 499)).toBe(0);
    expect(rewardsAllowed(99, 6499)).toBe(0);
    expect(rewardsAllowed(-20, 6499)).toBe(0);
  });

  it("takes $5 off per reward after store discounts, before tax", () => {
    const p = priceSale({
      lines: [line("a", 1299), line("b", 899)],
      storeDiscounts: [],
      taxRateMpct: 7000,
      rewards: 1,
    });
    expect(p.discounts).toEqual([
      { name: "Beard Bucks reward", amountCents: 500, lineKey: null, discountId: null },
    ]);
    // $21.98 − $5.00 = $16.98, tax 7% = $1.19.
    expect(p).toMatchObject({ discountCents: 500, taxableCents: 1698, taxCents: 119, totalCents: 1817 });
    expect(p.lines.map((l) => l.discountCents)).toEqual([295, 205]);
  });

  it("refuses a reward bigger than what's left on the ticket", () => {
    expect(() =>
      priceSale({ lines: [line("a", 899)], storeDiscounts: [], taxRateMpct: 0, rewards: 2 }),
    ).toThrow("2 Beard Bucks rewards need at least $10 on the ticket.");
    expect(() =>
      priceSale({ lines: [line("a", 499)], storeDiscounts: [], taxRateMpct: 0, rewards: 1 }),
    ).toThrow("A Beard Bucks reward needs at least $5 on the ticket.");
  });
});

describe("birthday gift", () => {
  it("is due in the birthday month, once a year", () => {
    expect(birthdayGiftDue("1990-10-30", null, "2026-10-01")).toBe(true);
    expect(birthdayGiftDue("1990-10-30", "2025-10-12", "2026-10-24")).toBe(true);
    expect(birthdayGiftDue("1990-10-30", "2026-10-02", "2026-10-24")).toBe(false);
    expect(birthdayGiftDue("1990-11-01", null, "2026-10-24")).toBe(false);
    expect(birthdayGiftDue(null, null, "2026-10-24")).toBe(false);
  });
});

describe("refunds", () => {
  const sale = { saleNetCents: 4350, bucksHeld: 43, bucksRedeemed: 0, bucksGivenBack: 0 };

  it("takes back what the refunded part earned", () => {
    expect(refundBucks({ ...sale, refundedNetCents: 1299 })).toEqual({ takeBack: 13, giveBack: 0 });
    // A second refund later: 43 − 13 = 30 held, the rest earns 0.
    expect(refundBucks({ ...sale, bucksHeld: 30, refundedNetCents: 4350 })).toEqual({
      takeBack: 30,
      giveBack: 0,
    });
  });

  it("gives a reward back only when the whole sale is refunded", () => {
    const used = { ...sale, bucksRedeemed: 100 };
    expect(refundBucks({ ...used, refundedNetCents: 4000 }).giveBack).toBe(0);
    expect(refundBucks({ ...used, refundedNetCents: 4350 }).giveBack).toBe(100);
    expect(refundBucks({ ...used, bucksGivenBack: 100, refundedNetCents: 4350 }).giveBack).toBe(0);
  });
});

it("labels Bucks", () => {
  expect(bucksLabel(1)).toBe("1 Beard Buck");
  expect(bucksLabel(1240)).toBe("1,240 Beard Bucks");
});
