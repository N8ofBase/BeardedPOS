import type { Kysely } from "kysely";
import { beforeEach, describe, expect, it } from "vitest";
import { addDays, atLocal, todayIso, type Ctx } from "@pet-pos/core";
import { ensureDemo, listDemoStaff, withBusiness, type DB } from "@pet-pos/db";
import { createTestDb, insertBusiness } from "@pet-pos/db/test-db";
import type { BookingInput } from "../src/handlers/grooming.ts";
import { invoke } from "../src/registry.ts";

let db: Kysely<DB>;
let businessId: string;
let owner: Ctx;
let manager: Ctx;
let cashier: Ctx;
let groomer: Ctx;
let groomerA: string;
let groomerB: string;
let svc: Record<string, string>;
let pets: Record<string, { id: string; customerId: string }>;

/** The next Tuesday at least two days out: both sample groomers work Tuesdays. */
function nextTuesday(): string {
  let d = addDays(todayIso(), 2);
  while (new Date(`${d}T12:00:00`).getDay() !== 2) d = addDays(d, 1);
  return d;
}
const tue = nextTuesday();

beforeEach(async () => {
  ({ db } = await createTestDb());
  businessId = await ensureDemo(db);
  const staff = await listDemoStaff(db);
  const ctx = (role: Ctx["role"]): Ctx => ({
    businessId,
    role,
    staffId: staff.find((s) => s.role === role)!.id,
  });
  owner = ctx("owner");
  manager = ctx("manager");
  cashier = ctx("cashier");
  groomer = ctx("groomer");
  const groomers = await invoke(db, owner, "listGroomers", {});
  groomerA = groomers.find((g) => g.name === "Sample Groomer (DEMO)")!.staffId;
  groomerB = groomers.find((g) => g.name === "Sample Groomer B (DEMO)")!.staffId;
  svc = Object.fromEntries(
    (await invoke(db, owner, "listServices", {})).map((s) => [s.name.split(" ")[1], s.id]),
  );
  const all = await withBusiness(db, businessId, (trx) =>
    trx.selectFrom("pets").select(["id", "name", "customer_id"]).execute(),
  );
  pets = Object.fromEntries(all.map((p) => [p.name, { id: p.id, customerId: p.customer_id }]));
});

const booking = (over: Partial<BookingInput> = {}): BookingInput => ({
  customerId: pets.Biscuit!.customerId,
  petId: pets.Biscuit!.id,
  serviceId: svc.Full!,
  addonIds: [svc.Teeth!],
  staffId: groomerA,
  day: tue,
  start: "09:00",
  ...over,
});

