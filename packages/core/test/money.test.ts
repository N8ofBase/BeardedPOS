import { describe, expect, it } from "vitest";
import { centsToInput, formatMoney, marginPercent, parseMoney } from "../src/money.ts";

describe("parseMoney", () => {
  it.each([
    ["12.3", 1230],
    ["12.30", 1230],
    ["12", 1200],
    [".5", 50],
    ["0.99", 99],
    ["$1,234.56", 123456],
    ["  $ 64.99 ", 6499],
    ["1000000", 100000000],
  ])("%s → %i cents", (input, cents) => {
    expect(parseMoney(input)).toBe(cents);
  });

  it.each(["", "abc", "1.234", "-1", "1,23", "12.", "$", "1e3", "12.3.4", "99999999999999999"])(
    "rejects %j",
    (input) => {
      expect(parseMoney(input)).toBeNull();
    },
  );

  it("adds exactly, unlike floats", () => {
    expect(parseMoney("0.1")! + parseMoney("0.2")!).toBe(30);
  });
});

describe("formatMoney", () => {
  it("formats cents with grouping", () => {
    expect(formatMoney(0)).toBe("$0.00");
    expect(formatMoney(5)).toBe("$0.05");
    expect(formatMoney(6499)).toBe("$64.99");
    expect(formatMoney(123456)).toBe("$1,234.56");
    expect(formatMoney(-500)).toBe("-$5.00");
  });

  it("refuses non-integers", () => {
    expect(() => formatMoney(12.5)).toThrow(TypeError);
  });

  it("round-trips through the input format", () => {
    for (const c of [0, 7, 99, 100, 6499, 123456]) expect(parseMoney(centsToInput(c))).toBe(c);
  });
});

describe("marginPercent", () => {
  it("rounds to a whole percent", () => {
    expect(marginPercent(6499, 4300)).toBe(34);
    expect(marginPercent(1000, 1000)).toBe(0);
    expect(marginPercent(1000, 1200)).toBe(-20);
  });

  it("is null without a price", () => {
    expect(marginPercent(0, 100)).toBeNull();
  });
});
