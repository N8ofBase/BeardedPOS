// Store stats, kept by us instead of Google Analytics. Each browser gets a random visitor id; no
// names, emails or addresses are sent. Visitors whose browser asks not to be tracked aren't.
import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
import { useLocation } from "react-router";
import type { StoreEvent } from "@bearded/store-core";
import { useStore, type StoreApi } from "../api/store.ts";
import { readKey, writeKey } from "../storage.ts";

export const VISITOR_KEY = "bbg.visitor";
const FLUSH_MS = 3000;
/** Staff screens and the checkout preview aren't shopper activity. */
const UNTRACKED = ["/behind-the-beard", "/checkout-preview"];

export type TrackEvent = Omit<StoreEvent, "path"> & { path?: string };

export interface Tracker {
  track(e: TrackEvent): void;
  visitorId: string | undefined;
}

const noTracker: Tracker = { track: () => {}, visitorId: undefined };
const TrackContext = createContext<Tracker>(noTracker);
export const useTracker = () => useContext(TrackContext);

function optedOut(): boolean {
  const n =
    typeof navigator === "undefined"
      ? undefined
      : (navigator as { globalPrivacyControl?: boolean } & Navigator);
  return n?.globalPrivacyControl === true || n?.doNotTrack === "1";
}

function visitorId(): string {
  const saved = readKey("local", VISITOR_KEY);
  if (saved && /^[A-Za-z0-9-]{8,64}$/.test(saved)) return saved;
  const id = crypto.randomUUID();
  writeKey("local", VISITOR_KEY, id);
  return id;
}

const currentPath = () => window.location.pathname;
const untracked = (path: string) => UNTRACKED.some((p) => path === p || path.startsWith(`${p}/`));

/**
 * Batches events and sends them every few seconds, and when the tab is hidden or closed.
 * `start()` arms the timer and listeners and returns the function that sends what's left and disarms them.
 */
export function makeTracker(store: StoreApi): Tracker & { flush(): void; start(): () => void } {
  if (optedOut()) return { ...noTracker, flush: () => {}, start: () => () => {} };
  const id = visitorId();
  let queue: StoreEvent[] = [];
  const flush = () => {
    if (queue.length === 0) return;
    const events = queue;
    queue = [];
    store.track({ visitorId: id, events }).catch(() => {});
  };
  return {
    visitorId: id,
    track: (e) => {
      const path = e.path ?? currentPath();
      if (!untracked(path)) queue.push({ ...e, path });
    },
    flush,
    start: () => {
      const timer = window.setInterval(flush, FLUSH_MS);
      const onHide = () => document.visibilityState === "hidden" && flush();
      document.addEventListener("visibilitychange", onHide);
      window.addEventListener("pagehide", flush);
      return () => {
        flush();
        window.clearInterval(timer);
        document.removeEventListener("visibilitychange", onHide);
        window.removeEventListener("pagehide", flush);
      };
    },
  };
}

/** Where the visitor came from: utm_source, else another site's host. Only on the first page of a visit. */
function source(search: string): string | undefined {
  const utm = new URLSearchParams(search).get("utm_source");
  if (utm) return utm;
  try {
    const host = document.referrer ? new URL(document.referrer).host : "";
    return host && host !== window.location.host ? host.replace(/^www\./, "") : undefined;
  } catch {
    return undefined;
  }
}

/** What a click was on: a data-track label, else the link or button's own words. */
function clickLabel(el: HTMLElement): string | undefined {
  const text = el.dataset.track ?? el.getAttribute("aria-label") ?? el.textContent ?? "";
  const label = text.replace(/\s+/g, " ").trim().slice(0, 80);
  return label || undefined;
}

export function TrackerProvider({ children }: { children: ReactNode }) {
  const store = useStore();
  const tracker = useMemo(() => makeTracker(store), [store]);
  useEffect(() => tracker.start(), [tracker]);

  // Clicks on links and buttons, so staff can see what gets clicked most. Form fields aren't read.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const el = (e.target as HTMLElement | null)?.closest<HTMLElement>("a, button");
      if (!el || el.closest("[data-no-track]")) return;
      const label = clickLabel(el);
      if (label) tracker.track({ type: "click", label });
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [tracker]);

  return (
    <TrackContext.Provider value={tracker}>
      <PageViews tracker={tracker} />
      {children}
    </TrackContext.Provider>
  );
}

function PageViews({ tracker }: { tracker: Tracker }) {
  const { pathname, search } = useLocation();
  // Development runs effects twice; one view per page change.
  const last = useRef("");
  useEffect(() => {
    if (last.current === pathname + search) return;
    last.current = pathname + search;
    const first = readKey("session", "bbg.visit") !== "1";
    writeKey("session", "bbg.visit", "1");
    tracker.track({ type: "page_view", path: pathname, source: first ? source(search) : undefined });
  }, [tracker, pathname, search]);
  return null;
}
