import { afterEach, describe, expect, it, vi } from "vitest";
import type { EventBatch } from "@bearded/store-core";
import { makeTracker, VISITOR_KEY } from "../src/track/Tracker.tsx";
import { fakeStore } from "./render.tsx";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
});

function setup() {
  const sent: EventBatch[] = [];
  const tracker = makeTracker(fakeStore({ track: async (b) => void sent.push(b) }));
  const stop = tracker.start();
  return { sent, tracker, stop };
}

describe("store stats tracker", () => {
  it("batches events under one anonymous visitor id and sends them every few seconds", () => {
    vi.useFakeTimers();
    const { sent, tracker, stop } = setup();
    tracker.track({ type: "page_view", path: "/shop" });
    tracker.track({ type: "click", label: "Add Locked Out to cart", path: "/shop" });
    expect(sent).toHaveLength(0);
    vi.advanceTimersByTime(3000);
    expect(sent).toEqual([
      {
        visitorId: localStorage.getItem(VISITOR_KEY),
        events: [
          { type: "page_view", path: "/shop" },
          { type: "click", label: "Add Locked Out to cart", path: "/shop" },
        ],
      },
    ]);
    stop();
  });

  it("leaves out staff pages and the checkout preview", () => {
    const { sent, tracker, stop } = setup();
    tracker.track({ type: "page_view", path: "/behind-the-beard" });
    tracker.track({ type: "page_view", path: "/checkout-preview/abc" });
    stop();
    expect(sent).toHaveLength(0);
  });

  it("sends nothing when the browser asks not to be tracked", () => {
    vi.stubGlobal("navigator", { ...navigator, globalPrivacyControl: true });
    const { sent, tracker } = setup();
    tracker.track({ type: "page_view", path: "/" });
    tracker.flush();
    expect(sent).toHaveLength(0);
    expect(tracker.visitorId).toBeUndefined();
  });
});
