import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import {
  can,
  clockText,
  formatMoney,
  formatPhone,
  nextSteps,
  STATUS_LABEL,
  type ApptStatus,
} from "@pet-pos/core";
import type { AppointmentRow } from "@pet-pos/api";
import { useSession } from "../../session.tsx";
import { errorMessage } from "../../ui/errors.ts";
import { SlideOver } from "../../ui/SlideOver.tsx";
import { useToast } from "../../ui/Toast.tsx";
import { TwoTapButton } from "../../ui/TwoTapButton.tsx";
import { AppointmentNotes } from "./Notes.tsx";

/** Moves an appointment to a status, with the toasts the counter needs. */
export function useStatus() {
  const { api } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (v: { id: string; status: ApptStatus }) => api.call("setAppointmentStatus", v),
    onSuccess: (a) => {
      toast(
        a.status === "ready" && a.customerPhone
          ? `${a.petName} is ready. Text ${formatPhone(a.customerPhone)} to let them know.`
          : `${a.petName}: ${STATUS_LABEL[a.status].toLowerCase()}`,
      );
      void qc.invalidateQueries({ queryKey: ["groomingDay"] });
      void qc.invalidateQueries({ queryKey: ["customerAppointments"] });
    },
    onError: (err) => toast(errorMessage(err)),
  });
}

/** Rabies, allergies and coat notes, the things a groomer must see first. */
export function PetAlerts({ a }: { a: AppointmentRow }) {
  return (
    <>
      {a.rabiesLapsed && <span className="tag out">Rabies expired. Ask for proof before the groom.</span>}
      {a.allergies && (
        <span>
          <b>Allergies:</b> {a.allergies}
        </span>
      )}
      {(a.coat || a.temperament) && (
        <span className="muted">{[a.coat, a.temperament].filter(Boolean).join(" · ")}</span>
      )}
      {a.lastNote && (
        <span>
          <b>Last time:</b> {a.lastNote}
        </span>
      )}
    </>
  );
}

export function AppointmentPanel({
  a,
  onEdit,
  onClose,
}: {
  a: AppointmentRow;
  onEdit: () => void;
  onClose: () => void;
}) {
  const { api, me } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const status = useStatus();
  const role = me.staff.role;
  const canBook = can(role, "grooming.book");
  const steps = nextSteps(a.status, role);
  const cancel = useMutation({
    mutationFn: () => api.call("cancelAppointment", { id: a.id }),
    onSuccess: () => {
      toast("Appointment canceled");
      void qc.invalidateQueries({ queryKey: ["groomingDay"] });
      void qc.invalidateQueries({ queryKey: ["customerAppointments"] });
      onClose();
    },
    onError: (err) => toast(errorMessage(err)),
  });
  const open = !["done", "canceled", "no_show"].includes(a.status);

  return (
    <SlideOver title={`${a.petName} · ${a.serviceName}`} onClose={onClose}>
      <div style={{ display: "grid", gap: 10 }}>
        <span>
          <span className={`chip ${a.status}`}>{STATUS_LABEL[a.status]}</span>
        </span>
        <div className="kpis">
          <div className="kpi">
            <span className="muted">When</span>
            <b style={{ fontSize: "1rem" }}>
              {clockText(a.start)} – {clockText(a.end)}
            </b>
            <span className="muted small">
              {new Date(a.startsAt).toLocaleDateString(undefined, {
                weekday: "short",
                month: "short",
                day: "numeric",
              })}{" "}
              · {a.groomerName}
            </span>
          </div>
          <div className="kpi">
            <span className="muted">Customer</span>
            <b style={{ fontSize: "1rem" }}>{a.customerName ?? "Customer deleted"}</b>
            <span className="muted mono">{formatPhone(a.customerPhone)}</span>
          </div>
          <div className="kpi">
            <span className="muted">Price · size {a.size}</span>
            <b className="num">{formatMoney(a.priceCents)}</b>
            <span className="muted small">{a.label}</span>
          </div>
        </div>
        <PetAlerts a={a} />
        {a.notes && (
          <p style={{ margin: 0 }}>
            <b>Notes:</b> {a.notes}
          </p>
        )}
        <div className="actions">
          {steps.map((s) => (
            <button
              type="button"
              key={s.to}
              className={s.undo ? "" : "primary"}
              disabled={status.isPending}
              onClick={() => status.mutate({ id: a.id, status: s.to })}
            >
              {s.label}
            </button>
          ))}
          {can(role, "register.use") &&
            ["booked", "checked_in", "in_progress", "ready"].includes(a.status) &&
            a.customerId && (
              <button
                type="button"
                className={a.status === "ready" ? "primary" : ""}
                onClick={() =>
                  navigate("/register", {
                    state: { groom: { appointmentId: a.id, customerId: a.customerId } },
                  })
                }
              >
                Check out at register
              </button>
            )}
          {canBook && open && (
            <button type="button" onClick={onEdit}>
              Edit
            </button>
          )}
          {canBook && a.status !== "done" && a.status !== "canceled" && (
            <TwoTapButton
              className="dangerbtn"
              label="Cancel appointment"
              confirmLabel="Tap again to cancel"
              disabled={cancel.isPending}
              onConfirm={() => cancel.mutate()}
            />
          )}
        </div>
        {a.status === "done" && (
          <p style={{ margin: 0 }}>
            {a.receiptNumber ? `Paid · receipt #${a.receiptNumber}` : "Done (paid outside the register)"}
            {a.saleRefundedCents > 0 && (
              <span className="tag low"> Refunded {formatMoney(a.saleRefundedCents)}</span>
            )}
          </p>
        )}
        <AppointmentNotes appointmentId={a.id} />
      </div>
    </SlideOver>
  );
}
