import { describe, expect, it } from "vitest";
import {
  countTotal,
  depositFor,
  expectedCash,
  importedLabel,
  needsShortNote,
  orderKey,
  orderLine,
  overShortLabel,
} from "../src/index.ts";

describe("drawer count", () => {
  it("adds up bills and coins", () => {
    expect(countTotal({ "2000": 7, "500": 3, "100": 12, "25": 10, "1": 4 })).toBe(
      14000 + 1500 + 1200 + 250 + 4,
    );
    expect(countTotal({})).toBe(0);
    expect(() => countTotal({ "200": 1 })).toThrow(/bill or coin/);
    expect(() => countTotal({ "2000": 1.5 })).toThrow(/whole number/);
    expect(() => countTotal({ "2000": -1 })).toThrow(/whole number/);
  });

  it("works out expected cash, over/short and the deposit", () => {
    expect(expectedCash(10000, 25000, 1390)).toBe(33610);
    expect(overShortLabel(0)).toBe("Even");
    expect(overShortLabel(200)).toBe("Over $2.00");
    expect(overShortLabel(-350)).toBe("Short $3.50");
    expect(depositFor(51235, 10000)).toEqual({ depositCents: 41235, leaveCents: 10000 });
    expect(depositFor(6000, 10000)).toEqual({ depositCents: 0, leaveCents: 6000 });
  });

  it("asks for a note only when short more than $5.00", () => {
    expect(needsShortNote(-500)).toBe(false);
    expect(needsShortNote(-501)).toBe(true);
    expect(needsShortNote(900)).toBe(false);
  });
});

describe("past orders", () => {
  it("keys orders by receipt number, or by date without one", () => {
    expect(orderKey(" #A-1043 ", "2025-03-14")).toBe("A-1043");
    expect(orderKey("", "2025-03-14")).toBe("date:2025-03-14");
    expect(orderKey(undefined, "2025-03-14")).toBe("date:2025-03-14");
    expect(importedLabel("A-1043")).toBe("Imported #A-1043");
    expect(importedLabel("date:2025-03-14")).toBe("Imported order");
  });

  it("parses line money as text, never floats", () => {
    expect(orderLine({ qty: "2", unitPrice: "19.99" })).toEqual({
      qty: 2,
      unitPriceCents: 1999,
      discountCents: 0,
      lineTotalCents: 3998,
    });
    // A discount in the old system: the total wins.
    expect(orderLine({ qty: "2", unitPrice: "19.99", lineTotal: "35.00" })).toMatchObject({
      discountCents: 498,
      lineTotalCents: 3500,
    });
    // Only a total: the unit price is worked out so unit × qty − discount = total.
    expect(orderLine({ qty: "3", lineTotal: "10.00" })).toEqual({
      qty: 3,
      unitPriceCents: 334,
      discountCents: 2,
      lineTotalCents: 1000,
    });
    expect(orderLine({ lineTotal: "$1,234.50" })).toMatchObject({ qty: 1, lineTotalCents: 123450 });
    expect(orderLine({ qty: "1" })).toBe("Needs a unit price or line total");
    expect(orderLine({ qty: "1.5", lineTotal: "3" })).toBe("Quantity isn't a whole number");
    expect(orderLine({ unitPrice: "abc" })).toBe("Unit price isn't an amount");
  });
});
