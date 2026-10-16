import { assertCents } from "./money.ts";

export interface ProductInput {
  sku: string;
  barcode: string | null;
  name: string;
  brand: string | null;
  category: string;
  priceCents: number;
  costCents: number;
  taxClass: "standard" | "exempt";
  reorderAt: number;
  astroProgramId: string | null;
  offerLabel: string | null;
  offerCents: number | null;
}

export type FieldErrors<T> = Partial<Record<keyof T, string>>;

const blankToNull = (s: string | null | undefined) => {
  const t = (s ?? "").trim();
  return t ? t : null;
};

/** Trims text fields and turns blanks into null, so " " never becomes a barcode. */
export function cleanProduct(input: ProductInput): ProductInput {
  return {
    ...input,
    sku: input.sku.trim(),
    barcode: blankToNull(input.barcode),
    name: input.name.trim(),
    brand: blankToNull(input.brand),
    category: input.category.trim() || "Supplies",
    offerLabel: blankToNull(input.offerLabel),
  };
}

/** Plain-English problems by field. Empty when the product can be saved. */
export function validateProduct(p: ProductInput): FieldErrors<ProductInput> {
  const e: FieldErrors<ProductInput> = {};
  if (!p.sku.trim()) e.sku = "SKU is required.";
  else if (p.sku.trim().length > 64) e.sku = "SKU can be at most 64 characters.";
  if (!p.name.trim()) e.name = "Name is required.";
  if (!isCents(p.priceCents)) e.priceCents = "Enter a price like 12.99.";
  else if (p.priceCents < 0) e.priceCents = "Price can't be negative.";
  if (!isCents(p.costCents)) e.costCents = "Enter a cost like 8.50.";
  else if (p.costCents < 0) e.costCents = "Cost can't be negative.";
  if (!Number.isInteger(p.reorderAt) || p.reorderAt < 0) e.reorderAt = "Reorder at must be 0 or more.";
  const hasLabel = !!p.offerLabel?.trim();
  const hasAmount = p.offerCents !== null;
  if (hasAmount && (!isCents(p.offerCents!) || p.offerCents! <= 0))
    e.offerCents = "Offer amount must be more than $0.";
  else if (hasLabel && !hasAmount) e.offerCents = "Enter the offer amount, or clear the offer label.";
  else if (hasAmount && !hasLabel) e.offerLabel = "Describe the offer, for example $5 off 24 lb bag.";
  return e;
}

function isCents(n: number): boolean {
  try {
    assertCents(n);
    return true;
  } catch {
    return false;
  }
}
