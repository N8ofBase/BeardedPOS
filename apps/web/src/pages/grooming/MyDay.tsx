import { clockText, nextSteps, STATUS_LABEL } from "@pet-pos/core";
import type { AppointmentRow } from "@pet-pos/api";
import { useSession } from "../../session.tsx";
import { PetAlerts, useStatus } from "./AppointmentPanel.tsx";

/**
 * A groomer's day on a phone: their appointments in order, each with one big button
 * for the next step (Start groom, then Ready for pickup) and a small Undo.
 */
export function MyDay({
  appointments,
  onOpen,
}: {
  appointments: AppointmentRow[];
  onOpen: (a: AppointmentRow) => void;
}) {
  const { me } = useSession();
  const status = useStatus();
  const list = appointments.filter((a) => a.status !== "canceled").sort((a, b) => a.start - b.start);

  if (!list.length) return <p className="muted">No appointments.</p>;

  return (
    <div className="myday">
      {list.map((a) => {
        const steps = nextSteps(a.status, me.staff.role);
        const forward = steps.find((s) => !s.undo);
        const back = steps.find((s) => s.undo);
        return (
          <article className="mycard" key={a.id} aria-label={`${a.petName} at ${clockText(a.start)}`}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
              <span className="when">{clockText(a.start)}</span>
              <span className={`chip ${a.status}`}>{STATUS_LABEL[a.status]}</span>
            </div>
            <button type="button" className="link" style={{ textAlign: "left" }} onClick={() => onOpen(a)}>
              <b>{a.petName}</b>
              {a.breed ? ` · ${a.breed}` : ""} · size {a.size}
            </button>
            <span>{a.label}</span>
            <span className="muted small">
              until {clockText(a.end)} · {a.groomerName}
            </span>
            <PetAlerts a={a} />
            {a.notes && (
              <span>
                <b>Notes:</b> {a.notes}
              </span>
            )}
            {forward && (
              <button
                type="button"
                className="primary big"
                disabled={status.isPending}
                onClick={() => status.mutate({ id: a.id, status: forward.to })}
              >
                {forward.label}
              </button>
            )}
            {back && (
              <button
                type="button"
                className="link"
                disabled={status.isPending}
                onClick={() => status.mutate({ id: a.id, status: back.to })}
              >
                {back.label}
              </button>
            )}
          </article>
        );
      })}
    </div>
  );
}
