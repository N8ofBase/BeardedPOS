import { describe, expect, it } from "vitest";
import {
  allocate,
  cashSuggestions,
  changeDue,
  discountValueLabel,
  percentOf,
  priceSale,
  taxOn,
  type DiscountRule,
  type PriceInput,
  type TicketLine,
} from "../src/sale.ts";

const line = (over: Partial<TicketLine> & { key: string }): TicketLine => ({
  productId: over.key,
  name: over.key,
  unitPriceCents: 1000,
  qty: 1,
  taxClass: "standard",
  astroProgramId: null,
  offer: null,
  applyOffer: false,
  ...over,
});

const rule = (over: Partial<DiscountRule> & { id: string }): DiscountRule => ({
  name: over.id,
  kind: "percent",
  percentMpct: 20_000,
  amountCents: null,
  scope: "ticket",
  combinable: false,
  ...over,
});

const base = (over: Partial<PriceInput>): PriceInput => ({
  lines: [],
  storeDiscounts: [],
  rewards: [],
  taxRateMpct: 0,
  astroBeforeTax: true,
  ...over,
});

describe("tax", () => {
  it("rounds half up", () => {
    expect(taxOn(50, 7000)).toBe(4); // 3.5¢ → 4¢
    expect(taxOn(1, 8875)).toBe(0); // 0.08875¢
    expect(taxOn(999, 8875)).toBe(89); // 88.66¢
    expect(taxOn(123456, 8875)).toBe(10957); // $109.567 → $109.57
    expect(taxOn(1000, 0)).toBe(0);
  });

  it("is rounded once per sale, not per line", () => {
    // Three 50¢ items at 7%: per line would be 4+4+4 = 12¢; once on $1.50 is 10.5 → 11¢.
    const p = priceSale(
      base({
        lines: [
          line({ key: "a", unitPriceCents: 50 }),
          line({ key: "b", unitPriceCents: 50 }),
          line({ key: "c", unitPriceCents: 50 }),
        ],
        taxRateMpct: 7000,
      }),
    );
    expect(p.taxCents).toBe(11);
    expect(p.totalCents).toBe(161);
  });

  it("doesn't tax exempt items", () => {
    const p = priceSale(
      base({
        lines: [
          line({ key: "food", unitPriceCents: 6499 }),
          line({ key: "rx", unitPriceCents: 2000, taxClass: "exempt" }),
        ],
        taxRateMpct: 7000,
      }),
    );
    expect(p).toMatchObject({ subtotalCents: 8499, taxableCents: 6499, taxCents: 455, totalCents: 8954 });
  });
});

describe("item discounts", () => {
  it("applies an Astro offer only when ticked, capped at the line", () => {
    const offer = { label: "$5 off 24 lb bag", cents: 500 };
    expect(priceSale(base({ lines: [line({ key: "a", offer })] })).discountCents).toBe(0);
    const p = priceSale(base({ lines: [line({ key: "a", offer, applyOffer: true, qty: 2 })] }));
    expect(p.discounts).toMatchObject([
      { source: "astro_offer", name: "$5 off 24 lb bag", amountCents: 500, lineKey: "a" },
    ]);
    const small = priceSale(
      base({ lines: [line({ key: "a", unitPriceCents: 300, offer, applyOffer: true })] }),
    );
    expect(small.totalCents).toBe(0);
  });

  it("applies a store item discount after the offer", () => {
    const p = priceSale(
      base({
        lines: [
          line({ key: "a", unitPriceCents: 2000, offer: { label: "o", cents: 500 }, applyOffer: true }),
        ],
        storeDiscounts: [
          {
            rule: rule({ id: "dmg", kind: "fixed", percentMpct: null, amountCents: 500, scope: "line" }),
            lineKey: "a",
          },
        ],
      }),
    );
    expect(p.lines[0]!.netCents).toBe(1000);
    const pct = priceSale(
      base({
        lines: [
          line({ key: "a", unitPriceCents: 2000, offer: { label: "o", cents: 500 }, applyOffer: true }),
        ],
        storeDiscounts: [{ rule: rule({ id: "half", percentMpct: 50_000, scope: "line" }), lineKey: "a" }],
      }),
    );
    expect(pct.lines[0]!.netCents).toBe(750); // 50% of what's left ($15), not of $20
  });

  it("needs the item for an item discount", () => {
    expect(() =>
      priceSale(
        base({
          lines: [line({ key: "a" })],
          storeDiscounts: [{ rule: rule({ id: "x", scope: "line" }), lineKey: null }],
        }),
      ),
    ).toThrow(/Pick the item/);
  });
});

