import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { can, clockText, ROLE_LABEL, timeToMinutes, todayIso, type Role } from "@pet-pos/core";
import type { GroomerRow } from "@pet-pos/api";
import { useSession } from "../../session.tsx";
import { errorMessage } from "../../ui/errors.ts";
import { SlideOver } from "../../ui/SlideOver.tsx";
import { useToast } from "../../ui/Toast.tsx";

export const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Mon–Fri 8:00 AM – 4:00 PM, Sat 9:00 AM – 3:00 PM" */
export function hoursText(hours: GroomerRow["hours"]): string {
  if (!hours.length) return "No hours set";
  const groups: { days: number[]; start: string; end: string }[] = [];
  for (const h of [...hours].sort((a, b) => a.weekday - b.weekday)) {
    const g = groups.find((x) => x.start === h.start && x.end === h.end);
    if (g) g.days.push(h.weekday);
    else groups.push({ days: [h.weekday], start: h.start, end: h.end });
  }
  return groups
    .map(
      (g) =>
        `${g.days.map((d) => DAYS[d]).join(", ")} ${clockText(timeToMinutes(g.start))} – ${clockText(timeToMinutes(g.end))}`,
    )
    .join("; ");
}

export function GroomersView() {
  const { api, me } = useSession();
  const canEdit = can(me.staff.role, "grooming.manage");
  const list = useQuery({
    queryKey: ["groomers", canEdit ? "all" : "groomers"],
    queryFn: () => api.call("listGroomers", { all: canEdit }),
  });
  const [editing, setEditing] = useState<GroomerRow | null>(null);
  const rows = list.data ?? [];

  return (
    <>
      <h2>Groomers</h2>
      {list.isError && <p className="error-box">{errorMessage(list.error)}</p>}
      <div className="tablewrap">
        <table className="wide">
          <thead>
            <tr>
              <th>Staff</th>
              <th>Grooms</th>
              <th>Hours</th>
              <th>Time off</th>
              {canEdit && <th />}
            </tr>
          </thead>
          <tbody>
            {rows.map((g) => (
              <tr key={g.staffId}>
                <td>
                  <b>{g.name}</b>
                  <span className="sub">{ROLE_LABEL[g.role as Role]}</span>
                </td>
                <td>
                  {g.grooms ? <span className="tag ok">Yes</span> : <span className="tag muted">No</span>}
                </td>
                <td>{g.grooms ? hoursText(g.hours) : "—"}</td>
                <td>
                  {g.timeOff.length
                    ? g.timeOff
                        .map(
                          (t) =>
                            `${new Date(t.startsAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}${t.note ? ` (${t.note})` : ""}`,
                        )
                        .join(", ")
                    : "—"}
                </td>
                {canEdit && (
                  <td>
                    <button type="button" onClick={() => setEditing(g)}>
                      Edit
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        Staff with the Groomer role groom. Tick "Grooms" for anyone else who does, like an owner who grooms.
        Add staff in Settings.
      </p>
      {editing && <GroomerForm g={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function GroomerForm({ g, onClose }: { g: GroomerRow; onClose: () => void }) {
  const { api } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [grooms, setGrooms] = useState(g.grooms);
  const [days, setDays] = useState(() =>
    DAYS.map((_, d) => {
      const h = g.hours.find((x) => x.weekday === d);
      return { on: !!h, start: h?.start ?? "09:00", end: h?.end ?? "17:00" };
    }),
  );
  const [off, setOff] = useState({ day: todayIso(), allDay: true, start: "09:00", end: "17:00", note: "" });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["groomers"] });
    void qc.invalidateQueries({ queryKey: ["groomingDay"] });
  };
  const save = useMutation({
    mutationFn: () =>
      api.call("saveGroomer", {
        staffId: g.staffId,
        grooms,
        hours: grooms
          ? days.flatMap((d, i) => (d.on ? [{ weekday: i, start: d.start, end: d.end }] : []))
          : [],
      }),
    onSuccess: () => {
      toast("Hours saved");
      refresh();
      onClose();
    },
    onError: (err) => toast(errorMessage(err)),
  });
  const addOff = useMutation({
    mutationFn: () => {
      const [y, m, d] = off.day.split("-").map(Number) as [number, number, number];
      const at = (t: string) => {
        const n = timeToMinutes(t);
        return new Date(y, m - 1, d, Math.floor(n / 60), n % 60);
      };
      return api.call("addTimeOff", {
        staffId: g.staffId,
        startsAt: (off.allDay ? new Date(y, m - 1, d) : at(off.start)).toISOString(),
        endsAt: (off.allDay ? new Date(y, m - 1, d + 1) : at(off.end)).toISOString(),
        note: off.note,
      });
    },
    onSuccess: () => {
      toast("Time off added");
      refresh();
      onClose();
    },
    onError: (err) => toast(errorMessage(err)),
  });
  const removeOff = useMutation({
    mutationFn: (id: string) => api.call("removeTimeOff", { id }),
    onSuccess: () => {
      toast("Time off removed");
      refresh();
      onClose();
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }
  const setDay = (i: number, v: Partial<(typeof days)[number]>) =>
    setDays(days.map((d, j) => (j === i ? { ...d, ...v } : d)));
  const firstOn = days.find((d) => d.on);

  return (
    <SlideOver title={g.name} onClose={onClose}>
      <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
        <label className="check">
          <input type="checkbox" checked={grooms} onChange={(e) => setGrooms(e.target.checked)} />
          Grooms (shows on the grooming calendar)
        </label>
        {grooms && (
          <fieldset style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 6 }}>
            <legend style={{ fontWeight: 700, marginBottom: 6 }}>Weekly hours</legend>
            {days.map((d, i) => (
              <div key={i} className="actions" style={{ alignItems: "center" }}>
                <label className="check" style={{ width: 70 }}>
                  <input
                    type="checkbox"
                    checked={d.on}
                    onChange={(e) => setDay(i, { on: e.target.checked })}
                  />
                  {DAYS[i]}
                </label>
                <input
                  type="time"
                  step={900}
                  value={d.start}
                  disabled={!d.on}
                  aria-label={`${DAYS[i]} start`}
                  onChange={(e) => setDay(i, { start: e.target.value })}
                  style={{ width: "auto" }}
                />
                <span className="muted">to</span>
                <input
                  type="time"
                  step={900}
                  value={d.end}
                  disabled={!d.on}
                  aria-label={`${DAYS[i]} end`}
                  onChange={(e) => setDay(i, { end: e.target.value })}
                  style={{ width: "auto" }}
                />
              </div>
            ))}
            {firstOn && (
              <div>
                <button
                  type="button"
                  className="link"
                  onClick={() =>
                    setDays(days.map((d) => (d.on ? { ...d, start: firstOn.start, end: firstOn.end } : d)))
                  }
                >
                  Same hours every day they work
                </button>
              </div>
            )}
          </fieldset>
        )}
        <div className="actions">
          <button className="primary" disabled={save.isPending}>
            Save hours
          </button>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>

      {grooms && (
        <section style={{ display: "grid", gap: 8 }}>
          <h3 style={{ margin: 0 }}>Time off</h3>
          {g.timeOff.map((t) => (
            <div key={t.id} className="actions" style={{ alignItems: "center" }}>
              <span>
                {new Date(t.startsAt).toLocaleString([], {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}{" "}
                –{" "}
                {new Date(t.endsAt).toLocaleString([], {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
                {t.note ? ` · ${t.note}` : ""}
              </span>
              <button type="button" className="link" onClick={() => removeOff.mutate(t.id)}>
                Remove
              </button>
            </div>
          ))}
          <div className="form" style={{ alignItems: "end" }}>
            <label>
              Day
              <input type="date" value={off.day} onChange={(e) => setOff({ ...off, day: e.target.value })} />
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={off.allDay}
                onChange={(e) => setOff({ ...off, allDay: e.target.checked })}
              />
              All day
            </label>
            {!off.allDay && (
              <>
                <label>
                  From
                  <input
                    type="time"
                    step={900}
                    value={off.start}
                    onChange={(e) => setOff({ ...off, start: e.target.value })}
                  />
                </label>
                <label>
                  To
                  <input
                    type="time"
                    step={900}
                    value={off.end}
                    onChange={(e) => setOff({ ...off, end: e.target.value })}
                  />
                </label>
              </>
            )}
            <label>
              Note
              <input
                value={off.note}
                onChange={(e) => setOff({ ...off, note: e.target.value })}
                placeholder="Vet appointment"
              />
            </label>
            <button type="button" onClick={() => addOff.mutate()} disabled={addOff.isPending}>
              Add time off
            </button>
          </div>
        </section>
      )}
    </SlideOver>
  );
}
