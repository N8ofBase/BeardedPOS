// Product categories and stock status, for a board game shop.

export const CATEGORIES = [
  "Strategy games",
  "Family games",
  "Party games",
  "Card games",
  "Cooperative games",
  "Kids' games",
  "Puzzles",
  "Accessories",
  "Other",
] as const;

/**
 * The ways one barcode can be stored. Scanners and cameras read a 12-digit UPC-A as
 * EAN-13 with a leading 0 (012345678905 ↔ 0012345678905), so both forms match.
 */
export function barcodeVariants(code: string): string[] {
  const c = code.trim();
  if (/^\d{12}$/.test(c)) return [c, `0${c}`];
  if (/^0\d{12}$/.test(c)) return [c, c.slice(1)];
  return [c];
}

export type StockStatus = "out" | "low" | "ok";

/** Out at zero or below; low at or under the reorder point; otherwise ok. */
export function stockStatus(onHand: number, reorderAt: number): StockStatus {
  if (onHand <= 0) return "out";
  if (onHand <= reorderAt) return "low";
  return "ok";
}

/** "Out", "4 left" or "14", for the on-hand tag. */
export function stockLabel(onHand: number, reorderAt: number): string {
  const s = stockStatus(onHand, reorderAt);
  return s === "out" ? "Out" : s === "low" ? `${onHand} left` : String(onHand);
}
