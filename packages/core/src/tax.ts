// Sales tax rates are whole thousandths of a percent ("mpct"): 8.875% = 8875.
// Parsing works on the string, like money, so no float ever touches a rate.

const TAX_RE = /^(\d{1,3})(?:\.(\d{1,3}))?\s*%?$/;

/** "8.875" → 8875, "7" → 7000, "8.25%" → 8250. Null for negatives, over 100%, or more than 3 decimals. */
export function parseTaxPercent(input: string): number | null {
  const m = TAX_RE.exec(input.trim());
  if (!m) return null;
  const mpct = Number(m[1]) * 1000 + Number((m[2] ?? "").padEnd(3, "0"));
  return mpct <= 100_000 ? mpct : null;
}

/** 8875 → "8.875%", 7000 → "7%", 8250 → "8.25%". */
export function formatTaxPercent(mpct: number): string {
  return `${taxPercentInput(mpct)}%`;
}

/** 8875 → "8.875", for an input box. */
export function taxPercentInput(mpct: number): string {
  if (!Number.isSafeInteger(mpct) || mpct < 0)
    throw new TypeError(`Tax rate must be whole thousandths of a percent, got ${mpct}`);
  const whole = Math.trunc(mpct / 1000);
  const frac = String(mpct % 1000)
    .padStart(3, "0")
    .replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : String(whole);
}
