import { describe, expect, it } from "vitest";
import {
  autoMatch,
  fieldsFor,
  IMPORT_TYPE_KEYS,
  IMPORT_TYPES,
  mapRows,
  mappingProblems,
  nonEmptyRows,
  normalizeHeader,
  normalizeZip,
  parseCount,
  parseLooseDate,
  parsePetsCell,
  parseSize,
  parseSpecies,
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

  it("finds numbered pet columns", () => {
    const headers = ["Name", "Phone", "Pet 1 Name", "Pet 1 Breed", "Pet 1 Type", "Pet 2 name", "pet2 dob"];
    expect(
      fieldsFor("customers", headers)
        .slice(-5)
        .map((f) => f.key),
    ).toEqual(["pet1.breed", "pet1.name", "pet1.type", "pet2.birthday", "pet2.name"]);
    expect(autoMatch("customers", headers)).toMatchObject({
      name: 0,
      phone: 1,
      "pet1.name": 2,
      "pet1.breed": 3,
      "pet1.type": 4,
      "pet2.name": 5,
      "pet2.birthday": 6,
    });
  });

  it("uses each column once", () => {
    // "Phone" fits both the owner phone and nothing else; "Email" is free for owner email.
    expect(autoMatch("pets", ["Phone", "Email", "Name"])).toEqual({
      ownerPhone: 0,
      ownerEmail: 1,
      petName: 2,
    });
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

  it("reads species, keeping other animals as the breed hint", () => {
    expect(parseSpecies("Puppy")).toEqual({ species: "dog", hint: null });
    expect(parseSpecies("kitten")).toEqual({ species: "cat", hint: null });
    expect(parseSpecies("Rabbit")).toEqual({ species: "other", hint: "Rabbit" });
    expect(parseSpecies("")).toBeNull();
  });

  it("reads sizes", () => {
    expect(parseSize("small")).toBe("S");
    expect(parseSize("Med")).toBe("M");
    expect(parseSize("X-Large")).toBe("XL");
    expect(parseSize("huge-ish")).toBeUndefined();
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

  it("reads the prototype's pets cell", () => {
    expect(parsePetsCell("Biscuit (beagle), Mo (cat), Clover (rabbit), Rex, Pip (dog, shih tzu)")).toEqual([
      { name: "Biscuit", species: "dog", breed: "beagle" },
      { name: "Mo", species: "cat", breed: null },
      { name: "Clover", species: "other", breed: "rabbit" },
      { name: "Rex", species: null, breed: null },
      { name: "Pip", species: "dog", breed: "shih tzu" },
    ]);
    expect(parsePetsCell("")).toEqual([]);
  });
});