describe("services and groomers", () => {
  it("has the sample menu and groomers", async () => {
    expect(Object.keys(svc).sort()).toEqual(["Bath", "Full", "Teeth"]);
    const g = await invoke(db, cashier, "listGroomers", {});
    expect(g.find((x) => x.staffId === groomerA)!.hours.map((h) => h.weekday)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("audits price changes and archives instead of deleting", async () => {
    const full = (await invoke(db, owner, "listServices", {})).find((s) => s.id === svc.Full)!;
    const appt = await invoke(db, cashier, "bookAppointment", booking());
    await invoke(db, manager, "saveService", { ...full, priceCents: { ...full.priceCents, M: 7500 } });
    const log = await withBusiness(db, businessId, (trx) =>
      trx
        .selectFrom("audit_log")
        .select(["action", "before", "after"])
        .where("action", "=", "service.price_change")
        .execute(),
    );
    expect(log).toHaveLength(1);
    expect(log[0]!.after).toMatchObject({ price_m_cents: 7500 });
    // The booked price stays.
    expect((await invoke(db, owner, "groomingDay", { day: tue })).appointments[0]!.priceCents).toBe(8000);

    await invoke(db, owner, "archiveService", { id: svc.Full! });
    expect((await invoke(db, owner, "listServices", {})).map((s) => s.id)).not.toContain(svc.Full);
    expect((await invoke(db, owner, "groomingDay", { day: tue })).appointments[0]!.serviceName).toBe(
      appt.serviceName,
    );
    await expect(invoke(db, cashier, "bookAppointment", booking({ start: "13:00" }))).rejects.toThrow(
      /on the menu/,
    );
    await expect(invoke(db, cashier, "saveService", { ...full, name: "X" })).rejects.toThrow(/permission/);
  });

  it("replaces a groomer's hours", async () => {
    await invoke(db, owner, "saveGroomer", {
      staffId: groomerB,
      grooms: true,
      hours: [{ weekday: 2, start: "09:00", end: "15:00" }],
    });
    const b = (await invoke(db, owner, "listGroomers", {})).find((g) => g.staffId === groomerB)!;
    expect(b.hours).toEqual([{ weekday: 2, start: "09:00", end: "15:00" }]);
    await expect(
      invoke(db, owner, "saveGroomer", {
        staffId: groomerB,
        grooms: true,
        hours: [{ weekday: 2, start: "15:00", end: "09:00" }],
      }),
    ).rejects.toThrow(/after the start/);
  });
});

describe("booking", () => {
  it("quotes and books with the server's price", async () => {
    const check = await invoke(db, cashier, "checkAppointment", booking());
    expect(check).toMatchObject({
      size: "M",
      when: "9:00 AM – 11:10 AM",
      warnings: [],
      clash: null,
      quote: { priceCents: 8000, minutes: 130, bufferMinutes: 15 },
    });
    const a = await invoke(db, cashier, "bookAppointment", booking({ notes: " Short cut " }));
    expect(a).toMatchObject({
      status: "booked",
      priceCents: 8000,
      start: 540,
      end: 670,
      blockEnd: 685,
      label: "Sample Full groom (DEMO) + Sample Teeth brushing (DEMO)",
      notes: "Short cut",
      groomerName: "Sample Groomer (DEMO)",
    });
  });

  it("refuses double-booking, including the buffer, and frees canceled and no-show slots", async () => {
    const first = await invoke(db, cashier, "bookAppointment", booking());
    // Mo's rabies has lapsed in the sample data, so these need "Book anyway".
    const mo = {
      customerId: pets.Mo!.customerId,
      petId: pets.Mo!.id,
      serviceId: svc.Bath!,
      addonIds: [],
      override: true,
    };
    // 11:10 end + 15 buffer = 11:25.
    await expect(invoke(db, cashier, "bookAppointment", booking({ ...mo, start: "11:15" }))).rejects.toThrow(
      "Sample Groomer (DEMO) already has Biscuit at 9:00 AM. Pick another time or groomer.",
    );
    await invoke(db, cashier, "bookAppointment", booking({ ...mo, start: "11:25" }));
    // Another groomer at the same time is fine.
    await invoke(db, cashier, "bookAppointment", booking({ ...mo, staffId: groomerB, start: "10:00" }));

    // The database refuses an overlap even past the app's own check.
    const loc = await withBusiness(db, businessId, (trx) =>
      trx.selectFrom("locations").select("id").executeTakeFirstOrThrow(),
    );
    await expect(
      db
        .insertInto("appointments")
        .values({
          business_id: businessId,
          location_id: loc.id,
          staff_id: groomerA,
          service_id: svc.Bath!,
          service_name: "x",
          pet_name: "x",
          size: "S",
          starts_at: atLocal(tue, 600),
          ends_at: atLocal(tue, 630),
          block_ends_at: atLocal(tue, 630),
          price_cents: 0,
        })
        .execute(),
    ).rejects.toThrow(/appointments_no_double_booking/);

    await invoke(db, cashier, "cancelAppointment", { id: first.id });
    await invoke(db, cashier, "bookAppointment", booking({ start: "09:00", addonIds: [] }));
  });

  it("frees a no-show's slot, and won't undo the no-show into a clash", async () => {
    const a = await invoke(db, cashier, "bookAppointment", booking());
    await invoke(db, cashier, "setAppointmentStatus", { id: a.id, status: "no_show" });
    await invoke(db, cashier, "bookAppointment", booking({ petId: pets.Biscuit!.id, addonIds: [] }));
    await expect(invoke(db, cashier, "setAppointmentStatus", { id: a.id, status: "booked" })).rejects.toThrow(
      /Someone else is booked/,
    );
  });

  it("refuses editing into a clash", async () => {
    await invoke(db, cashier, "bookAppointment", booking());
    const b = await invoke(db, cashier, "bookAppointment", booking({ start: "13:00", addonIds: [] }));
    await expect(
      invoke(db, cashier, "updateAppointment", { ...booking({ start: "10:00" }), id: b.id }),
    ).rejects.toThrow(/already has Biscuit/);
    const moved = await invoke(db, cashier, "updateAppointment", {
      ...booking({ start: "14:00", addonIds: [] }),
      id: b.id,
    });
    expect(moved.start).toBe(14 * 60);
  });

  it("needs Book anyway outside hours, in time off, and when rabies has lapsed", async () => {
    // Groomer A works 8–4: a 2 hr 10 min groom at 3 PM runs past.
    const late = booking({ start: "15:00" });
    expect((await invoke(db, cashier, "checkAppointment", late)).warnings).toEqual([
      "This is outside Sample Groomer (DEMO)'s hours (8:00 AM – 4:00 PM).",
    ]);
    await expect(invoke(db, cashier, "bookAppointment", late)).rejects.toThrow(/Book anyway/);
    await invoke(db, cashier, "bookAppointment", { ...late, override: true });

    await invoke(db, manager, "addTimeOff", {
      staffId: groomerB,
      startsAt: atLocal(tue, 12 * 60).toISOString(),
      endsAt: atLocal(tue, 14 * 60).toISOString(),
      note: "Vet appointment",
    });
    expect(
      (await invoke(db, cashier, "checkAppointment", booking({ staffId: groomerB, start: "12:30" })))
        .warnings,
    ).toEqual(["Sample Groomer B (DEMO) has time off then (Vet appointment)."]);

    await db
      .updateTable("vaccinations")
      .set({ expires_on: addDays(todayIso(), 1) })
      .where("vaccine", "=", "Rabies")
      .execute();
    const w = (await invoke(db, cashier, "checkAppointment", booking({ start: "08:00" }))).warnings;
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/^Biscuit's rabies vaccination expired .*Ask for proof before the groom\.$/);
    const day = await invoke(db, cashier, "groomingDay", { day: tue });
    expect(day.appointments[0]!.rabiesLapsed).toBe(true);
  });

  it("asks for the size when the pet has none, and saves it", async () => {
    const juno = { customerId: pets.Clover!.customerId, petId: pets.Clover!.id, addonIds: [] };
    await expect(invoke(db, cashier, "checkAppointment", booking(juno))).rejects.toThrow(
      "Pick Clover's size.",
    );
    await invoke(db, cashier, "bookAppointment", booking({ ...juno, size: "S" }));
    const size = await withBusiness(db, businessId, (trx) =>
      trx.selectFrom("pets").select("size").where("id", "=", pets.Clover!.id).executeTakeFirstOrThrow(),
    );
    expect(size.size).toBe("S");
  });

  it("refuses another customer's pet", async () => {
    await expect(invoke(db, cashier, "bookAppointment", booking({ petId: pets.Mo!.id }))).rejects.toThrow(
      /customer's pets/,
    );
  });
});

describe("status flow", () => {
  it("lets groomers move a groom along but not book or skip steps", async () => {
    await expect(invoke(db, groomer, "bookAppointment", booking())).rejects.toThrow(/permission/);
    const a = await invoke(db, cashier, "bookAppointment", booking());
    await expect(
      invoke(db, groomer, "setAppointmentStatus", { id: a.id, status: "in_progress" }),
    ).rejects.toThrow(/can't make that change/);
    await invoke(db, cashier, "setAppointmentStatus", { id: a.id, status: "checked_in" });
    await invoke(db, groomer, "setAppointmentStatus", { id: a.id, status: "in_progress" });
    const ready = await invoke(db, groomer, "setAppointmentStatus", { id: a.id, status: "ready" });
    expect(ready.status).toBe("ready");
    await expect(invoke(db, cashier, "setAppointmentStatus", { id: a.id, status: "done" })).rejects.toThrow(
      /can't make that change/,
    );
    await invoke(db, manager, "setAppointmentStatus", { id: a.id, status: "done" });
    await expect(invoke(db, cashier, "cancelAppointment", { id: a.id })).rejects.toThrow(/done and paid/);

    const stamps = await withBusiness(db, businessId, (trx) =>
      trx
        .selectFrom("appointments")
        .select(["checked_in_at", "started_at", "ready_at", "done_at"])
        .where("id", "=", a.id)
        .executeTakeFirstOrThrow(),
    );
    expect(Object.values(stamps).every((v) => v instanceof Date)).toBe(true);
  });

  it("clears a step's time when it's undone", async () => {
    const a = await invoke(db, cashier, "bookAppointment", booking());
    await invoke(db, cashier, "setAppointmentStatus", { id: a.id, status: "checked_in" });
    await invoke(db, cashier, "setAppointmentStatus", { id: a.id, status: "booked" });
    const row = await withBusiness(db, businessId, (trx) =>
      trx
        .selectFrom("appointments")
        .select(["status", "checked_in_at"])
        .where("id", "=", a.id)
        .executeTakeFirstOrThrow(),
    );
    expect(row).toEqual({ status: "booked", checked_in_at: null });
  });
});

describe("the day", () => {
  it("lists the groomers working, their appointments and a summary", async () => {
    await invoke(db, cashier, "bookAppointment", booking());
    const a2 = await invoke(
      db,
      cashier,
      "bookAppointment",
      booking({
        customerId: pets.Rex!.customerId,
        petId: pets.Rex!.id,
        serviceId: svc.Bath!,
        addonIds: [],
        staffId: groomerB,
        start: "10:00",
      }),
    );
    await invoke(db, cashier, "setAppointmentStatus", { id: a2.id, status: "checked_in" });
    const day = await invoke(db, groomer, "groomingDay", { day: tue });
    expect(day.groomers.map((g) => [g.name, g.hours])).toEqual([
      ["Sample Groomer (DEMO)", { start: 480, end: 960 }],
      ["Sample Groomer B (DEMO)", { start: 600, end: 1080 }],
    ]);
    expect(day.summary).toEqual({ appointments: 2, inShop: 1, ready: 0, expectedCents: 8000 + 6000 });
    expect(day.appointments.find((a) => a.petName === "Rex")).toMatchObject({
      size: "L",
      customerPhone: "2125550102",
    });

    const upcoming = await invoke(db, cashier, "customerAppointments", {
      customerId: pets.Biscuit!.customerId,
    });
    expect(upcoming.map((u) => u.petName)).toContain("Biscuit");
  });

  it("keeps businesses apart", async () => {
    const a = await invoke(db, cashier, "bookAppointment", booking());
    const other = await insertBusiness(db, "other-store");
    await db.insertInto("locations").values({ business_id: other, name: "Other" }).execute();
    const st = await db
      .insertInto("staff")
      .values({ business_id: other, name: "O", role: "owner" })
      .returning("id")
      .executeTakeFirstOrThrow();
    const o: Ctx = { businessId: other, staffId: st.id, role: "owner" };
    expect((await invoke(db, o, "groomingDay", { day: tue })).appointments).toEqual([]);
    expect(await invoke(db, o, "listServices", {})).toEqual([]);
    await expect(invoke(db, o, "cancelAppointment", { id: a.id })).rejects.toThrow(/doesn't exist/);
  });
});