describe("Astro rewards", () => {
  const food = (key: string, price: number, qty = 1) =>
    line({ key, unitPriceCents: price, qty, astroProgramId: "club" });

  it("takes off the cheapest qualifying item, and that item doesn't earn", () => {
    const p = priceSale(
      base({
        lines: [food("big", 6499), food("small", 3899), line({ key: "toy", unitPriceCents: 899 })],
        rewards: [{ programId: "club", label: "Next bag free" }],
      }),
    );
    expect(p.discounts).toEqual([
      {
        source: "astro_reward",
        name: "Next bag free",
        amountCents: 3899,
        lineKey: "small",
        discountId: null,
        programId: "club",
      },
    ]);
    expect(p.earned).toEqual({ club: 1 });
  });

  it("earns one punch per qualifying item", () => {
    expect(priceSale(base({ lines: [food("a", 6499, 3), line({ key: "toy" })] })).earned).toEqual({
      club: 3,
    });
  });

  it("refuses a reward with nothing to redeem it on", () => {
    expect(() =>
      priceSale(
        base({ lines: [line({ key: "toy" })], rewards: [{ programId: "club", label: "Next bag free" }] }),
      ),
    ).toThrow(/Add a qualifying item/);
  });

  it("comes off before tax, or after when the store says so", () => {
    const input = base({
      lines: [food("a", 6499), food("b", 3899)],
      rewards: [{ programId: "club", label: "Free" }],
      taxRateMpct: 7000,
    });
    expect(priceSale(input)).toMatchObject({ taxableCents: 6499, taxCents: 455, totalCents: 6954 });
    expect(priceSale({ ...input, astroBeforeTax: false })).toMatchObject({
      taxableCents: 10398,
      taxCents: 728,
      totalCents: 7227,
    });
  });
});

