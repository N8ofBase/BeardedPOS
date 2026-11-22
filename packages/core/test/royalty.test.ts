import { describe, expect, it } from "vitest";
import {
  centsText,
  royaltyStatements,
  toCsv,
  validateRoyaltyTerms,
  type RoyaltyEntry,
  type RoyaltyTerms,
} from "../src/royalty.ts";

// Fences: $25.00 at the counter and online, $12.50 wholesale, costs us $6.00.
const sale = (
  saleType: RoyaltyEntry["saleType"],
  units: number,
  each: number,
  productId = "fences",
): RoyaltyEntry => ({
  productId,
  saleType,
  units,
  revenueCents: each * units,
  costCents: 600 * units,
});

const designer: RoyaltyTerms = {
  payeeId: "ada",
  productId: "fences",
  basis: "profit",
  rates: { retail: 10_000, online: 10_000, wholesale: 5_000 },
};

describe("royaltyStatements", () => {
  it("pays each sale type at its own rate", () => {
    const [s] = royaltyStatements(
      [sale("retail", 2, 2500), sale("online", 1, 2500), sale("wholesale", 6, 1250)],
      [designer],
    );
    expect(s!.games[0]!.cells).toEqual([
      // $38.00 profit × 10%
      expect.objectContaining({
        saleType: "retail",
        units: 2,
        profitCents: 3800,
        baseCents: 3800,
        royaltyCents: 380,
      }),
      expect.objectContaining({ saleType: "online", units: 1, profitCents: 1900, royaltyCents: 190 }),
      // $39.00 profit × 5%: wholesale earns less
      expect.objectContaining({
        saleType: "wholesale",
        units: 6,
        profitCents: 3900,
        rateMpct: 5_000,
        royaltyCents: 195,
      }),
    ]);
    expect(s!.royaltyCents).toBe(380 + 190 + 195);
  });

  it("can pay on sales instead of profit", () => {
    const [s] = royaltyStatements(
      [sale("retail", 1, 2500), sale("wholesale", 6, 1250)],
      [{ ...designer, basis: "sales", rates: { retail: 3_000, online: 3_000, wholesale: 1_500 } }],
    );
    expect(s!.games[0]!.cells.map((c) => [c.baseCents, c.royaltyCents])).toEqual([
      [2500, 75],
      [7500, 112], // 112.5 rounds down
    ]);
  });

  it("nets refunds in the same period, and pays nothing on a loss", () => {
    const refund: RoyaltyEntry = {
      productId: "fences",
      saleType: "retail",
      units: -1,
      revenueCents: -2500,
      costCents: 0,
    };
    const [s] = royaltyStatements([sale("retail", 1, 2500), refund], [designer]);
    // A copy refunded and not put back: no money in, still cost us $6.00.
    expect(s!.games[0]!.cells[0]).toMatchObject({
      units: 0,
      revenueCents: 0,
      costCents: 600,
      profitCents: -600,
      royaltyCents: 0,
    });
  });

  it("pays several people on one game, and leaves out games that didn't sell", () => {
    const artist: RoyaltyTerms = {
      ...designer,
      payeeId: "sam",
      basis: "sales",
      rates: { retail: 2_000, online: 0, wholesale: 0 },
    };
    const idle: RoyaltyTerms = { ...designer, productId: "locked-out" };
    const out = royaltyStatements(
      [sale("retail", 1, 2500), sale("online", 1, 2500)],
      [designer, artist, idle],
    );
    expect(out.map((s) => [s.payeeId, s.games.length, s.royaltyCents])).toEqual([
      ["ada", 1, 190 + 190],
      ["sam", 1, 50], // 2% of $25 at the counter; 0% online earns nothing
    ]);
  });

  it("refuses amounts that aren't whole cents", () => {
    expect(() =>
      royaltyStatements([{ ...sale("retail", 1, 2500), revenueCents: 10.5 }], [designer]),
    ).toThrow();
  });
});

describe("validateRoyaltyTerms", () => {
  it("wants a basis and every rate from 0 to 100%", () => {
    expect(validateRoyaltyTerms(designer)).toEqual([]);
    expect(
      validateRoyaltyTerms({ basis: "gross", rates: { retail: 100_001, online: 7.5, wholesale: 0 } }),
    ).toEqual([
      "Pick net profit or sales.",
      "Counter rate must be 0 to 100%.",
      "Website rate must be 0 to 100%.",
    ]);
  });
});

describe("csv", () => {
  it("writes amounts without floats, and keeps text from running as a formula", () => {
    expect([centsText(0), centsText(5), centsText(-450), centsText(123456)]).toEqual([
      "0.00",
      "0.05",
      "-4.50",
      "1234.56",
    ]);
    expect(
      toCsv([
        ["Name", "Amount"],
        ['Ada "the" Designer', "-4.50"],
        ["=SUM(A1)", "1,000"],
      ]),
    ).toBe('Name,Amount\r\n"Ada ""the"" Designer",-4.50\r\n\'=SUM(A1),"1,000"\r\n');
  });
});
