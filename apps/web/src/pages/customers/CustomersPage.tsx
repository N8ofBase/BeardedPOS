import { useQuery } from "@tanstack/react-query";
import { useDeferredValue, useState } from "react";
import { Link, Route, Routes, useNavigate } from "react-router";
import { addressLine, can, formatDate, formatPhone, type CustomerKind } from "@pet-pos/core";
import type { CustomerCard } from "@pet-pos/api";
import { useSession } from "../../session.tsx";
import { errorMessage } from "../../ui/errors.ts";
import { BirthdayTag } from "./bits.tsx";
import { CustomerForm } from "./CustomerForm.tsx";
import { CustomerProfilePage } from "./CustomerProfile.tsx";
import { FollowUpsDue, TagChips } from "./crm.tsx";
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
  const [kind, setKind] = useState<CustomerKind | "">("");
  const [tagId, setTagId] = useState("");
  const navigate = useNavigate();

  const customers = useQuery({
    queryKey: ["customers", query, kind, tagId],
    queryFn: () => api.call("searchCustomers", { q: query, kind: kind || null, tagId: tagId || null }),
    placeholderData: (prev) => prev,
  });
  const tags = useQuery({ queryKey: ["tags"], queryFn: () => api.call("listTags") });
  const filtered = !!(kind || tagId);

  return (
    <>
      <div className="page-head">
        <h1>Customers</h1>
        <div className="actions">
          <input
            type="search"
            placeholder="Search name or phone"
            aria-label="Search name or phone"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ width: 220 }}
          />
          <select
            className="filter-select"
            aria-label="Customer type"
            value={kind}
            onChange={(e) => setKind(e.target.value as CustomerKind | "")}
          >
            <option value="">Everyone</option>
            <option value="person">People</option>
            <option value="retailer">Retailers</option>
          </select>
          <select
            className="filter-select"
            aria-label="Tag"
            value={tagId}
            onChange={(e) => setTagId(e.target.value)}
          >
            <option value="">Any tag</option>
            {tags.data?.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.customers})
              </option>
            ))}
          </select>
          {canEdit && (
            <button type="button" className="primary" onClick={() => setEditing("new")}>
              New customer
            </button>
          )}
        </div>
      </div>

      {!query && !filtered && <FollowUpsDue onOpen={(id) => navigate(id)} />}
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
          {query || filtered
            ? "No customers match. Check the spelling, or clear the filters."
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
        <b>{c.company ?? c.name}</b>
        <span className="mono muted">{formatPhone(c.phone)}</span>
      </div>
      {c.company && <span className="small">{c.name}</span>}
      <TagChips tags={c.tags} kind={c.kind} />
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
