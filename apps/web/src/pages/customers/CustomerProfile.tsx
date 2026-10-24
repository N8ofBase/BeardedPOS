import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { addressLine, can, formatDate, formatMoney, formatPhone } from "@bearded/core";
import { useSession } from "../../session.tsx";
import { errorMessage } from "../../ui/errors.ts";
import { BirthdayTag } from "./bits.tsx";
import { CustomerForm } from "./CustomerForm.tsx";
import { DeleteCustomer } from "./DeleteCustomer.tsx";
import { OrderHistory } from "./OrderHistory.tsx";
import { FollowUpBox, TagChips, Timeline } from "./crm.tsx";

export function CustomerProfilePage() {
  const { id = "" } = useParams();
  const { api, me } = useSession();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const profile = useQuery({ queryKey: ["customer", id], queryFn: () => api.call("getCustomer", { id }) });
  const canEdit = can(me.staff.role, "customers.edit");
  const canDelete = can(me.staff.role, "customers.delete");
  const canSeeProfit = can(me.staff.role, "sales.view");
  const profit = useQuery({
    queryKey: ["customer-profit", id],
    queryFn: () => api.call("customerProfit", { customerId: id }),
    enabled: canSeeProfit && profile.data?.kind === "retailer",
  });

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
          <h1>{c.company ?? c.name}</h1>
          <TagChips tags={c.tags} kind={c.kind} />
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
        {c.company && <p>{c.name}</p>}
        {c.phone && <p className="mono">{formatPhone(c.phone)}</p>}
        {c.email && <p>{c.email}</p>}
        {address && <p className="muted">{address}</p>}
        {c.birthday && (
          <p className="muted">
            Birthday {formatDate(c.birthday)} <BirthdayTag birthday={c.birthday} />
          </p>
        )}
        <p className="muted small">
          {c.smsOptIn ? "Text messages OK" : "No text messages"} ·{" "}
          {c.emailOptIn ? "Email OK" : "No marketing email"}
        </p>
        {c.notes && <p>{c.notes}</p>}
      </section>

      {c.kind === "retailer" && (
        <section className="panel">
          <h2>Wholesale</h2>
          <p style={{ whiteSpace: "pre-wrap" }}>
            {c.wholesaleTerms ?? <span className="muted">No terms saved yet.</span>}
          </p>
          {profit.data && (
            <p className="muted">
              {profit.data.orders} {profit.data.orders === 1 ? "order" : "orders"} at the register ·{" "}
              {formatMoney(profit.data.revenueCents)} in sales · {formatMoney(profit.data.profitCents)} net
              profit
            </p>
          )}
        </section>
      )}

      <FollowUpBox
        key={`${c.followUpOn}-${c.followUpNote}`}
        customerId={c.id}
        on={c.followUpOn}
        note={c.followUpNote}
        canEdit={canEdit}
      />

      <Timeline customerId={c.id} canEdit={canEdit} />

      <OrderHistory customerId={c.id} />

      {editing && <CustomerForm id={c.id} onClose={() => setEditing(false)} />}
    </>
  );
}
