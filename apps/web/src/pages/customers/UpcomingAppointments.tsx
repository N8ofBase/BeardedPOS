import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { can, clockText, STATUS_LABEL } from "@pet-pos/core";
import { useSession } from "../../session.tsx";
import { errorMessage } from "../../ui/errors.ts";

/** Upcoming appointments on the customer profile, with Book appointment. */
export function UpcomingAppointments({ customerId }: { customerId: string }) {
  const { api, me } = useSession();
  const navigate = useNavigate();
  const q = useQuery({
    queryKey: ["customerAppointments", customerId],
    queryFn: () => api.call("customerAppointments", { customerId }),
  });
  const canBook = can(me.staff.role, "grooming.book");

  return (
    <section className="panel">
      <div className="toolbar" style={{ justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>Upcoming appointments</h2>
        {canBook && (
          <button type="button" onClick={() => navigate("/grooming", { state: { bookFor: customerId } })}>
            Book appointment
          </button>
        )}
      </div>
      {q.isError && <p className="error-box">{errorMessage(q.error)}</p>}
      {q.data?.length === 0 && <p className="muted">No upcoming appointments.</p>}
      {q.data?.map((a) => (
        <div key={a.id} className="actions" style={{ alignItems: "baseline" }}>
          <b className="num">
            {new Date(a.startsAt).toLocaleDateString(undefined, {
              weekday: "short",
              month: "short",
              day: "numeric",
            })}{" "}
            {clockText(a.start)}
          </b>
          <span>
            {a.petName} · {a.label} · {a.groomerName}
          </span>
          <span className={`chip ${a.status}`}>{STATUS_LABEL[a.status]}</span>
        </div>
      ))}
    </section>
  );
}
