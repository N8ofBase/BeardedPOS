// Grooming: the service menu, groomer hours and time off, the day calendar and
// appointments. Every booking is repriced here with quoteAppointment(); the database's
// exclusion constraint is the last word on double-booking.
import { sql, type Transaction } from "kysely";
import {
  AppError,
  atLocal,
  canStep,
  clockText,
  isIsoDate,
  minutesOfDay,
  minutesToTime,
  quoteAppointment,
  rabiesLapsed,
  SIZES,
  timeToMinutes,
  withinHours,
  type ApptStatus,
  type Ctx,
  type PetSize,
  type Quote,
  type ServiceRates,
} from "@pet-pos/core";
import type { DB } from "@pet-pos/db";
import { defineHandler } from "../handler.ts";
import { audit, currentLocationId, requireInt } from "../shared.ts";

type Trx = Transaction<DB>;
type Sized = Record<PetSize, number>;

// ---- services ----

export interface ServiceRow {
  id: string;
  name: string;
  kind: "main" | "addon";
  description: string | null;
  priceCents: Sized;
  minutes: Sized;
  bufferMinutes: number;
  depositCents: number;
  online: boolean;
  active: boolean;
  archived: boolean;
}

type ServiceDb = {
  id: string;
  name: string;
  kind: "main" | "addon";
  description: string | null;
  price_s_cents: number;
  price_m_cents: number;
  price_l_cents: number;
  price_xl_cents: number;
  minutes_s: number;
  minutes_m: number;
  minutes_l: number;
  minutes_xl: number;
  buffer_minutes: number;
  deposit_cents: number;
  online: boolean;
  active: boolean;
  archived_at: Date | null;
};

function toService(s: ServiceDb): ServiceRow {
  return {
    id: s.id,
    name: s.name,
    kind: s.kind,
    description: s.description,
    priceCents: { S: s.price_s_cents, M: s.price_m_cents, L: s.price_l_cents, XL: s.price_xl_cents },
    minutes: { S: s.minutes_s, M: s.minutes_m, L: s.minutes_l, XL: s.minutes_xl },
    bufferMinutes: s.buffer_minutes,
    depositCents: s.deposit_cents,
    online: s.online,
    active: s.active,
    archived: !!s.archived_at,
  };
}

const rates = (s: ServiceRow): ServiceRates => ({
  name: s.name,
  priceCents: s.priceCents,
  minutes: s.minutes,
  bufferMinutes: s.bufferMinutes,
});

export const listServices = defineHandler<{ all?: boolean }, ServiceRow[]>({
  action: "grooming.view",
  async run(trx, _ctx, input) {
    let q = trx.selectFrom("services").selectAll();
    if (!input?.all) q = q.where("archived_at", "is", null).where("active", "=", true);
    const rows = await q.orderBy("kind", "desc").orderBy("position").orderBy("name").execute();
    return rows.map(toService);
  },
});

export interface ServiceInput {
  id?: string;
  name: string;
  kind: "main" | "addon";
  description: string | null;
  priceCents: Sized;
  minutes: Sized;
  bufferMinutes: number;
  depositCents: number;
  online: boolean;
  active: boolean;
}

