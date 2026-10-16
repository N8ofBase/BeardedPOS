import { useQuery } from "@tanstack/react-query";
import { useDeferredValue, useState } from "react";
import { Link, Route, Routes } from "react-router";
import { addressLine, can, formatDate, formatPhone } from "@pet-pos/core";
import type { CustomerCard } from "@pet-pos/api";
import { useSession } from "../../session.tsx";
import { errorMessage } from "../../ui/errors.ts";
import { BirthdayTag, PetChip, Punches } from "./bits.tsx";
import { CustomerForm } from "./CustomerForm.tsx";
import { CustomerProfilePage } from "./CustomerProfile.tsx";
import { DeleteCustomer } from "./DeleteCustomer.tsx";

export function CustomersRoutes() {
  return (
    <Routes>
      <Route index element={<CustomersPage />} />
      <Route path=":id" element={<CustomerProfilePage />} />
    </Routes>
  );
}

function CustomersPage() {
  const { api, me } = useSession();
  const canEdit = can(me.staff.role, "customers.edit");
  const canDelete = can(me.staff.role, "customers.delete");
  const [q, setQ] = useState("");
  const query = useDeferredValue(q);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const customers = useQuery({
    queryKey: ["customers", query],
    queryFn: () => api.call("searchCustomers", { q: query }),
    placeholderData: (prev) => prev,
  });

  return (
    <>
      <div className="page-head">
        <h1>Customers &amp; pets</h1>
        <div className="actions">
          <input
            type="search"
            placeholder="Search name or phone"
            aria-label="Search name or phone"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ width: 220 }}
          />
          {canEdit && (
            <button type="button" className="primary" onClick={() => setEditing("new")}>
              New customer
            </button>
          )}
        </div>
      </div>

      {deleting && <DeleteCustomer id={deleting} onDone={() => setDeleting(null)} />}
      {customers.isError && <p className="error-box">{errorMessage(customers.error)}</p>}

      <div className="cards">
        {customers.data?.map((c) => (
          <Card
            key={c.id}
            c={c}
            onEdit={canEdit ? () => setEditing(c.id) : undefined}
            onDelete={canDelete ? () => setDeleting(c.id) : undefined}
          />
        ))}
      </div>
      {customers.data?.length === 0 && (
        <p className="muted">
          {query
            ? "No customers match. Check the spelling, or search by phone."
            : "No customers yet. Add one, or import a file in Settings."}
        </p>
      )}
      {customers.isPending && <p className="muted">Loading customers…</p>}

      {editing && <CustomerForm id={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function Card({ c, onEdit, onDelete }: { c: CustomerCard; onEdit?: () => void; onDelete?: () => void }) {
  const address = addressLine(c);
  return (
    <div className="ccard">
      <div className="top">
        <b>{c.name}</b>
        <span className="mono muted">{formatPhone(c.phone)}</span>
      </div>
      {c.email && (
        <span className="muted small" style={{ overflowWrap: "anywhere" }}>
          {c.email}
        </span>
      )}
      {address && <span className="muted small">{address}</span>}
      {c.birthday && (
        <span className="muted small">
          Birthday {formatDate(c.birthday)} <BirthdayTag birthday={c.birthday} />
        </span>
      )}
      {c.pets.length > 0 && (
        <div>
          {c.pets.map((p) => (
            <PetChip key={p.id} pet={p} />
          ))}
        </div>
      )}
      {c.punchCards.map((card) => (
        <Punches key={card.programId} card={card} />
      ))}
      <div className="actions">
        <Link to={c.id}>Profile</Link>
        {onEdit && (
          <button type="button" onClick={onEdit}>
            Edit
          </button>
        )}
        {onDelete && (
          <button type="button" className="danger" style={{ marginLeft: "auto" }} onClick={onDelete}>
            Delete
          </button>
        )}
      </div>
    </div>
  );
}
