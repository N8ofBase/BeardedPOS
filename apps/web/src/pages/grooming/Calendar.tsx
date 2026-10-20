import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { addDays, can, clockText, formatMoney, STATUS_LABEL, todayIso } from "@pet-pos/core";
import type { AppointmentRow, DayGroomer } from "@pet-pos/api";
import { useSession } from "../../session.tsx";
import { errorMessage } from "../../ui/errors.ts";
import { AppointmentPanel } from "./AppointmentPanel.tsx";
import { BookingPanel, type BookingStart } from "./BookingPanel.tsx";
import { MyDay } from "./MyDay.tsx";

/** 30-minute rows, 34 px tall, as in the prototype. */
export const SLOT = 30;
export const SLOT_PX = 34;

/** True on a phone-sized screen, where the calendar columns are too cramped. */
export function useNarrow(width = 700): boolean {
  const query = `(max-width: ${width - 1}px)`;
  const [narrow, setNarrow] = useState(
    () => typeof window !== "undefined" && !!window.matchMedia?.(query).matches,
  );
  useEffect(() => {
    const m = window.matchMedia?.(query);
    if (!m) return;
    const on = () => setNarrow(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, [query]);
  return narrow;
}

/** The hours the grid shows: whole hours around the earliest start and latest end. */
export function gridHours(groomers: DayGroomer[], appts: AppointmentRow[]): { from: number; to: number } {
  const starts = [...groomers.flatMap((g) => (g.hours ? [g.hours.start] : [])), ...appts.map((a) => a.start)];
  const ends = [...groomers.flatMap((g) => (g.hours ? [g.hours.end] : [])), ...appts.map((a) => a.blockEnd)];
  if (!starts.length) return { from: 9 * 60, to: 17 * 60 };
  return { from: Math.floor(Math.min(...starts) / 60) * 60, to: Math.ceil(Math.max(...ends) / 60) * 60 };
}

/** Top and height in px for an appointment on the grid. */
export function placeBlock(
  a: Pick<AppointmentRow, "start" | "end">,
  from: number,
): { top: number; height: number } {
  return {
    top: ((a.start - from) / SLOT) * SLOT_PX + 2,
    height: Math.max(SLOT_PX - 4, ((a.end - a.start) / SLOT) * SLOT_PX - 4),
  };
}

export function Calendar({ bookFor }: { bookFor?: string | null }) {
  const { api, me } = useSession();
  const canBook = can(me.staff.role, "grooming.book");
  const isGroomer = me.staff.role === "groomer";
  const narrow = useNarrow();
  const [day, setDay] = useState(todayIso());
  const [listView, setListView] = useState(isGroomer);
  const [who, setWho] = useState<string>(isGroomer ? me.staff.id : "");
  const [booking, setBooking] = useState<{ from: BookingStart; editing?: AppointmentRow } | null>(
    bookFor && canBook ? { from: { day: todayIso(), customerId: bookFor } } : null,
  );
  const [openId, setOpenId] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["groomingDay", day], queryFn: () => api.call("groomingDay", { day }) });
  const data = q.data;
  const open = data?.appointments.find((a) => a.id === openId) ?? null;
  const today = todayIso();
  const showList = listView || narrow;

  return (
    <>
      <div className="toolbar" style={{ justifyContent: "space-between" }}>
        <div className="actions" style={{ alignItems: "center" }}>
          <button type="button" aria-label="Previous day" onClick={() => setDay(addDays(day, -1))}>
            ‹
          </button>
          <button type="button" onClick={() => setDay(today)} aria-pressed={day === today}>
            Today
          </button>
          <button type="button" aria-label="Next day" onClick={() => setDay(addDays(day, 1))}>
            ›
          </button>
          <input
            type="date"
            value={day}
            onChange={(e) => e.target.value && setDay(e.target.value)}
            aria-label="Pick a date"
            style={{ width: "auto" }}
          />
          <b style={{ fontFamily: "var(--display)" }}>
            {new Date(`${day}T12:00:00`).toLocaleDateString(undefined, {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
            {day === today ? " · Today" : ""}
          </b>
        </div>
        <div className="actions">
          {!narrow && (
            <div className="seg" role="group" aria-label="View">
              <button type="button" aria-pressed={!listView} onClick={() => setListView(false)}>
                Calendar
              </button>
              <button type="button" aria-pressed={listView} onClick={() => setListView(true)}>
                {isGroomer ? "My day" : "List"}
              </button>
            </div>
          )}
          {canBook && (
            <button type="button" className="primary" onClick={() => setBooking({ from: { day } })}>
              Book appointment
            </button>
          )}
        </div>
      </div>

      {q.isError && <p className="error-box">{errorMessage(q.error)}</p>}
      {data && (
        <div className="kpis">
          <Kpi label="Appointments" value={String(data.summary.appointments)} />
          <Kpi label="In the shop now" value={String(data.summary.inShop)} />
          <Kpi label="Ready for pickup" value={String(data.summary.ready)} />
          <Kpi label="Grooming sales" value={formatMoney(data.summary.expectedCents)} />
        </div>
      )}

      {data && showList && (
        <>
          {data.groomers.length > 1 && (
            <label style={{ maxWidth: 320 }}>
              Groomer
              <select value={who} onChange={(e) => setWho(e.target.value)}>
                <option value="">Everyone</option>
                {data.groomers.map((g) => (
                  <option key={g.staffId} value={g.staffId}>
                    {g.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <MyDay
            appointments={data.appointments.filter((a) => !who || a.staffId === who)}
            onOpen={(a) => setOpenId(a.id)}
          />
        </>
      )}

      {data && !showList && (
        <DayGrid
          groomers={data.groomers}
          appointments={data.appointments}
          canBook={canBook}
          onBook={(staffId, start) => setBooking({ from: { day, staffId, start } })}
          onOpen={(a) => setOpenId(a.id)}
          day={day}
        />
      )}
      {!showList && (
        <p className="muted small">
          Tap an open time to book it. Tap an appointment to check it in, start the groom or mark it ready.
        </p>
      )}

      {open && (
        <AppointmentPanel
          a={open}
          onClose={() => setOpenId(null)}
          onEdit={() => {
            setOpenId(null);
            setBooking({ from: { day }, editing: open });
          }}
        />
      )}
      {booking && (
        <BookingPanel from={booking.from} editing={booking.editing} onClose={() => setBooking(null)} />
      )}
    </>
  );
}

function DayGrid({
  groomers,
  appointments,
  canBook,
  onBook,
  onOpen,
  day,
}: {
  groomers: DayGroomer[];
  appointments: AppointmentRow[];
  canBook: boolean;
  onBook: (staffId: string, start: number) => void;
  onOpen: (a: AppointmentRow) => void;
  day: string;
}) {
  if (!groomers.length)
    return (
      <p className="muted panel">
        No groomers work on {new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: "long" })}s.
        Set groomer hours under Groomers.
      </p>
    );
  const { from, to } = gridHours(groomers, appointments);
  const rows = (to - from) / SLOT;
  const height = rows * SLOT_PX;
  return (
    <div className="calwrap">
      <div
        className="cal"
        style={{ gridTemplateColumns: `56px repeat(${groomers.length}, minmax(170px, 1fr))` }}
      >
        <div className="hd" />
        {groomers.map((g) => (
          <div className="hd" key={g.staffId}>
            {g.name}
            <small>
              {g.hours ? `${clockText(g.hours.start)} – ${clockText(g.hours.end)}` : "Not working today"}
            </small>
          </div>
        ))}
        <div className="times" style={{ height }}>
          {Array.from({ length: rows / 2 + 1 }, (_, i) => (
            <span key={i} style={{ top: i * 2 * SLOT_PX }}>
              {i === 0 ? "" : clockText(from + i * 60).replace(":00", "")}
            </span>
          ))}
        </div>
        {groomers.map((g) => (
          <div className="col" style={{ height }} key={g.staffId} data-testid={`col-${g.name}`}>
            {Array.from({ length: rows }, (_, i) => {
              const m = from + i * SLOT;
              const off = !g.hours || m < g.hours.start || m >= g.hours.end;
              const hour = (i + 1) % 2 === 0 ? " hour" : "";
              return off || !canBook ? (
                <div
                  key={i}
                  className={`slot${off ? " off" : ""}${hour}`}
                  style={{ height: SLOT_PX }}
                  aria-hidden="true"
                />
              ) : (
                <button
                  type="button"
                  key={i}
                  className={`slot${hour}`}
                  style={{ height: SLOT_PX }}
                  aria-label={`Book ${g.name} at ${clockText(m)}`}
                  onClick={() => onBook(g.staffId, m)}
                />
              );
            })}
            {g.timeOff.map((t, i) => {
              const s = Math.max(t.start, from);
              const e = Math.min(t.end, to);
              if (e <= s) return null;
              return (
                <div
                  key={`off${i}`}
                  className="timeoff"
                  style={{ top: ((s - from) / SLOT) * SLOT_PX, height: ((e - s) / SLOT) * SLOT_PX }}
                >
                  Time off{t.note ? `: ${t.note}` : ""}
                </div>
              );
            })}
            {appointments
              .filter((a) => a.staffId === g.staffId)
              .map((a) => {
                const { top, height: h } = placeBlock(a, from);
                return (
                  <button
                    type="button"
                    key={a.id}
                    className={`appt ${a.status}`}
                    style={{ top, height: h }}
                    onClick={() => onOpen(a)}
                    aria-label={`${a.petName} at ${clockText(a.start)}, ${STATUS_LABEL[a.status]}`}
                  >
                    <b>{a.petName}</b> <span className="muted">{clockText(a.start)}</span>
                    {a.rabiesLapsed && <span title="Rabies expired"> ⚠</span>}
                    <br />
                    {a.serviceName} · {a.size}
                    {h > 60 && (
                      <>
                        <br />
                        <span className="muted">{a.customerName ?? ""}</span>
                      </>
                    )}
                    {h > 84 && (
                      <>
                        <br />
                        <span className={`chip ${a.status}`}>{STATUS_LABEL[a.status]}</span>
                      </>
                    )}
                  </button>
                );
              })}
          </div>
        ))}
      </div>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="kpi">
      <span className="muted">{label}</span>
      <b className="num">{value}</b>
    </div>
  );
}
