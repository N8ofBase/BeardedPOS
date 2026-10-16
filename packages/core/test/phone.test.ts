import { describe, expect, it } from "vitest";
import { formatPhone, normalizePhone } from "../src/phone.ts";

describe("normalizePhone", () => {
  it.each([
    "(555) 123-4567",
    "+1 555 123 4567",
    "1-555-123-4567",
    "555.123.4567",
    "5551234567",
    " 555 123 4567 ",
  ])("%j → 5551234567", (input) => {
    expect(normalizePhone(input)).toBe("5551234567");
  });

  it.each(["", "555-0100", "123456789012", "25551234567", "phone"])("rejects %j", (input) => {
    expect(normalizePhone(input)).toBeNull();
  });

  it("handles missing values", () => {
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
  });
});

describe("formatPhone", () => {
  it("formats 10 digits for display", () => {
    expect(formatPhone("5551234567")).toBe("(555) 123-4567");
  });

  it("leaves anything else alone", () => {
    expect(formatPhone("")).toBe("");
    expect(formatPhone(null)).toBe("");
    expect(formatPhone("555-0100")).toBe("555-0100");
  });
});
