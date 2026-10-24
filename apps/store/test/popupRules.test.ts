import { describe, expect, it } from "vitest";
import { parseMemory, popupAllowed, snoozeUntil, SNOOZE_DAYS } from "../src/vip/popupRules.ts";

const now = Date.UTC(2026, 9, 24);
const base = { path: "/", now, memory: {}, shownThisVisit: false };

describe("VIP popup rules", () => {
  it("shows to a new visitor", () => {
    expect(popupAllowed(base)).toBe(true);
    expect(popupAllowed({ ...base, path: "/games/fences" })).toBe(true);
  });

  it("shows once per visit", () => {
    expect(popupAllowed({ ...base, shownThisVisit: true })).toBe(false);
  });

  it("never shows during checkout or on staff pages", () => {
    for (const path of ["/cart", "/checkout", "/thanks", "/behind-the-beard", "/behind-the-beard/stats"])
      expect(popupAllowed({ ...base, path })).toBe(false);
  });

  it("never shows to someone who joined", () => {
    expect(popupAllowed({ ...base, memory: { joined: true } })).toBe(false);
  });

  it("stays away for 30 days after it's closed", () => {
    const memory = { snoozedUntil: snoozeUntil(now) };
    expect(SNOOZE_DAYS).toBe(30);
    expect(popupAllowed({ ...base, memory, now: now + 29 * 864e5 })).toBe(false);
    expect(popupAllowed({ ...base, memory, now: now + 30 * 864e5 })).toBe(true);
  });

  it("reads saved memory defensively", () => {
    expect(parseMemory(null)).toEqual({ joined: false });
    expect(parseMemory("junk")).toEqual({});
    expect(parseMemory('{"joined":"yes","snoozedUntil":"soon"}')).toEqual({ joined: false });
    expect(parseMemory('{"snoozedUntil":5}')).toEqual({ joined: false, snoozedUntil: 5 });
  });
});
