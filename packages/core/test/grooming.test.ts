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
  snapMinutes,
  weekStart,
  weekDays,
  shortDay,
  suggestCallout,
  appointmentText,
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

describe("busy-day helpers", () => {
  it("snaps to 15 minutes and finds the week", () => {
    expect([snapMinutes(547), snapMinutes(553), snapMinutes(-20), snapMinutes(1439)]).toEqual([
      540, 555, 0, 1425,
    ]);
    expect(weekStart("2026-10-21")).toBe("2026-10-19");
    expect(weekStart("2026-10-25")).toBe("2026-10-19");
    expect(weekStart("2026-10-19")).toBe("2026-10-19");
    expect(weekDays("2026-12-28")).toEqual([
      "2026-12-28",
      "2026-12-29",
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
      "2027-01-03",
    ]);
    expect(shortDay("2026-10-21")).toBe("Wed Oct 21");
  });

  it("suggests who can take a called-out groomer's appointments", () => {
    const appts = [
      { id: "a", start: 540, end: 660, blockEnd: 675 },
      { id: "b", start: 600, end: 660, blockEnd: 675 },
      { id: "c", start: 900, end: 960, blockEnd: 975 },
    ];
    const s = suggestCallout(appts, [
      // Works 8–4 but already has 9:00–9:45 (with buffer).
      {
        staffId: "x",
        name: "X",
        hours: { start: 480, end: 960 },
        timeOff: [],
        busy: [{ start: 540, end: 585 }],
      },
      // Works 10–6, off 2–4.
      {
        staffId: "y",
        name: "Y",
        hours: { start: 600, end: 1080 },
        timeOff: [{ start: 840, end: 960 }],
        busy: [],
      },
    ]);
    expect(s).toEqual([
      // 9:00: X is busy, Y doesn't start until 10.
      { appointmentId: "a", staffId: null, name: null },
      // 10:00: X is free.
      { appointmentId: "b", staffId: "x", name: "X" },
      // 3:00: X works until 4, Y is off.
      { appointmentId: "c", staffId: "x", name: "X" },
    ]);
  });

  it("writes the texts plainly", () => {
    expect(appointmentText.ready("Sample Pet Store", "Biscuit")).toBe(
      "Sample Pet Store: Biscuit is ready for pickup!",
    );
    expect(appointmentText.moved("Sample Pet Store", "Biscuit", "2026-10-21", 660, "Groomer B")).toBe(
      "Sample Pet Store: Biscuit's groom is now Wed Oct 21 at 11:00 AM with Groomer B. Reply or call to change it.",
    );
    expect(appointmentText.canceled("S", "Mo", "2026-10-21", 780)).toBe(
      "S: Mo's groom on Wed Oct 21 at 1:00 PM is canceled. Call us to book a new time.",
    );
  });
});
