import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { clockText, minutesToTime, timeToMinutes } from "@pet-pos/core";
import type { CalloutChange, CalloutRow } from "@pet-pos/api";
import { useSession } from "../../session.tsx";
import { errorMessage } from "../../ui/errors.ts";
import { SlideOver } from "../../ui/SlideOver.tsx";
import { useToast } from "../../ui/Toast.tsx";

type Choice = { action: "move" | "leave" | "cancel"; staffId: string; start: number };

/** The starting choice for each row: the suggested groomer, or leave it for a new time. */
export function initialChoices(rows: CalloutRow[]): Record<string, Choice> {
  return Object.fromEntries(
    rows.map((r) => [
      r.appointment.id,
      r.suggestion
        ? { action: "move" as const, staffId: r.suggestion.staffId, start: r.appointment.start }
        : { action: "leave" as const, staffId: "", start: r.appointment.start },
    ]),
  );
}

/** What gets sent: a move with its groomer and time, a cancel, or leave. */
export function toChanges(rows: CalloutRow[], choices: Record<string, Choice>, day: string): CalloutChange[] {
  return rows.map((r) => {
    const c = choices[r.appointment.id]!;
    if (c.action === "move")
      return { id: r.appointment.id, action: "move", staffId: c.staffId, day, start: c.start };
    return { id: r.appointment.id, action: c.action };
  });
}

/** A groomer called out: move, cancel or leave each of their appointments, all at once. */
export function CalloutPanel({ day: startDay, onClose }: { day: string; onClose: () => void }) {
  const { api } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [day, setDay] = useState(startDay);
  const [staffId, setStaffId] = useState("");
  const [choices, setChoices] = useState<Record<string, Choice> | null>(null);
  const [notify, setNotify] = useState(true);
  const groomers = useQuery({ queryKey: ["groomers"], queryFn: () => api.call("listGroomers", {}) });
  const preview = useQuery({
    queryKey: ["calloutPreview", staffId, day],
    queryFn: () => api.call("calloutPreview", { staffId, day }),
    enabled: !!staffId,
  });
  const rows = preview.data ?? [];
  const picked = choices ?? (preview.data ? initialChoices(preview.data) : {});
  const others = (groomers.data ?? []).filter((g) => g.staffId !== staffId);

  const apply = useMutation({
    mutationFn: () =>
      api.call("applyCallout", {
        staffId,
        day,
        changes: toChanges(rows, picked, day),
        notify,
        addTimeOff: true,
      }),
    onSuccess: (r) => {
      toast(
        `Done: ${r.moved} moved, ${r.canceled} canceled, ${r.left} left${r.texts ? ` · ${r.texts} text${r.texts === 1 ? "" : "s"} saved` : ""}`,
      );
      for (const k of ["groomingDay", "groomingWeek", "groomers", "customerAppointments"])
        void qc.invalidateQueries({ queryKey: [k] });
      onClose();
    },
    onError: (err) => toast(errorMessage(err)),
  });

  const set = (id: string, c: Partial<Choice>) => setChoices({ ...picked, [id]: { ...picked[id]!, ...c } });

  return (
    <SlideOver title="Groomer called out" onClose={onClose}>
      <div style={{ display: "grid", gap: 12 }}>
        <div className="form">
          <label>
            Groomer
            <select
              value={staffId}
              onChange={(e) => {
                setStaffId(e.target.value);
                setChoices(null);
              }}
            >
              <option value="">Pick who called out</option>
              {(groomers.data ?? []).map((g) => (
                <option key={g.staffId} value={g.staffId}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Day
            <input
              type="date"
              value={day}
              onChange={(e) => {
                if (!e.target.value) return;
                setDay(e.target.value);
                setChoices(null);
              }}
            />
          </label>
        </div>
        {preview.isError && <p className="error-box">{errorMessage(preview.error)}</p>}
        {staffId && preview.data && rows.length === 0 && (
          <p className="muted">No appointments to move that day.</p>
        )}
        {rows.map((r) => {
          const a = r.appointment;
          const c = picked[a.id]!;
          return (
            <div key={a.id} className="mycard" aria-label={`${a.petName} at ${clockText(a.start)}`}>
              <span>
                <b>{clockText(a.start)}</b> · {a.petName} · {a.label} · {a.customerName ?? ""}
              </span>
              <span className="muted small">
                {r.suggestion
                  ? `Suggested: ${r.suggestion.name} at the same time`
                  : "Nobody is free then: needs a new time"}
              </span>
              <div className="form" style={{ alignItems: "end" }}>
                <label>
                  What to do
                  <select
                    value={c.action}
                    onChange={(e) => set(a.id, { action: e.target.value as Choice["action"] })}
                    aria-label={`What to do with ${a.petName}`}
                  >
                    <option value="move">Move</option>
                    <option value="leave">Leave it (call the customer)</option>
                    <option value="cancel">Cancel</option>
                  </select>
                </label>
                {c.action === "move" && (
                  <>
                    <label>
                      To
                      <select
                        value={c.staffId}
                        onChange={(e) => set(a.id, { staffId: e.target.value })}
                        aria-label={`Move ${a.petName} to`}
                      >
                        <option value="">Pick a groomer</option>
                        {others.map((g) => (
                          <option key={g.staffId} value={g.staffId}>
                            {g.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      At
                      <input
                        type="time"
                        step={900}
                        value={minutesToTime(c.start)}
                        onChange={(e) =>
                          e.target.value && set(a.id, { start: timeToMinutes(e.target.value) })
                        }
                        aria-label={`New time for ${a.petName}`}
                      />
                    </label>
                  </>
                )}
              </div>
            </div>
          );
        })}
        {rows.length > 0 && (
          <>
            <label className="check">
              <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
              Text the customers whose time or groomer changed
            </label>
            <p className="muted small" style={{ margin: 0 }}>
              Applying also adds all-day time off for the groomer, so nobody books them by mistake. In the
              demo, texts are saved as previews, not sent.
            </p>
            <div className="actions">
              <button
                type="button"
                className="primary"
                disabled={
                  apply.isPending ||
                  rows.some(
                    (r) => picked[r.appointment.id]?.action === "move" && !picked[r.appointment.id]?.staffId,
                  )
                }
                onClick={() => apply.mutate()}
              >
                Apply changes
              </button>
              <button type="button" onClick={onClose}>
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </SlideOver>
  );
}
