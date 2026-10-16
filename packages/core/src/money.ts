// Money is always integer cents. Parsing works on the string so no float ever touches a price.

const MONEY_RE = /^\$?\s*(\d{1,3}(?:,\d{3})+|\d+)?(?:\.(\d{1,2}))?$/;

/** "12.3" → 1230, "$1,234.56" → 123456. Returns null for anything that isn't a plain, non-negative amount. */
export function parseMoney(input: string): number | null {
  const s = input.trim();
  const m = MONEY_RE.exec(s);
  if (!m) return null;
  const whole = m[1];
  const frac = m[2];
  if (whole === undefined && frac === undefined) return null;
  const dollars = whole ? Number(whole.replace(/,/g, "")) : 0;
  const cents = frac ? Number(frac.padEnd(2, "0")) : 0;
  const total = dollars * 100 + cents;
  return Number.isSafeInteger(total) ? total : null;
}

/** 123456 → "$1,234.56"; -500 → "-$5.00". */
export function formatMoney(cents: number): string {
  assertCents(cents);
  const abs = Math.abs(cents);
  const dollars = Math.trunc(abs / 100).toLocaleString("en-US");
  const rest = String(abs % 100).padStart(2, "0");
  return `${cents < 0 ? "-" : ""}$${dollars}.${rest}`;
}

/** Cents → "12.30" for an input field. */
export function centsToInput(cents: number): string {
  assertCents(cents);
  const abs = Math.abs(cents);
  return `${cents < 0 ? "-" : ""}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** Whole-number margin percent, or null when there's no price. */
export function marginPercent(priceCents: number, costCents: number): number | null {
  assertCents(priceCents);
  assertCents(costCents);
  if (priceCents <= 0) return null;
  return Math.round(((priceCents - costCents) * 100) / priceCents);
}

export function assertCents(value: number): void {
  if (!Number.isSafeInteger(value)) throw new TypeError(`Money must be integer cents, got ${value}`);
}
