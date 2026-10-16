// Phones are stored as 10 digits and formatted only for display.

/** "(555) 123-4567", "+1 555 123 4567" → "5551234567". Null when it isn't a 10-digit US number. */
export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  let d = input.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  return d.length === 10 ? d : null;
}

/** "5551234567" → "(555) 123-4567". Anything else is returned as-is. */
export function formatPhone(stored: string | null | undefined): string {
  if (!stored) return "";
  return /^\d{10}$/.test(stored)
    ? `(${stored.slice(0, 3)}) ${stored.slice(3, 6)}-${stored.slice(6)}`
    : stored;
}
