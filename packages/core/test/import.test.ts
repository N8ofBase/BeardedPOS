import { describe, expect, it } from "vitest";
import {
  autoMatch,
  IMPORT_TYPE_KEYS,
  IMPORT_TYPES,
  mapRows,
  mappingProblems,
  nonEmptyRows,
  normalizeHeader,
  normalizeZip,
  parseCount,
  parseLooseDate,
  parseYesNo,
  templateCsv,
} from "../src/import/index.ts";

describe("column matching", () => {
  it("normalizes headers", () => {
    expect(normalizeHeader(" Phone # ")).toBe("phone");
    expect(normalizeHeader("phone_number")).toBe("phone number");
    expect(normalizeHeader("E-mail")).toBe("e mail");
  });

  it("matches customer columns by alias, ignoring case and punctuation", () => {
    const headers = [
      "First Name",
      "Last Name",
      "Mobile",
      "E-mail",
      "Address 1",
      "Town",
      "ST",
      "Zip Code",
      "DOB",
      "Texts OK",
    ];
    expect(autoMatch("customers", headers)).toEqual({
      first: 0,
      last: 1,
      phone: 2,
      email: 3,
      street: 4,
      city: 5,
      state: 6,
      zip: 7,
      birthday: 8,
      smsOptIn: 9,
    });
  });

  it("matches the three game prices and the royalty columns", () => {
    const headers = ["SKU", "Sell price", "Wholesale", "Unit cost", "Royalty %", "Designer"];
    expect(autoMatch("products", headers)).toEqual({
      sku: 0,
      price: 1,
      wholesale: 2,
      cost: 3,
      royalty: 4,
      royaltyPayee: 5,
    });
    // An older file with plain "Cost" still lands on our cost.
    expect(autoMatch("products", ["SKU", "Price", "Cost"])).toEqual({ sku: 0, price: 1, cost: 2 });
  });

  it("uses each column once", () => {
    // "Name" and "Description" both fit the product name; only the first is used.
    expect(autoMatch("products", ["Name", "Description"])).toEqual({ name: 0 });
  });

  it("says what still has to be picked", () => {
    expect(mappingProblems("products", {})).toEqual(["Pick the SKU or barcode column."]);
    expect(mappingProblems("products", { barcode: 0 })).toEqual([]);
    expect(mappingProblems("customers", { first: 0 })).toEqual([
      "Pick the phone or email column, so customers can be matched.",
    ]);
  });

  it("maps rows to fields and drops blank rows", () => {
    const rows = nonEmptyRows([["Pat", " 2125550199 "], ["", ""], ["Sam"]]);
    expect(mapRows(rows, { name: 0, phone: 1 })).toEqual([
      { name: "Pat", phone: "2125550199" },
      { name: "Sam", phone: "" },
    ]);
  });

  it("auto-matches every template back to its own fields", () => {
    for (const type of IMPORT_TYPE_KEYS) {
      const [header] = templateCsv(type).split("\r\n");
      const headers = header!.split(",");
      const mapping = autoMatch(type, headers);
      expect(Object.keys(mapping).length).toBe(headers.length);
      expect(mappingProblems(type, mapping)).toEqual([]);
    }
  });

  it("describes every type", () => {
    for (const type of IMPORT_TYPE_KEYS) expect(IMPORT_TYPES[type].help.length).toBeGreaterThan(20);
  });
});

describe("cell values", () => {
  const today = "2026-10-15";

  it("reads dates in common formats", () => {
    expect(parseLooseDate("2024-03-07", today)).toBe("2024-03-07");
    expect(parseLooseDate("2024/3/7", today)).toBe("2024-03-07");
    expect(parseLooseDate("3/7/2024", today)).toBe("2024-03-07");
    expect(parseLooseDate("3-7-2024", today)).toBe("2024-03-07");
    expect(parseLooseDate("2024-03-07T00:00:00", today)).toBe("2024-03-07");
    expect(parseLooseDate("", today)).toBeNull();
  });

  it("puts two-digit years in this century unless that's the future", () => {
    expect(parseLooseDate("4/12/85", today)).toBe("1985-04-12");
    expect(parseLooseDate("4/12/24", today)).toBe("2024-04-12");
    expect(parseLooseDate("4/12/26", today)).toBe("2026-04-12");
    expect(parseLooseDate("4/12/27", today)).toBe("1927-04-12");
  });

  it("refuses impossible dates", () => {
    expect(parseLooseDate("13/45/90", today)).toBeUndefined();
    expect(parseLooseDate("2/30/2024", today)).toBeUndefined();
    expect(parseLooseDate("next tuesday", today)).toBeUndefined();
  });

  it("reads yes and no", () => {
    for (const s of ["yes", "Y", "TRUE", "1", "x"]) expect(parseYesNo(s)).toBe(true);
    for (const s of ["no", "N", "false", "0"]) expect(parseYesNo(s)).toBe(false);
    expect(parseYesNo(" ")).toBeNull();
    expect(parseYesNo("maybe")).toBeUndefined();
  });

  it("reads counts", () => {
    expect(parseCount("12")).toBe(12);
    expect(parseCount("1,200")).toBe(1200);
    expect(parseCount("3.0")).toBe(3);
    expect(parseCount("2.5")).toBeUndefined();
    expect(parseCount("-1")).toBeUndefined();
    expect(parseCount("")).toBeNull();
  });

  it("puts back ZIP leading zeros Excel dropped", () => {
    expect(normalizeZip("2134")).toBe("02134");
    expect(normalizeZip("62701")).toBe("62701");
    expect(normalizeZip("627011234")).toBe("62701-1234");
    expect(normalizeZip("ABC")).toBeUndefined();
  });
});
