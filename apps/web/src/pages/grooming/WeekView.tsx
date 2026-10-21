import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { clockText, formatMoney, shortDay, STATUS_LABEL, todayIso, weekStart } from "@pet-pos/core";
import type { AppointmentRow, GroomingDay } from "@pet-pos/api";
import { useSession } from "../../session.tsx";
import { errorMessage } from "../../ui/errors.ts";

/** Every groomer who works or has a booking that week, in name order. */
export function weekGroomers(days: GroomingDay[]): { staffId: string; name: string }[] {
  const seen = new Map<string, string>();
  for (const d of days) for (const g of d.groomers) seen.set(g.staffId, g.name);
  return [...seen].map(([staffId, name]) => ({ staffId, name })).sort((a, b) => a.name.localeCompare(b.name));
}

/** Whether a groomer works that day (false for days off and all-day time off). */
export function worksOn(day: GroomingDay, staffId: string): boolean {
  const g = day.groomers.find((x) => x.staffId === staffId);
  if (!g?.hours) return false;
  return !g.timeOff.some((t) => t.start <= g.hours!.start && t.end >= g.hours!.end);
}

function Chip({
  a,
  onOpen,
  showGroomer,
}: {
  a: AppointmentRow;
  onOpen: (a: AppointmentRow) => void;
  showGroomer?: boolean;
}) {
  return (
    <button
      type="button"
      className={`wk-chip ${a.status}`}
      onClick={() => onOpen(a)}
      aria-label={`${a.petName} ${clockText(a.start)}, ${STATUS_LABEL[a.status]}`}
    >
      <b>{clockText(a.start).replace(":00", "")}</b> {a.petName} · {a.serviceName}
      {showGroomer ? ` · ${a.groomerName}` : ""}
    </button>
  );
}

/**
 * The week, Monday to Sunday. Everyone: a row per groomer, a cell per day. One
 * groomer: their week by day. Phones get a list by day.
 */
export function WeekView({
  day,
  narrow,
  onOpen,
  onPickDay,
}: {
  day: string;
  narrow: boolean;
  onOpen: (a: AppointmentRow) => void;
  onPickDay: (day: string) => void;
}) {
  const { api, me } = useSession();
  const start = weekStart(day);
  const [who, setWho] = useState(me.staff.role === "groomer" ? me.staff.id : "");
  const q = useQuery({
    queryKey: ["groomingWeek", start],
    queryFn: () => api.call("groomingWeek", { start }),
  });
  if (q.isError) return <p className="error-box">{errorMessage(q.error)}</p>;
  if (!q.data) return <p className="muted">Loading the week…</p>;
  const days = q.data.days;
  const groomers = weekGroomers(days);
  const today = todayIso();
  const live = (d: GroomingDay) => d.appointments.filter((a) => !who || a.staffId === who);

  const picker = groomers.length > 1 && (
    <label style={{ maxWidth: 320 }}>
      Groomer
      <select value={who} onChange={(e) => setWho(e.target.value)}>
        <option value="">Everyone</option>
        {groomers.map((g) => (
          <option key={g.staffId} value={g.staffId}>
            {g.name}
          </option>
        ))}
      </select>
    </label>
  );

  if (narrow || who)
    return (
      <>
        {picker}
        <div className="myday">
          {days.map((d) => {
            const list = live(d);
            const off = who && !worksOn(d, who);
            return (
              <section key={d.day} className="mycard" aria-label={shortDay(d.day)}>
                <button
                  type="button"
                  className="link"
                  style={{ textAlign: "left" }}
                  onClick={() => onPickDay(d.day)}
                >
                  <b>
                    {shortDay(d.day)}
                    {d.day === today ? " · Today" : ""}
                  </b>
                </button>
                {off && <span className="muted small">Not working</span>}
                {list.map((a) => (
                  <Chip key={a.id} a={a} onOpen={onOpen} showGroomer={!who} />
                ))}
                {!list.length && !off && <span className="muted small">No appointments</span>}
              </section>
            );
          })}
        </div>
      </>
    );

  return (
    <>
      {picker}
      <div className="calwrap">
        <div className="week" style={{ gridTemplateColumns: `160px repeat(7, minmax(120px, 1fr))` }}>
          <div className="wk-hd" />
          {days.map((d) => {
            const n = d.appointments.filter((a) => a.status !== "no_show").length;
            return (
              <button
                type="button"
                key={d.day}
                className="wk-hd"
                style={{
                  textAlign: "left",
                  borderRadius: 0,
                  border: 0,
                  borderBottom: "1px solid var(--line)",
                }}
                onClick={() => onPickDay(d.day)}
                aria-label={`Open ${shortDay(d.day)}`}
              >
                {shortDay(d.day)}
                {d.day === today ? " · Today" : ""}
                <small>
                  {n} appt{n === 1 ? "" : "s"} · {formatMoney(d.summary.expectedCents)}
                </small>
              </button>
            );
          })}
          {groomers.map((g) => (
            <div key={g.staffId} style={{ display: "contents" }}>
              <div className="wk-hd">{g.name}</div>
              {days.map((d) => {
                const list = d.appointments.filter((a) => a.staffId === g.staffId);
                const off = !worksOn(d, g.staffId);
                return (
                  <div
                    key={d.day}
                    className={`cell${off ? " off" : ""}`}
                    data-testid={`cell-${g.name}-${d.day}`}
                  >
                    {list.map((a) => (
                      <Chip key={a.id} a={a} onOpen={onOpen} />
                    ))}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      {!groomers.length && <p className="muted">No groomers this week. Set groomer hours under Groomers.</p>}
    </>
  );
}
