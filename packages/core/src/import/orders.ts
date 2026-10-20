// Past orders from the old system: one row per item. Rows for the same customer and
// receipt number (or the same date, when there's no number) make one order.
import { parseMoney } from "../money.ts";
import { parseCount } from "./values.ts";

/** The key an imported order is stored under: the old receipt number, or "date:YYYY-MM-DD". */
export function orderKey(receipt: string | undefined, date: string): string {
  const r = receipt?.trim().replace(/^#/, "");
  return r ? r : `date:${date}`;
}

/** "Imported #A-1043", or "Imported order" when the file had no number. */
export function importedLabel(key: string | null): string {
  if (!key || key.startsWith("date:")) return "Imported order";
  return `Imported #${key}`;
}

export interface OrderLine {
  qty: number;
  unitPriceCents: number;
  /** unit × qty − line total, when the old system took something off. */
  discountCents: number;
  lineTotalCents: number;
}

/**
 * Money for one line, parsed as text (never floats). The line total comes from the
 * file; without one it's unit price × quantity. Returns an error message when neither is usable.
 */
export function orderLine(r: { qty?: string; unitPrice?: string; lineTotal?: string }): OrderLine | string {
  const q = parseCount(r.qty ?? "");
  // parseCount: null for a blank cell (1 unit), undefined when it can't be read.
  if (q === undefined) return "Quantity isn't a whole number";
  const qty = q ?? 1;
  if (qty < 1 || qty > 9999) return "Quantity must be 1 to 9999";
  const unit = r.unitPrice?.trim() ? parseMoney(r.unitPrice) : undefined;
  if (unit === null) return "Unit price isn't an amount";
  const total = r.lineTotal?.trim() ? parseMoney(r.lineTotal) : undefined;
  if (total === null) return "Line total isn't an amount";
  if (total === undefined && unit === undefined) return "Needs a unit price or line total";
  const lineTotal = total ?? unit! * qty;
  // Stored as unit × qty − discount = line total, so a total above unit × qty raises the unit price.
  let unitPrice = unit ?? Math.ceil(lineTotal / qty);
  if (unitPrice * qty < lineTotal) unitPrice = Math.ceil(lineTotal / qty);
  return {
    qty,
    unitPriceCents: unitPrice,
    discountCents: unitPrice * qty - lineTotal,
    lineTotalCents: lineTotal,
  };
}