export const saveService = defineHandler<ServiceInput, { id: string }>({
  action: "grooming.manage",
  async run(trx, ctx, input) {
    const name = input.name.trim();
    if (!name)
      throw new AppError("invalid", "Service name is required.", { name: "Service name is required." });
    if (input.kind !== "main" && input.kind !== "addon")
      throw new AppError("invalid", "Pick main service or add-on.");
    for (const z of SIZES) {
      requireInt(input.priceCents[z], `Price for size ${z}`, { min: 0, max: 1_000_000 });
      requireInt(input.minutes[z], `Minutes for size ${z}`, { min: 0, max: 720 });
      if (input.kind === "main" && input.minutes[z] <= 0)
        throw new AppError("invalid", `Set the minutes for size ${z}.`, {
          minutes: `Set the minutes for size ${z}.`,
        });
    }
    requireInt(input.bufferMinutes, "Buffer", { min: 0, max: 240 });
    requireInt(input.depositCents, "Deposit", { min: 0, max: 1_000_000 });
    const values = {
      name,
      kind: input.kind,
      description: input.description?.trim() || null,
      price_s_cents: input.priceCents.S,
      price_m_cents: input.priceCents.M,
      price_l_cents: input.priceCents.L,
      price_xl_cents: input.priceCents.XL,
      minutes_s: input.minutes.S,
      minutes_m: input.minutes.M,
      minutes_l: input.minutes.L,
      minutes_xl: input.minutes.XL,
      buffer_minutes: input.bufferMinutes,
      deposit_cents: input.depositCents,
      online: input.online,
      active: input.active,
    };
    try {
      if (input.id) {
        const before = await trx
          .selectFrom("services")
          .selectAll()
          .where("id", "=", input.id)
          .executeTakeFirst();
        if (!before) throw new AppError("not_found", "That service doesn't exist.");
        await trx.updateTable("services").set(values).where("id", "=", input.id).execute();
        const keys = ["price_s_cents", "price_m_cents", "price_l_cents", "price_xl_cents"] as const;
        if (keys.some((k) => before[k] !== values[k]))
          await audit(trx, ctx, {
            action: "service.price_change",
            entity: "service",
            entityId: input.id,
            before: Object.fromEntries(keys.map((k) => [k, before[k]])),
            after: Object.fromEntries(keys.map((k) => [k, values[k]])),
          });
        return { id: input.id };
      }
      const row = await trx
        .insertInto("services")
        .values({ ...values, business_id: ctx.businessId })
        .returning("id")
        .executeTakeFirstOrThrow();
      return { id: row.id };
    } catch (err) {
      const e = err as { code?: string; message?: string };
      if (e?.code === "23505" && e.message?.includes("services_name_per_business"))
        throw new AppError("conflict", "There's already a service with that name.", {
          name: "There's already a service with that name.",
        });
      throw err;
    }
  },
});

/** Services are archived, never deleted, so old appointments keep their name. */
export const archiveService = defineHandler<{ id: string }, void>({
  action: "grooming.manage",
  async run(trx, _ctx, { id }) {
    const res = await trx
      .updateTable("services")
      .set({ archived_at: new Date(), active: false })
      .where("id", "=", id)
      .executeTakeFirst();
    if (res.numUpdatedRows === 0n) throw new AppError("not_found", "That service doesn't exist.");
  },
});

// ---- groomers ----

export interface GroomerRow {
  staffId: string;
  name: string;
  role: string;
  grooms: boolean;
  active: boolean;
  /** Weekly hours: "09:00" times. */
  hours: { weekday: number; start: string; end: string }[];
  timeOff: { id: string; startsAt: Date; endsAt: Date; note: string | null }[];
}

/** Groomers (or, with all, every active staff member, for ticking who grooms). */
export const listGroomers = defineHandler<{ all?: boolean }, GroomerRow[]>({
  action: "grooming.view",
  async run(trx, _ctx, input) {
    let q = trx
      .selectFrom("staff")
      .select(["id", "name", "role", "grooms", "active"])
      .where("active", "=", true);
    if (!input?.all) q = q.where("grooms", "=", true);
    const staff = await q.orderBy("name").execute();
    if (!staff.length) return [];
    const ids = staff.map((s) => s.id);
    const hours = await trx
      .selectFrom("groomer_hours")
      .select(["staff_id", "weekday", "start_time", "end_time"])
      .where("staff_id", "in", ids)
      .orderBy("weekday")
      .execute();
    const off = await trx
      .selectFrom("time_off")
      .select(["id", "staff_id", "starts_at", "ends_at", "note"])
      .where("staff_id", "in", ids)
      .where("ends_at", ">", new Date())
      .orderBy("starts_at")
      .execute();
    return staff.map((s) => ({
      staffId: s.id,
      name: s.name,
      role: s.role,
      grooms: s.grooms,
      active: s.active,
      hours: hours
        .filter((h) => h.staff_id === s.id)
        .map((h) => ({ weekday: h.weekday, start: h.start_time.slice(0, 5), end: h.end_time.slice(0, 5) })),
      timeOff: off
        .filter((t) => t.staff_id === s.id)
        .map((t) => ({ id: t.id, startsAt: t.starts_at, endsAt: t.ends_at, note: t.note })),
    }));
  },
});

