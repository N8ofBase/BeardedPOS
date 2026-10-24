import { describe, expect, it } from "vitest";
import { codeFromBytes, normalizeContact } from "../src/index.ts";

describe("sign-in codes", () => {
  it("makes six-digit codes and reads phones and emails", () => {
    expect(codeFromBytes(new Uint8Array([0, 0, 7]))).toBe("000007");
    expect(codeFromBytes(new Uint8Array([255, 255, 255]))).toMatch(/^\d{6}$/);
    expect(normalizeContact(" (212) 555-0100 ")).toEqual({ kind: "phone", value: "2125550100" });
    expect(normalizeContact("+1 212 555 0100")).toEqual({ kind: "phone", value: "2125550100" });
    expect(normalizeContact("Pat@Example.com")).toEqual({ kind: "email", value: "pat@example.com" });
    expect(normalizeContact("555-0100")).toBeNull();
    expect(normalizeContact("pat@")).toBeNull();
  });
});
