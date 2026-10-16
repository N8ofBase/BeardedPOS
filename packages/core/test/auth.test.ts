import { describe, expect, it } from "vitest";
import { assertCan, can, isRole, ROLES } from "../src/auth.ts";
import { AppError } from "../src/errors.ts";

describe("permissions", () => {
  it("lets the owner do everything", () => {
    for (const action of [
      "products.edit",
      "customers.delete",
      "settings.edit",
      "staff.manage",
      "demo.remove",
    ] as const)
      expect(can("owner", action)).toBe(true);
  });

  it("matches the spec's roles", () => {
    expect(can("manager", "products.edit")).toBe(true);
    expect(can("manager", "settings.edit")).toBe(false);
    expect(can("cashier", "register.use")).toBe(true);
    expect(can("cashier", "customers.edit")).toBe(true);
    expect(can("cashier", "products.edit")).toBe(false);
    expect(can("cashier", "customers.delete")).toBe(false);
    expect(can("groomer", "grooming.view")).toBe(true);
    expect(can("groomer", "register.use")).toBe(false);
    expect(can("groomer", "products.view")).toBe(false);
  });

  it("throws a plain forbidden error", () => {
    expect(() => assertCan("cashier", "customers.delete")).toThrow(AppError);
    expect(() => assertCan("owner", "customers.delete")).not.toThrow();
  });

  it("recognizes roles", () => {
    for (const r of ROLES) expect(isRole(r)).toBe(true);
    expect(isRole("admin")).toBe(false);
    expect(isRole(undefined)).toBe(false);
  });
});