export interface GroomerInput {
  staffId: string;
  grooms: boolean;
  hours: { weekday: number; start: string; end: string }[];
}

export const saveGroomer = defineHandler<GroomerInput, void>({
  action: "grooming.manage",
  async run(trx, ctx, { staffId, grooms, hours }) {
    const s = await trx.selectFrom("staff").select("id").where("id", "=", staffId).executeTakeFirst();
    if (!s) throw new AppError("not_found", "That staff member doesn't exist.");
    const seen = new Set<number>();
    const rows = hours.map((h) => {
      requireInt(h.weekday, "Weekday", { min: 0, max: 6 });
      if (seen.has(h.weekday)) throw new AppError("invalid", "Each day can only have one set of hours.");
      seen.add(h.weekday);
      const start = timeToMinutes(h.start);
      const end = timeToMinutes(h.end);
      if (end <= start) throw new AppError("invalid", "The end time must be after the start time.");
      return {
        business_id: ctx.businessId,
        staff_id: staffId,
        weekday: h.weekday,
        start_time: minutesToTime(start),
        end_time: minutesToTime(end),
      };
    });
    await trx.updateTable("staff").set({ grooms }).where("id", "=", staffId).execute();
    await trx.deleteFrom("groomer_hours").where("staff_id", "=", staffId).execute();
    if (rows.length) await trx.insertInto("groomer_hours").values(rows).execute();
  },
});

export const addTimeOff = defineHandler<
  { staffId: string; startsAt: string; endsAt: string; note?: string },
  { id: string }
