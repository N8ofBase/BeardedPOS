import { describe, expect, it } from "vitest";
import { addProfit, lineProfit, NO_PROFIT, royaltyCents, type ProfitLine } from "../src/profit.ts";

const line: ProfitLine = {
  qty: 3,
  lineTotalCents: 7500,
  unitCostCents: 1900,
  refundedCents: 0,
  restockedQty: 0,
  writtenOffQty: 0,
};

describe("lineProfit", () => {
  it("is what was paid less our cost for every unit", () => {
    expect(lineProfit(line)).toEqual({ units: 3, revenueCents: 7500, costCents: 5700, profitCents: 1800 });
  });

  it("uses what was paid after discounts", () => {
    expect(lineProfit({ ...line, lineTotalCents: 6750 }).profitCents).toBe(1050);
  });

  it("gives back the cost of a refunded unit that went back on the shelf", () => {
    expect(lineProfit({ ...line, refundedCents: 2500, restockedQty: 1 })).toEqual({
      units: 2,
      revenueCents: 5000,
      costCents: 3800,
      profitCents: 1200,
    });
  });

  it("keeps the cost of a refunded unit that couldn't be resold", () => {
    expect(lineProfit({ ...line, refundedCents: 2500, writtenOffQty: 1 })).toEqual({
      units: 2,
      revenueCents: 5000,
      costCents: 5700,
      profitCents: -700,
    });
  });

  it("refuses fractions of a cent", () => {
    expect(() => lineProfit({ ...line, unitCostCents: 19.5 })).toThrow(TypeError);
  });
});

describe("addProfit", () => {
  it("adds every part", () => {
    const a = lineProfit(line);
    expect(addProfit(NO_PROFIT, a)).toEqual(a);
    expect(addProfit(a, a)).toEqual({ units: 6, revenueCents: 15000, costCents: 11400, profitCents: 3600 });
  });
});

describe("royaltyCents", () => {
  it("is the rate on net profit, rounded down to the cent", () => {
    expect(royaltyCents(1800, 10_000)).toBe(180);
    expect(royaltyCents(1999, 7_500)).toBe(149); // 149.925
    expect(royaltyCents(1800, 100_000)).toBe(1800);
  });

  it("is nothing with no profit or no rate", () => {
    expect(royaltyCents(0, 10_000)).toBe(0);
    expect(royaltyCents(-700, 10_000)).toBe(0);
    expect(royaltyCents(1800, 0)).toBe(0);
  });

  it("refuses a rate outside 0 to 100%", () => {
    expect(() => royaltyCents(1800, 100_001)).toThrow(RangeError);
    expect(() => royaltyCents(1800, -1)).toThrow(RangeError);
    expect(() => royaltyCents(1800, 7.5)).toThrow(RangeError);
  });
});
