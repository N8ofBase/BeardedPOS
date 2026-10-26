// When the Beard Buddy popup may appear. Pure, so the rules are easy to test and to change.

/** Pages where the popup would get in the way of buying or of staff work. */
export const QUIET_PATHS = ["/cart", "/checkout", "/thanks", "/behind-the-beard"];

/** How long closing the popup keeps it away. */
export const SNOOZE_DAYS = 30;
/** Seconds on the site before it appears. */
export const DELAY_SECONDS = 20;
/** Or this share of the page scrolled, whichever comes first. */
export const SCROLL_SHARE = 0.5;

export interface PopupMemory {
  joined?: boolean;
  /** ms since epoch; the popup stays away until then. */
  snoozedUntil?: number;
}

export function popupAllowed(opts: {
  path: string;
  now: number;
  memory: PopupMemory;
  shownThisVisit: boolean;
}): boolean {
  if (opts.memory.joined || opts.shownThisVisit) return false;
  if (opts.memory.snoozedUntil && opts.now < opts.memory.snoozedUntil) return false;
  return !QUIET_PATHS.some((p) => opts.path === p || opts.path.startsWith(`${p}/`));
}

export const snoozeUntil = (now: number) => now + SNOOZE_DAYS * 24 * 60 * 60 * 1000;

export function parseMemory(raw: string | null): PopupMemory {
  try {
    const v: unknown = raw ? JSON.parse(raw) : {};
    if (typeof v !== "object" || v === null) return {};
    const m = v as Record<string, unknown>;
    return {
      joined: m.joined === true,
      ...(typeof m.snoozedUntil === "number" ? { snoozedUntil: m.snoozedUntil } : {}),
    };
  } catch {
    return {};
  }
}