>({
  action: "grooming.manage",
  async run(trx, ctx, input) {
    const start = new Date(input.startsAt);
    const end = new Date(input.endsAt);
    if (isNaN(start.getTime()) || isNaN(end.getTime()))
      throw new AppError("invalid", "Pick when the time off starts and ends.");
    if (end <= start) throw new AppError("invalid", "Time off must end after it starts.");
    const row = await trx
      .insertInto("time_off")
      .values({
        business_id: ctx.businessId,
        staff_id: input.staffId,
        starts_at: start,
        ends_at: end,
        note: input.note?.trim() || null,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    return { id: row.id };
  },
});

export const removeTimeOff = defineHandler<{ id: string }, void>({
  action: "grooming.manage",
  async run(trx, _ctx, { id }) {
    await trx.deleteFrom("time_off").where("id", "=", id).execute();
  },
});

// ---- the day ----

function dayBounds(day: string): { from: Date; to: Date; weekday: number } {
  if (!isIsoDate(day)) throw new AppError("invalid", "Pick a day.");
  const from = atLocal(day, 0);
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return { from, to: new Date(y, m - 1, d + 1), weekday: from.getDay() };
}

export interface AppointmentRow {
  id: string;
  status: ApptStatus;
  staffId: string;
  groomerName: string;
  customerId: string | null;
  customerName: string | null;
  customerPhone: string | null;
  petId: string | null;
  petName: string;
  species: string | null;
  breed: string | null;
  allergies: string | null;
  coat: string | null;
  temperament: string | null;
  size: PetSize;
  serviceId: string;
  serviceName: string;
  addons: { serviceId: string; name: string }[];
  /** "Full groom + Teeth brushing" */
  label: string;
  startsAt: Date;
  endsAt: Date;
  /** Minutes since local midnight, for placing on the calendar. */
  start: number;
  end: number;
  blockEnd: number;
  priceCents: number;
  notes: string | null;
  /** Rabies lapsed by the appointment's date. */
  rabiesLapsed: boolean;
}

async function appointmentRows(
  trx: Trx,
  where: { from?: Date; to?: Date; ids?: string[]; customerId?: string },
) {
  let q = trx
    .selectFrom("appointments as a")
    .innerJoin("staff as st", "st.id", "a.staff_id")
    .leftJoin("customers as c", "c.id", "a.customer_id")
    .leftJoin("pets as p", "p.id", "a.pet_id")
    .select([
      "a.id",
      "a.status",
      "a.staff_id",
      "st.name as groomer_name",
      "a.customer_id",
      "c.name as customer_name",
      "c.phone as customer_phone",
      "a.pet_id",
      "a.pet_name",
      "p.species",
      "p.breed",
      "p.allergies",
      "p.coat",
      "p.temperament",
      "a.size",
      "a.service_id",
      "a.service_name",
      "a.starts_at",
      "a.ends_at",
      "a.block_ends_at",
      "a.price_cents",
      "a.notes",
    ]);
  if (where.from) q = q.where("a.starts_at", ">=", where.from);
  if (where.to) q = q.where("a.starts_at", "<", where.to);
  if (where.ids) q = q.where("a.id", "in", where.ids);
  if (where.customerId) q = q.where("a.customer_id", "=", where.customerId);
  const rows = await q.where("a.status", "!=", "canceled").orderBy("a.starts_at").execute();
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const addons = await trx
    .selectFrom("appointment_addons")
    .select(["appointment_id", "service_id", "name"])
    .where("appointment_id", "in", ids)
    .orderBy("created_at")
    .execute();
  const petIds = rows.map((r) => r.pet_id).filter((x): x is string => !!x);
  const vacc = petIds.length
    ? await trx
        .selectFrom("vaccinations")
        .select(["pet_id", "vaccine", "expires_on"])
        .where("pet_id", "in", petIds)
        .execute()
    : [];
  return rows.map((r): AppointmentRow => {
    const ad = addons.filter((a) => a.appointment_id === r.id);
    const d = new Date(r.starts_at);
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return {
      id: r.id,
      status: r.status,
      staffId: r.staff_id,
      groomerName: r.groomer_name,
      customerId: r.customer_id,
      customerName: r.customer_name,
      customerPhone: r.customer_phone,
      petId: r.pet_id,
      petName: r.pet_name,
      species: r.species,
      breed: r.breed,
      allergies: r.allergies,
      coat: r.coat,
      temperament: r.temperament,
      size: r.size,
      serviceId: r.service_id,
      serviceName: r.service_name,
      addons: ad.map((a) => ({ serviceId: a.service_id, name: a.name })),
      label: [r.service_name, ...ad.map((a) => a.name)].join(" + "),
      startsAt: r.starts_at,
      endsAt: r.ends_at,
      start: minutesOfDay(r.starts_at),
      end: minutesOfDay(r.ends_at),
      blockEnd: minutesOfDay(r.block_ends_at),
      priceCents: r.price_cents,
      notes: r.notes,
      rabiesLapsed: rabiesLapsed(
        vacc
          .filter((v) => v.pet_id === r.pet_id)
          .map((v) => ({ vaccine: v.vaccine, expiresOn: v.expires_on })),
        day,
      ),
    };
  });
}

export interface DayGroomer {
  staffId: string;
  name: string;
  /** Minutes since midnight; null when they don't work this day but have appointments. */
  hours: { start: number; end: number } | null;
  timeOff: { start: number; end: number; note: string | null }[];
}

export interface GroomingDay {
  day: string;
  groomers: DayGroomer[];
  appointments: AppointmentRow[];
  summary: { appointments: number; inShop: number; ready: number; expectedCents: number };
}

export const groomingDay = defineHandler<{ day: string }, GroomingDay>({
  action: "grooming.view",
  async run(trx, _ctx, { day }) {
    const { from, to, weekday } = dayBounds(day);
    const appointments = await appointmentRows(trx, { from, to });
    const staff = await trx
      .selectFrom("staff")
      .select(["id", "name", "grooms", "active"])
      .orderBy("name")
      .execute();
    const hours = await trx
      .selectFrom("groomer_hours")
      .select(["staff_id", "start_time", "end_time"])
      .where("weekday", "=", weekday)
      .execute();
    const off = await trx
      .selectFrom("time_off")
      .select(["staff_id", "starts_at", "ends_at", "note"])
      .where("starts_at", "<", to)
      .where("ends_at", ">", from)
      .execute();
    const busy = new Set(appointments.map((a) => a.staffId));
    const groomers: DayGroomer[] = staff
      .filter((s) => (s.grooms && s.active && hours.some((h) => h.staff_id === s.id)) || busy.has(s.id))
      .map((s) => {
        const h = hours.find((x) => x.staff_id === s.id);
        return {
          staffId: s.id,
          name: s.name,
          hours:
            h && s.grooms ? { start: timeToMinutes(h.start_time), end: timeToMinutes(h.end_time) } : null,
          timeOff: off
            .filter((t) => t.staff_id === s.id)
            .map((t) => ({
              start: t.starts_at <= from ? 0 : minutesOfDay(t.starts_at),
              end: t.ends_at >= to ? 24 * 60 : minutesOfDay(t.ends_at),
              note: t.note,
            })),
        };
      });
    const live = appointments.filter((a) => a.status !== "no_show");
    return {
      day,
      groomers,
      appointments,
      summary: {
        appointments: live.length,
        inShop: appointments.filter((a) => a.status === "checked_in" || a.status === "in_progress").length,
        ready: appointments.filter((a) => a.status === "ready").length,
        expectedCents: live.reduce((s, a) => s + a.priceCents, 0),
      },
    };
  },
});

// ---- booking ----

export interface BookingInput {
  customerId: string;
  petId: string;
  serviceId: string;
  addonIds: string[];
  staffId: string;
  day: string;
  /** "09:30" */
  start: string;
  /** Needed when the pet has no size on file; saved on the pet. */
  size?: PetSize | null;
  notes?: string;
  /** Book despite the warnings (outside hours, time off, rabies). */
  override?: boolean;
}

export interface BookingCheck {
  quote: Quote;
  size: PetSize;
  /** "9:00 AM – 11:10 AM" */
  when: string;
  /** Things to confirm with "Book anyway". */
  warnings: string[];
  /** Another appointment in the way: booking is refused. */
  clash: string | null;
}

interface Plan extends BookingCheck {
  startsAt: Date;
  endsAt: Date;
  blockEndsAt: Date;
  main: ServiceRow;
  addons: ServiceRow[];
  petName: string;
  setPetSize: boolean;
}

async function planBooking(trx: Trx, input: BookingInput, ignoreId: string | null): Promise<Plan> {
  if (!isIsoDate(input.day)) throw new AppError("invalid", "Pick a day.");
  const pet = await trx
    .selectFrom("pets")
    .select(["id", "name", "size", "customer_id"])
    .where("id", "=", input.petId)
    .executeTakeFirst();
  if (!pet || pet.customer_id !== input.customerId)
    throw new AppError("invalid", "Pick one of the customer's pets.");
  const size = (pet.size ?? input.size ?? null) as PetSize | null;
  if (!size || !(SIZES as readonly string[]).includes(size))
    throw new AppError("invalid", `Pick ${pet.name}'s size.`, { size: `Pick ${pet.name}'s size.` });

  const ids = [input.serviceId, ...input.addonIds];
  const rows = (await trx.selectFrom("services").selectAll().where("id", "in", ids).execute()).map(toService);
  const main = rows.find((s) => s.id === input.serviceId);
  if (!main || main.kind !== "main" || main.archived || !main.active)
    throw new AppError("invalid", "Pick a service that's on the menu.");
  const addons = input.addonIds.map((id) => {
    const a = rows.find((s) => s.id === id);
    if (!a || a.kind !== "addon" || a.archived || !a.active)
      throw new AppError("invalid", "An add-on isn't on the menu anymore.");
    return a;
  });
  const quote = quoteAppointment(rates(main), addons.map(rates), size);

  const groomer = await trx
    .selectFrom("staff")
    .select(["id", "name", "grooms", "active"])
    .where("id", "=", input.staffId)
    .executeTakeFirst();
  if (!groomer || !groomer.grooms || !groomer.active) throw new AppError("invalid", "Pick a groomer.");

  const start = timeToMinutes(input.start);
  const end = start + quote.minutes;
  const blockEnd = end + quote.bufferMinutes;
  if (blockEnd > 24 * 60) throw new AppError("invalid", "That runs past midnight. Pick an earlier time.");
  const startsAt = atLocal(input.day, start);
  const endsAt = atLocal(input.day, end);
  const blockEndsAt = atLocal(input.day, blockEnd);

  const warnings: string[] = [];
  const weekday = startsAt.getDay();
  const h = await trx
    .selectFrom("groomer_hours")
    .select(["start_time", "end_time"])
    .where("staff_id", "=", groomer.id)
    .where("weekday", "=", weekday)
    .executeTakeFirst();
  const hours = h ? { start: timeToMinutes(h.start_time), end: timeToMinutes(h.end_time) } : null;
  if (!hours) warnings.push(`${groomer.name} doesn't work on this day.`);
  else if (!withinHours(start, end, hours))
    warnings.push(
      `This is outside ${groomer.name}'s hours (${clockText(hours.start)} – ${clockText(hours.end)}).`,
    );
  const off = await trx
    .selectFrom("time_off")
    .select(["note"])
    .where("staff_id", "=", groomer.id)
    .where("starts_at", "<", endsAt)
    .where("ends_at", ">", startsAt)
    .executeTakeFirst();
  if (off) warnings.push(`${groomer.name} has time off then${off.note ? ` (${off.note})` : ""}.`);
  const vacc = await trx
    .selectFrom("vaccinations")
    .select(["vaccine", "expires_on"])
    .where("pet_id", "=", pet.id)
    .execute();
  const rabies = vacc.find((v) => v.vaccine.trim().toLowerCase() === "rabies");
  if (rabies && rabiesLapsed([{ vaccine: rabies.vaccine, expiresOn: rabies.expires_on }], input.day))
    warnings.push(
      `${pet.name}'s rabies vaccination expired ${rabies.expires_on}. Ask for proof before the groom.`,
    );

  let clashQ = trx
    .selectFrom("appointments")
    .select(["pet_name", "starts_at"])
    .where("staff_id", "=", groomer.id)
    .where("status", "not in", ["canceled", "no_show"])
    .where("starts_at", "<", blockEndsAt)
    .where("block_ends_at", ">", startsAt);
  if (ignoreId) clashQ = clashQ.where("id", "!=", ignoreId);
  const other = await clashQ.executeTakeFirst();
  const clash = other
    ? `${groomer.name} already has ${other.pet_name} at ${clockText(minutesOfDay(other.starts_at))}. Pick another time or groomer.`
    : null;

  return {
    quote,
    size,
    when: `${clockText(start)} – ${clockText(end)}`,
    warnings,
    clash,
    startsAt,
    endsAt,
    blockEndsAt,
    main,
    addons,
    petName: pet.name,
    setPetSize: !pet.size,
  };
}

/** What a booking would cost and take, and anything in the way. Nothing is saved. */
export const checkAppointment = defineHandler<BookingInput & { id?: string }, BookingCheck>({
  action: "grooming.book",
  async run(trx, _ctx, input) {
    const p = await planBooking(trx, input, input.id ?? null);
    return { quote: p.quote, size: p.size, when: p.when, warnings: p.warnings, clash: p.clash };
  },
});

function refuse(p: Plan, override: boolean | undefined) {
  if (p.clash) throw new AppError("conflict", p.clash);
  if (p.warnings.length && !override)
    throw new AppError("invalid", `${p.warnings.join(" ")} Tick "Book anyway" to go ahead.`);
}

/** Turns the database's double-booking refusal into the same plain message. */
async function saving<T>(
  trx: Trx,
  input: BookingInput,
  id: string | null,
  run: () => Promise<T>,
): Promise<T> {
  await sql`SAVEPOINT booking`.execute(trx);
  try {
    const r = await run();
    await sql`RELEASE SAVEPOINT booking`.execute(trx);
    return r;
  } catch (err) {
    await sql`ROLLBACK TO SAVEPOINT booking`.execute(trx);
    const e = err as { code?: string; message?: string };
    if (e?.code === "23P01" || e?.message?.includes("appointments_no_double_booking")) {
      const again = await planBooking(trx, input, id);
      throw new AppError(
        "conflict",
        again.clash ?? "That groomer is already booked then. Pick another time.",
      );
    }
    throw err;
  }
}

async function writeAddons(trx: Trx, ctx: Ctx, appointmentId: string, p: Plan) {
  await trx.deleteFrom("appointment_addons").where("appointment_id", "=", appointmentId).execute();
  for (const a of p.addons)
    await trx
      .insertInto("appointment_addons")
      .values({
        business_id: ctx.businessId,
        appointment_id: appointmentId,
        service_id: a.id,
        name: a.name,
        price_cents: a.priceCents[p.size],
        minutes: a.minutes[p.size],
      })
      .execute();
}

export const bookAppointment = defineHandler<BookingInput, AppointmentRow>({
  action: "grooming.book",
  async run(trx, ctx, input) {
    const p = await planBooking(trx, input, null);
    refuse(p, input.override);
    if (p.setPetSize)
      await trx.updateTable("pets").set({ size: p.size }).where("id", "=", input.petId).execute();
    const locationId = await currentLocationId(trx);
    const row = await saving(trx, input, null, () =>
      trx
        .insertInto("appointments")
        .values({
          business_id: ctx.businessId,
          location_id: locationId,
          customer_id: input.customerId,
          pet_id: input.petId,
          staff_id: input.staffId,
          service_id: p.main.id,
          service_name: p.main.name,
          pet_name: p.petName,
          size: p.size,
          starts_at: p.startsAt,
          ends_at: p.endsAt,
          block_ends_at: p.blockEndsAt,
          price_cents: p.quote.priceCents,
          notes: input.notes?.trim() || null,
          created_by: ctx.staffId,
        })
        .returning("id")
        .executeTakeFirstOrThrow(),
    );
    await writeAddons(trx, ctx, row.id, p);
    return (await appointmentRows(trx, { ids: [row.id] }))[0]!;
  },
});

export const updateAppointment = defineHandler<BookingInput & { id: string }, AppointmentRow>({
  action: "grooming.book",
  async run(trx, ctx, input) {
    const a = await trx
      .selectFrom("appointments")
      .select(["status"])
      .where("id", "=", input.id)
      .forUpdate()
      .executeTakeFirst();
    if (!a) throw new AppError("not_found", "That appointment doesn't exist.");
    if (["done", "canceled", "no_show"].includes(a.status))
      throw new AppError("invalid", "This appointment can't be changed anymore.");
    const p = await planBooking(trx, input, input.id);
    refuse(p, input.override);
    if (p.setPetSize)
      await trx.updateTable("pets").set({ size: p.size }).where("id", "=", input.petId).execute();
    await saving(trx, input, input.id, () =>
      trx
        .updateTable("appointments")
        .set({
          customer_id: input.customerId,
          pet_id: input.petId,
          staff_id: input.staffId,
          service_id: p.main.id,
          service_name: p.main.name,
          pet_name: p.petName,
          size: p.size,
          starts_at: p.startsAt,
          ends_at: p.endsAt,
          block_ends_at: p.blockEndsAt,
          price_cents: p.quote.priceCents,
          notes: input.notes?.trim() || null,
        })
        .where("id", "=", input.id)
        .execute(),
    );
    await writeAddons(trx, ctx, input.id, p);
    return (await appointmentRows(trx, { ids: [input.id] }))[0]!;
  },
});

const STAMP: Partial<Record<ApptStatus, "checked_in_at" | "started_at" | "ready_at" | "done_at">> = {
  checked_in: "checked_in_at",
  in_progress: "started_at",
  ready: "ready_at",
  done: "done_at",
};

/** Moves an appointment along (or back one step). Groomers can start a groom and mark it ready. */
export const setAppointmentStatus = defineHandler<{ id: string; status: ApptStatus }, AppointmentRow>({
  action: "grooming.view",
  async run(trx, ctx, { id, status }) {
    const a = await trx
      .selectFrom("appointments")
      .select(["status", "staff_id"])
      .where("id", "=", id)
      .forUpdate()
      .executeTakeFirst();
    if (!a) throw new AppError("not_found", "That appointment doesn't exist.");
    if (!canStep(a.status, status, ctx.role))
      throw new AppError("forbidden", "You can't make that change to this appointment.");
    const now = new Date();
    const order: ApptStatus[] = ["booked", "checked_in", "in_progress", "ready", "done"];
    const set: Record<string, Date | null | string> = { status };
    const stamp = STAMP[status];
    if (stamp && order.indexOf(status) > order.indexOf(a.status)) set[stamp] = now;
    // Going back a step clears the step undone.
    const undone = STAMP[a.status];
    if (undone && order.indexOf(status) < order.indexOf(a.status)) set[undone] = null;
    try {
      await trx.updateTable("appointments").set(set).where("id", "=", id).execute();
    } catch (err) {
      const e = err as { code?: string };
      if (e?.code === "23P01")
        throw new AppError(
          "conflict",
          "Someone else is booked in that slot now, so this can't go back to booked.",
        );
      throw err;
    }
    return (await appointmentRows(trx, { ids: [id] }))[0]!;
  },
});

export const cancelAppointment = defineHandler<{ id: string }, void>({
  action: "grooming.book",
  async run(trx, _ctx, { id }) {
    const a = await trx
      .selectFrom("appointments")
      .select(["status"])
      .where("id", "=", id)
      .forUpdate()
      .executeTakeFirst();
    if (!a) throw new AppError("not_found", "That appointment doesn't exist.");
    if (a.status === "done")
      throw new AppError("invalid", "This groom is done and paid. Refund the sale instead.");
    if (a.status === "canceled") return;
    await trx
      .updateTable("appointments")
      .set({ status: "canceled", canceled_at: new Date() })
      .where("id", "=", id)
      .execute();
  },
});

/** Upcoming appointments for the customer profile. */
export const customerAppointments = defineHandler<{ customerId: string }, AppointmentRow[]>({
  action: "customers.view",
  async run(trx, _ctx, { customerId }) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const rows = await appointmentRows(trx, { customerId, from: today });
    return rows.filter((r) => r.status !== "done" && r.status !== "no_show");
  },
});

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** For the customer delete: cancels their upcoming appointments (today on, not yet started). */
export async function cancelUpcomingFor(trx: Trx, customerId: string): Promise<number> {
  const res = await trx
    .updateTable("appointments")
    .set({ status: "canceled", canceled_at: new Date() })
    .where("customer_id", "=", customerId)
    .where("starts_at", ">=", startOfToday())
    .where("status", "in", ["booked", "checked_in"])
    .executeTakeFirst();
  return Number(res.numUpdatedRows);
}

export async function countUpcomingFor(trx: Trx, customerId: string): Promise<number> {
  const r = await trx
    .selectFrom("appointments")
    .select(sql<number>`count(*)::int`.as("n"))
    .where("customer_id", "=", customerId)
    .where("starts_at", ">=", startOfToday())
    .where("status", "in", ["booked", "checked_in"])
    .executeTakeFirstOrThrow();
  return r.n;
}
