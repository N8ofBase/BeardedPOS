import { describe, expect, it } from "vitest";
import { stockLabel, stockStatus } from "../src/catalog.ts";
import { cleanProduct, validateProduct, type ProductInput } from "../src/product.ts";

const base: ProductInput = {
  sku: "0001",
  barcode: null,
  name: "Dog food",
  brand: null,
  category: "Dog food",
  priceCents: 6499,
  costCents: 4300,
  taxClass: "standard",
  reorderAt: 6,
  astroProgramId: null,
  offerLabel: null,
  offerCents: null,
};

describe("stockStatus", () => {
  it("is out at zero or below, low at the reorder point, ok above it", () => {
    expect(stockStatus(0, 5)).toBe("out");
    expect(stockStatus(-2, 5)).toBe("out");
    expect(stockStatus(5, 5)).toBe("low");
    expect(stockStatus(1, 5)).toBe("low");
    expect(stockStatus(6, 5)).toBe("ok");
    expect(stockStatus(3, 0)).toBe("ok");
  });

  it("labels the on-hand tag", () => {
    expect(stockLabel(0, 4)).toBe("Out");
    expect(stockLabel(4, 5)).toBe("4 left");
    expect(stockLabel(14, 6)).toBe("14");
  });
});

describe("validateProduct", () => {
  it("accepts a complete product", () => {
    expect(validateProduct(base)).toEqual({});
  });

  it("explains each problem", () => {
    const e = validateProduct({ ...base, sku: " ", name: "", priceCents: -1, costCents: 1.5, reorderAt: -1 });
    expect(e).toEqual({
      sku: "SKU is required.",
      name: "Name is required.",
      priceCents: "Price can't be negative.",
      costCents: "Enter a cost like 8.50.",
      reorderAt: "Reorder at must be 0 or more.",
    });
  });

  it("needs both halves of an Astro offer", () => {
    expect(validateProduct({ ...base, offerLabel: "$5 off" }).offerCents).toMatch(/offer amount/);
    expect(validateProduct({ ...base, offerCents: 500 }).offerLabel).toMatch(/Describe the offer/);
    expect(validateProduct({ ...base, offerLabel: "$5 off", offerCents: 0 }).offerCents).toMatch(/more than/);
    expect(validateProduct({ ...base, offerLabel: "$5 off", offerCents: 500 })).toEqual({});
  });
});

describe("cleanProduct", () => {
  it("trims text and turns blanks into null", () => {
    const c = cleanProduct({
      ...base,
      sku: " 0001 ",
      barcode: "  ",
      brand: " ",
      offerLabel: "",
      category: " ",
    });
    expect(c).toMatchObject({
      sku: "0001",
      barcode: null,
      brand: null,
      offerLabel: null,
      category: "Supplies",
    });
  });
});
