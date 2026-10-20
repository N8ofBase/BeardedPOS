import { describe, expect, it } from "vitest";
import {
  atLocal,
  canStep,
  clockText,
  durationText,
  minutesOfDay,
  minutesToTime,
  nextSteps,
  overlaps,
  quoteAppointment,
  quoteText,
  timeToMinutes,
  withinHours,
  type ServiceRates,
} from "../src/index.ts";

const full: ServiceRates = {
  name: "Full groom",
  priceCents: { S: 5500, M: 7000, L: 8500, XL: 10500 },
  minutes: { S: 90, M: 120, L: 150, XL: 180 },
  bufferMinutes: 15,
};
const teeth: ServiceRates = {
  name: "Teeth brushing",
  priceCents: { S: 1000, M: 1000, L: 1000, XL: 1000 },
  minutes: { S: 10, M: 10, L: 10, XL: 10 },
  bufferMinutes: 0,
};

describe("quotes", () => {
  it("prices by size, adds add-ons, and keeps the main service's buffer", () => {
    expect(quoteAppointment(full, [], "S")).toEqual({
      priceCents: 5500,
      minutes: 90,
      bufferMinutes: 15,
      label: "Full groom",
    });
    const q = quoteAppointment(full, [teeth], "M");
    expect(q).toEqual({
      priceCents: 8000,
      minutes: 130,
      bufferMinutes: 15,
      label: "Full groom + Teeth brushing",
    });
    expect(quoteText(q, "M")).toBe("Full groom + Teeth brushing · size M · $80.00 · 2 hr 10 min");
  });

  it("refuses a size without a time", () => {
    expect(() => quoteAppointment({ ...full, minutes: { ...full.minutes, XL: 0 } }, [], "XL")).toThrow(
      /no time set for size XL/,
    );
  });
});

describe("times", () => {
  it("reads and writes clock times", () => {
    expect(timeToMinutes("09:00")).toBe(540);
    expect(timeToMinutes("17:30:00")).toBe(1050);
    expect(minutesToTime(545)).toBe("09:05");
    expect([clockText(540), clockText(720), clockText(780), clockText(0)]).toEqual([
      "9:00 AM",
      "12:00 PM",
      "1:00 PM",
      "12:00 AM",
    ]);
    expect([durationText(45), durationText(120), durationText(130)]).toEqual([
      "45 min",
      "2 hr",
      "2 hr 10 min",
    ]);
    expect(minutesOfDay(atLocal("2026-10-20", 615))).toBe(615);
  });

  it("checks hours and overlaps", () => {
    const hours = { start: 480, end: 960 };
    expect(withinHours(480, 960, hours)).toBe(true);
    expect(withinHours(900, 975, hours)).toBe(false);
    expect(withinHours(600, 700, null)).toBe(false);
    expect(overlaps(540, 600, 600, 660)).toBe(false);
    expect(overlaps(540, 615, 600, 660)).toBe(true);
  });
});

describe("status flow", () => {
  it("lets booking roles check in, and groomers move the groom along", () => {
    expect(nextSteps("booked", "cashier").map((s) => s.to)).toEqual(["checked_in", "no_show"]);
    expect(nextSteps("booked", "groomer")).toEqual([]);
    expect(nextSteps("checked_in", "groomer").map((s) => s.label)).toEqual(["Start groom"]);
    expect(nextSteps("in_progress", "groomer").map((s) => [s.label, s.undo])).toEqual([
      ["Ready for pickup", false],
      ["Undo start", true],
    ]);
    expect(canStep("ready", "done", "cashier")).toBe(false);
    expect(canStep("ready", "done", "manager")).toBe(true);
    expect(canStep("booked", "done", "owner")).toBe(false);
  });
});
