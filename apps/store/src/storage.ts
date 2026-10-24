// Browser storage for per-visitor conveniences (cart, popup snooze). Private windows and blocked
// storage throw or come back empty, so every read and write is guarded and the site works without it.
type Area = "local" | "session";

const area = (which: Area): Storage | null => {
  try {
    return which === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
};

export function readKey(which: Area, key: string): string | null {
  try {
    return area(which)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeKey(which: Area, key: string, value: string | null): void {
  try {
    const s = area(which);
    if (value === null) s?.removeItem(key);
    else s?.setItem(key, value);
  } catch {
    // Storage full or blocked: the cart still works for this page view.
  }
}