describe("whole-ticket store discounts", () => {
  it("takes a percent off what's left after item discounts and rewards", () => {
    const p = priceSale(
      base({
        lines: [
          line({ key: "a", unitPriceCents: 6499, offer: { label: "o", cents: 500 }, applyOffer: true }),
          line({ key: "b", unitPriceCents: 1299 }),
        ],
        storeDiscounts: [{ rule: rule({ id: "emp", name: "Employee discount" }), lineKey: null }],
      }),
    );
    // (5999 + 1299) × 20% = 1459.6 → 1460
    expect(p.discounts.at(-1)).toMatchObject({
      source: "store",
      name: "Employee discount",
      amountCents: 1460,
    });
    expect(p.totalCents).toBe(7798 - 500 - 1460);
  });

  it("caps a fixed amount at what's left", () => {
    const p = priceSale(
      base({
        lines: [line({ key: "a", unitPriceCents: 300 })],
        storeDiscounts: [
          { rule: rule({ id: "f", kind: "fixed", percentMpct: null, amountCents: 500 }), lineKey: null },
        ],
      }),
    );
    expect(p.totalCents).toBe(0);
    expect(p.discounts[0]!.amountCents).toBe(300);
  });

  it("spreads across lines so exempt items stay untaxed and cents add up", () => {
    const p = priceSale(
      base({
        lines: [
          line({ key: "taxed", unitPriceCents: 1001 }),
          line({ key: "exempt", unitPriceCents: 500, taxClass: "exempt" }),
        ],
        storeDiscounts: [{ rule: rule({ id: "cash", percentMpct: 3000 }), lineKey: null }],
        taxRateMpct: 7000,
      }),
    );
    // 3% of 1501 = 45.03 → 45, spread 30.01 / 14.99 → 30 / 15 (largest remainder).
    expect(p.discountCents).toBe(45);
    expect(p.lines.map((l) => l.discountCents)).toEqual([30, 15]);
    expect(p.lines.map((l) => l.discountCents).reduce((a, b) => a + b)).toBe(45);
    expect(p.taxableCents).toBe(971);
    expect(p.taxCents).toBe(68);
  });

  it("allows only one whole-ticket discount unless they're combinable", () => {
    const lines = [line({ key: "a" })];
    expect(() =>
      priceSale(
        base({
          lines,
          storeDiscounts: [
            { rule: rule({ id: "emp" }), lineKey: null },
            { rule: rule({ id: "cash", percentMpct: 3000 }), lineKey: null },
          ],
        }),
      ),
    ).toThrow(/Only one whole-ticket discount/);
    const p = priceSale(
      base({
        lines: [line({ key: "a", unitPriceCents: 10000 })],
        storeDiscounts: [
          { rule: rule({ id: "emp", combinable: true }), lineKey: null },
          { rule: rule({ id: "cash", percentMpct: 3000, combinable: true }), lineKey: null },
        ],
      }),
    );
    expect(p.discounts.map((d) => d.amountCents)).toEqual([2000, 240]); // 3% of the $80 left
  });

  it("refuses the same discount twice", () => {
    expect(() =>
      priceSale(
        base({
          lines: [line({ key: "a" })],
          storeDiscounts: [
            { rule: rule({ id: "e", combinable: true }), lineKey: null },
            { rule: rule({ id: "e", combinable: true }), lineKey: null },
          ],
        }),
      ),
    ).toThrow(/already on this ticket/);
  });
});

describe("checks and helpers", () => {
  it("refuses bad quantities and non-integer prices", () => {
    expect(() => priceSale(base({ lines: [line({ key: "a", qty: 0 })] }))).toThrow(/Quantity/);
    expect(() => priceSale(base({ lines: [line({ key: "a", unitPriceCents: 9.99 })] }))).toThrow(TypeError);
  });

  it("adds up exactly with no floats", () => {
    const p = priceSale(
      base({
        lines: [line({ key: "a", unitPriceCents: 10, qty: 3 }), line({ key: "b", unitPriceCents: 20 })],
      }),
    );
    expect(p.totalCents).toBe(50);
    expect(Number.isInteger(p.totalCents)).toBe(true);
  });

  it("works out percents and allocations", () => {
    expect(percentOf(1001, 50_000)).toBe(501); // 500.5 → 501
    expect(allocate(10, [5, 5, 5])).toEqual([4, 3, 3]);
    expect(allocate(2, [1, 1, 1])).toEqual([1, 1, 0]);
    expect(allocate(0, [5, 5])).toEqual([0, 0]);
    expect(allocate(12, [5, 7])).toEqual([5, 7]);
    expect(allocate(99, [1, 1])).toEqual([1, 1]); // never more than a line's own amount
    const shares = allocate(1234, [333, 333, 334, 2000]);
    expect(shares.reduce((a, b) => a + b)).toBe(1234);
  });

  it("gives change and quick cash buttons", () => {
    expect(changeDue(1499, 2000)).toBe(501);
    expect(changeDue(1499, 1000)).toBeNull();
    expect(cashSuggestions(1499)).toEqual([1499, 1500, 2000, 5000]);
    expect(cashSuggestions(2000)).toEqual([2000, 5000, 10000]);
    expect(cashSuggestions(6954)).toEqual([6954, 7000, 8000, 10000]);
  });

  it("labels discount values", () => {
    expect(discountValueLabel({ kind: "percent", percentMpct: 20000, amountCents: null })).toBe("20%");
    expect(discountValueLabel({ kind: "percent", percentMpct: 2500, amountCents: null })).toBe("2.5%");
    expect(discountValueLabel({ kind: "fixed", percentMpct: null, amountCents: 500 })).toBe("$5.00");
  });
});
