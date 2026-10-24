import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { addressLine, can, formatDate, formatPhone } from "@bearded/core";
import { useSession } from "../../session.tsx";
import { errorMessage } from "../../ui/errors.ts";
import { BirthdayTag } from "./bits.tsx";
import { CustomerForm } from "./CustomerForm.tsx";
import { DeleteCustomer } from "./DeleteCustomer.tsx";
import { OrderHistory } from "./OrderHistory.tsx";

export function CustomerProfilePage() {
  const { id = "" } = useParams();
  const { api, me } = useSession();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const profile = useQuery({ queryKey: ["customer", id], queryFn: () => api.call("getCustomer", { id }) });
  const canEdit = can(me.staff.role, "customers.edit");
  const canDelete = can(me.staff.role, "customers.delete");

  if (profile.isPending) return <p className="muted">Loading…</p>;
  if (profile.isError)
    return (
      <>
        <p className="error-box">{errorMessage(profile.error)}</p>
        <Link to="..">Back to customers</Link>
      </>
    );
  const c = profile.data;
  const address = addressLine(c);

  return (
    <>
      <div className="page-head">
        <div>
          <Link to=".." className="small">
            ← Customers
          </Link>
          <h1>{c.name}</h1>
        </div>
        <div className="actions">
          {canEdit && (
            <button type="button" className="primary" onClick={() => setEditing(true)}>
              Edit customer
            </button>
          )}
          {canDelete && (
            <button type="button" className="danger" onClick={() => setDeleting(true)}>
              Delete
            </button>
          )}
        </div>
      </div>

      {deleting && (
        <DeleteCustomer
          id={c.id}
          onDone={(deleted) => (deleted ? navigate("..", { relative: "path" }) : setDeleting(false))}
        />
      )}

      <section className="panel">
        <h2>Contact</h2>
        {c.phone && <p className="mono">{formatPhone(c.phone)}</p>}
        {c.email && <p>{c.email}</p>}
        {address && <p className="muted">{address}</p>}
        {c.birthday && (
          <p className="muted">
            Birthday {formatDate(c.birthday)} <BirthdayTag birthday={c.birthday} />
          </p>
        )}
        <p className="muted small">{c.smsOptIn ? "Text messages OK" : "No text messages"}</p>
        {c.notes && <p>{c.notes}</p>}
      </section>

      <OrderHistory customerId={c.id} />

      {editing && <CustomerForm id={c.id} onClose={() => setEditing(false)} />}
    </>
  );
}
