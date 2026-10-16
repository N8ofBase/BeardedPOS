// Product categories and stock status, as in the prototype's Inventory tab.

export const CATEGORIES = [
  "Dog food",
  "Cat food",
  "Treats",
  "Supplies",
  "Small animal",
  "Fish",
  "Bird",
] as const;

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
