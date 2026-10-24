// Store stats: the events the site logs. Anonymous: a random visitor id per browser, no names or emails.

export const EVENT_TYPES = [
  "page_view",
  "click",
  "cart_add",
  "cart_remove",
  "cart_qty",
  "checkout_start",
  "roll",
  "popup_shown",
  "popup_closed",
  "popup_joined",
  "vip_join",
  "review_sent",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export interface StoreEvent {
  type: EventType;
  /** The page it happened on, e.g. "/games/fences". */
  path: string;
  /** What was clicked, or the roll result. */
  label?: string;
  /** Square variation id, for cart events. */
  productId?: string;
  qty?: number;
  /** Where the visitor came from (page_view only): a referrer host or utm_source. */
  source?: string;
}

export interface EventBatch {
  visitorId: string;
  events: StoreEvent[];
}

export const MAX_EVENTS_PER_BATCH = 50;
const clip = (s: unknown, n: number) =>
  typeof s === "string" && s.trim() ? s.trim().slice(0, n) : undefined;

/** Cleans a batch from the browser: unknown types and junk are dropped, text is clipped. */
export function cleanBatch(raw: unknown): EventBatch | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const visitorId = clip(r.visitorId, 64);
  if (!visitorId || !/^[A-Za-z0-9-]+$/.test(visitorId) || !Array.isArray(r.events)) return null;
  const events: StoreEvent[] = [];
  for (const e of r.events.slice(0, MAX_EVENTS_PER_BATCH)) {
    if (typeof e !== "object" || e === null) continue;
    const x = e as Record<string, unknown>;
    if (!EVENT_TYPES.includes(x.type as EventType)) continue;
    const path = clip(x.path, 200);
    if (!path?.startsWith("/")) continue;
    events.push({
      type: x.type as EventType,
      path,
      label: clip(x.label, 80),
      productId: clip(x.productId, 64),
      qty:
        Number.isInteger(x.qty) && (x.qty as number) >= 0 && (x.qty as number) <= 99
          ? (x.qty as number)
          : undefined,
      source: clip(x.source, 80),
    });
  }
  return { visitorId, events };
}
