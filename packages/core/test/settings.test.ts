import { describe, expect, it } from "vitest";
import { isHexColor, readableOn } from "../src/color.ts";
import { formatTaxPercent, parseTaxPercent, taxPercentInput } from "../src/tax.ts";

describe("sales tax", () => {
  it.each([
    ["8.875", 8875],
    ["7", 7000],
    ["8.25%", 8250],
    ["0", 0],
    ["100", 100000],
    [" 6.5 % ", 6500],
    ["10.25", 10250],
    ["9.525", 9525],
  ])("%j → %i", (input, mpct) => {
    expect(parseTaxPercent(input)).toBe(mpct);
  });

  it.each(["-1", "100.001", "8.8755", "abc", "", "1000", "8,25"])("refuses %j", (input) => {
    expect(parseTaxPercent(input)).toBeNull();
  });

  it("formats and round-trips", () => {
    expect(formatTaxPercent(8875)).toBe("8.875%");
    expect(formatTaxPercent(7000)).toBe("7%");
    expect(formatTaxPercent(8250)).toBe("8.25%");
    expect(formatTaxPercent(0)).toBe("0%");
    for (const m of [0, 1, 500, 7000, 8875, 9525, 100000])
      expect(parseTaxPercent(taxPercentInput(m))).toBe(m);
  });

  it("refuses non-integer rates", () => {
    expect(() => formatTaxPercent(8.5)).toThrow(TypeError);
  });
});

describe("brand color", () => {
  it("checks hex colors", () => {
    expect(isHexColor("#0f6e5a")).toBe(true);
    expect(isHexColor("0f6e5a")).toBe(false);
    expect(isHexColor("#fff")).toBe(false);
  });

  it("picks readable text", () => {
    expect(readableOn("#0f6e5a")).toBe("#ffffff");
    expect(readableOn("#000000")).toBe("#ffffff");
    expect(readableOn("#ffeb3b")).toBe("#18211e");
    expect(readableOn("#ffffff")).toBe("#18211e");
  });
});
