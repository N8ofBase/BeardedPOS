// Staff PINs for the counter tablet: the rules a PIN must meet and how long a lockout lasts.
// Pure functions; the server keeps only salted hashes.

export const PIN_RULES = {
  minDigits: 4,
  maxDigits: 6,
  /** Wrong tries in a row before that person's PIN is locked. */
  maxTries: 5,
  lockMinutes: 15,
  /** A tablet set up for PINs stays set up this long. */
  tabletDays: 90,
  /** The register locks itself after this long with no taps on a PIN tablet. */
  idleMinutes: 15,
} as const;

/** "1111", "1234" and "9876" are the first guesses anyone makes. */
function isEasyToGuess(pin: string): boolean {
  const d = [...pin].map(Number);
  const steps = d.slice(1).map((n, i) => n - d[i]!);
  return steps.every((s) => s === 0) || steps.every((s) => s === 1) || steps.every((s) => s === -1);
}

/** Why a PIN can't be used, or null when it's fine. */
export function pinProblem(pin: string): string | null {
  if (!/^\d+$/.test(pin) || pin.length < PIN_RULES.minDigits || pin.length > PIN_RULES.maxDigits)
    return `A PIN is ${PIN_RULES.minDigits} to ${PIN_RULES.maxDigits} digits.`;
  if (isEasyToGuess(pin)) return "Pick a PIN that's harder to guess than 1111 or 1234.";
  return null;
}
