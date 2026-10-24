// Customer sign-in with a one-time code: the code rules and how a phone or email
// is read. Pure functions; the public handlers store only hashes.

/** Sign-in code rules. */
export const CODE_RULES = {
  digits: 6,
  expiresMinutes: 10,
  maxTries: 5,
  /** Codes one phone or email can ask for. */
  perMinute: 1,
  perHour: 5,
  sessionDays: 30,
} as const;

/** "482913" from random bytes, so every code has 6 digits. */
export function codeFromBytes(bytes: Uint8Array): string {
  const n = ((bytes[0]! << 16) | (bytes[1]! << 8) | bytes[2]!) % 1_000_000;
  return String(n).padStart(CODE_RULES.digits, "0");
}

/** A phone (10 digits) or an email (lower case), or null when it's neither. */
export function normalizeContact(input: string): { kind: "phone" | "email"; value: string } | null {
  const t = input.trim();
  if (/@/.test(t)) {
    const e = t.toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? { kind: "email", value: e } : null;
  }
  let d = t.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  return d.length === 10 ? { kind: "phone", value: d } : null;
}
