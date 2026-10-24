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
  /** What a retailer pays; null when not sold wholesale. Left out: unchanged. */
  wholesaleCents?: number | null;
  /** Royalty on net profit, thousandths of a percent (7.5% = 7500). Left out: unchanged. */
  royaltyMpct?: number;
  /** Who the royalty is paid to. Left out: unchanged. */
  royaltyPayee?: string | null;
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
    ...(input.royaltyPayee !== undefined ? { royaltyPayee: blankToNull(input.royaltyPayee) } : {}),
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
  else if (p.costCents < 0) e.costCents = "Our cost can't be negative.";
  if (p.wholesaleCents != null) {
    if (!isCents(p.wholesaleCents)) e.wholesaleCents = "Enter a wholesale price like 15.00.";
    else if (p.wholesaleCents < 0) e.wholesaleCents = "Wholesale price can't be negative.";
  }
  if (
    p.royaltyMpct !== undefined &&
    (!Number.isInteger(p.royaltyMpct) || p.royaltyMpct < 0 || p.royaltyMpct > 100_000)
  )
    e.royaltyMpct = "Royalty must be 0 to 100%.";
  if (p.royaltyPayee && p.royaltyPayee.trim().length > 100)
    e.royaltyPayee = "Royalty payee can be at most 100 characters.";
  if (!Number.isInteger(p.reorderAt) || p.reorderAt < 0) e.reorderAt = "Reorder at must be 0 or more.";
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
