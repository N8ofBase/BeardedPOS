import { useMutation, useQuery } from "@tanstack/react-query";
import { useDeferredValue, useState } from "react";
import { formatDate, formatPhone, normalizePhone } from "@bearded/core";
import type { ProductRow, RegisterCustomer } from "@bearded/api";
import { useSession } from "../../session.tsx";
import { errorMessage } from "../../ui/errors.ts";
import { useToast } from "../../ui/Toast.tsx";
import { BirthdayTag } from "../customers/bits.tsx";

/** "Customer": find by phone or name, quick add, or show the attached customer. */
export function CustomerBox({
  customer,
  onAttach,
  onDrop,
  onAddProduct,
}: {
  customer: RegisterCustomer | null;
  onAttach: (c: RegisterCustomer) => void;
  onDrop: () => void;
  onAddProduct: (p: ProductRow) => void;
}) {
  if (customer) return <Attached c={customer} onDrop={onDrop} onAddProduct={onAddProduct} />;
  return <Lookup onAttach={onAttach} />;
}

function Attached({
  c,
  onDrop,
  onAddProduct,
}: {
  c: RegisterCustomer;
  onDrop: () => void;
  onAddProduct: (p: ProductRow) => void;
}) {
  return (
    <div className="cust">
      <div style={{ flex: 1, minWidth: 0, display: "grid", gap: 4 }}>
        <b>{c.card.name}</b>
        <span className="muted small">{formatPhone(c.card.phone)}</span>
        <BirthdayTag birthday={c.card.birthday} />
        {c.usuallyBuys.length > 0 && (
          <div style={{ display: "grid", gap: 4 }}>
            <span className="muted small" style={{ textTransform: "uppercase", letterSpacing: ".05em" }}>
              Usually buys
              {c.lastVisit
                ? ` · last visit ${formatDate(new Date(c.lastVisit).toISOString().slice(0, 10))}`
                : ""}
            </span>
            <div className="actions">
              {c.usuallyBuys.map((p) => (
                <button key={p.id} type="button" className="small" onClick={() => onAddProduct(p)}>
                  + {p.name} <span className="muted">×{p.times}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <button type="button" className="link" onClick={onDrop}>
        Change
      </button>
    </div>
  );
}

function Lookup({ onAttach }: { onAttach: (c: RegisterCustomer) => void }) {
  const { api } = useSession();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [newName, setNewName] = useState("");
  const query = useDeferredValue(q.trim());
  const digits = query.replace(/\D/g, "");
  const searchable = digits.length >= 3 || (!digits && query.length >= 2);
  const hits = useQuery({
    queryKey: ["customers", "register", query],
    queryFn: () => api.call("searchCustomers", { q: query }),
    enabled: searchable,
  });

  const attach = useMutation({
    mutationFn: (id: string) => api.call("registerCustomer", { id }),
    onSuccess: (c) => {
      onAttach(c);
      setQ("");
    },
    onError: (err) => toast(errorMessage(err)),
  });

  const add = useMutation({
    mutationFn: async () => {
      const { id } = await api.call("saveCustomer", {
        customer: {
          name: newName,
          phone: query,
          email: "",
          street: "",
          city: "",
          state: "",
          zip: "",
          birthday: "",
          smsOptIn: false,
          notes: "",
        },
      });
      return api.call("registerCustomer", { id });
    },
    onSuccess: (c) => {
      toast("Customer added");
      onAttach(c);
      setQ("");
      setNewName("");
    },
    onError: (err) => toast(errorMessage(err)),
  });

  const list = searchable ? (hits.data ?? []) : [];
  const phone = normalizePhone(query);

  return (
    <form
      className="cust"
      style={{ display: "grid", gap: 6 }}
      onSubmit={(e) => {
        e.preventDefault();
        if (list.length === 1) attach.mutate(list[0]!.id);
      }}
    >
      <label style={{ color: "var(--fg)", fontWeight: 700 }}>
        Customer
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          inputMode="tel"
          placeholder="Phone number or name"
          autoComplete="off"
        />
      </label>
      {!query && <span className="muted small">Type a phone number or name to find a customer.</span>}
      {list.slice(0, 6).map((c) => (
        <button
          key={c.id}
          type="button"
          style={{ textAlign: "left", display: "flex", justifyContent: "space-between", gap: 8 }}
          onClick={() => attach.mutate(c.id)}
        >
          <span>
            <b>{c.name}</b> <span className="muted mono">{formatPhone(c.phone)}</span>
          </span>
        </button>
      ))}
      {list.length > 6 && (
        <span className="muted small">{list.length - 6} more. Keep typing to narrow it down.</span>
      )}
      {searchable && hits.isSuccess && list.length === 0 && phone && (
        <>
          <span className="muted small">No customer with {formatPhone(phone)}. Add them:</span>
          <div className="actions" style={{ flexWrap: "nowrap" }}>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Customer name"
              aria-label="New customer name"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (newName.trim()) add.mutate();
                }
              }}
            />
            <button
              type="button"
              className="primary"
              disabled={!newName.trim() || add.isPending}
              onClick={() => add.mutate()}
            >
              Add
            </button>
          </div>
        </>
      )}
      {searchable && hits.isSuccess && list.length === 0 && !phone && (
        <span className="muted small">No match yet.</span>
      )}
    </form>
  );
}
