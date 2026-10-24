import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import {
  centsToInput,
  discountValueLabel,
  parseMoney,
  parseTaxPercent,
  taxPercentInput,
} from "@bearded/core";
import type { DiscountInput, DiscountRow } from "@bearded/api";
import { useSession } from "../../session.tsx";
import { errorMessage, fieldErrors } from "../../ui/errors.ts";
import { SlideOver } from "../../ui/SlideOver.tsx";
import { useToast } from "../../ui/Toast.tsx";
import { TwoTapButton } from "../../ui/TwoTapButton.tsx";

/** Settings → Discounts: the store's discounts, for owners and managers. */
export function DiscountsSection() {
  const { api } = useSession();
  const list = useQuery({
    queryKey: ["discounts", "all"],
    queryFn: () => api.call("listDiscounts", { all: true }),
  });
  const [editing, setEditing] = useState<DiscountRow | "new" | null>(null);
  const rows = (list.data ?? []).filter((d) => !d.archived);

  return (
    <section className="panel" style={{ maxWidth: "none" }}>
      <div className="page-head">
        <h2>Discounts</h2>
        <button type="button" onClick={() => setEditing("new")}>
          New discount
        </button>
      </div>
      <p className="muted small" style={{ maxWidth: "70ch" }}>
        Cashiers apply these from the register's Discounts button, or by typing the code in the scan box. A
        discount that's been used on a sale is archived instead of deleted, so old receipts keep its name.
      </p>
      <div className="tablewrap">
        <table className="wide">
          <thead>
            <tr>
              <th>Name</th>
              <th>Code</th>
              <th>Amount</th>
              <th>Applies to</th>
              <th>Rules</th>
              <th className="r">Used</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id}>
                <td>
                  <b>{d.name}</b>
                  {!d.active && <span className="tag muted"> Off</span>}
                </td>
                <td className="mono">{d.code ?? "—"}</td>
                <td className="num">{discountValueLabel(d)}</td>
                <td>{d.scope === "line" ? "One item" : "Whole ticket"}</td>
                <td className="small">
                  {[
                    d.cashOnly && "Cash only",
                    d.needsApproval && "Manager approval",
                    d.askNote && "Asks for a note",
                    d.combinable && "Can combine",
                  ]
                    .filter(Boolean)
                    .join(" · ") || "—"}
                </td>
                <td className="r num">{d.timesUsed}</td>
                <td>
                  <button type="button" onClick={() => setEditing(d)}>
                    Edit
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  No discounts yet. Add the ones the store runs, like a cash or employee discount.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {editing && <DiscountForm d={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </section>
  );
}

function DiscountForm({ d, onClose }: { d: DiscountRow | null; onClose: () => void }) {
  const { api } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({
    name: d?.name ?? "",
    code: d?.code ?? "",
    kind: d?.kind ?? ("percent" as "percent" | "fixed"),
    amount: d
      ? d.kind === "percent"
        ? taxPercentInput(d.percentMpct ?? 0)
        : centsToInput(d.amountCents ?? 0)
      : "",
    scope: d?.scope ?? ("ticket" as "ticket" | "line"),
    cashOnly: d?.cashOnly ?? false,
    needsApproval: d?.needsApproval ?? false,
    askNote: d?.askNote ?? false,
    combinable: d?.combinable ?? false,
    active: d?.active ?? true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const refresh = () => void qc.invalidateQueries({ queryKey: ["discounts"] });

  const save = useMutation({
    mutationFn: (input: DiscountInput) => api.call("saveDiscount", input),
    onSuccess: () => {
      toast(d ? "Discount saved" : "Discount added");
      refresh();
      onClose();
    },
    onError: (err) => {
      setErrors(fieldErrors(err));
      toast(errorMessage(err));
    },
  });
  const del = useMutation({
    mutationFn: () => api.call("deleteDiscount", { id: d!.id }),
    onSuccess: (r) => {
      toast(r.archived ? "Discount archived (it's on past sales)" : "Discount deleted");
      refresh();
      onClose();
    },
    onError: (err) => toast(errorMessage(err)),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    const percent = f.kind === "percent" ? parseTaxPercent(f.amount) : null;
    const cents = f.kind === "fixed" ? parseMoney(f.amount) : null;
    if ((f.kind === "percent" && !percent) || (f.kind === "fixed" && !cents))
      return setErrors({
        amount: f.kind === "percent" ? "Enter a percent like 20." : "Enter an amount like 5.00.",
      });
    save.mutate({
      id: d?.id,
      name: f.name,
      code: f.code,
      kind: f.kind,
      percentMpct: percent,
      amountCents: cents,
      scope: f.cashOnly ? "ticket" : f.scope,
      cashOnly: f.cashOnly,
      needsApproval: f.needsApproval,
      askNote: f.askNote,
      combinable: f.combinable,
      active: f.active,
    });
  }

  const check = (k: "cashOnly" | "needsApproval" | "askNote" | "combinable" | "active", label: string) => (
    <label className="check">
      <input type="checkbox" checked={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.checked })} />
      {label}
    </label>
  );

  return (
    <SlideOver title={d ? `Edit ${d.name}` : "New discount"} onClose={onClose}>
      <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
        <label>
          Name (shown on the ticket and receipt)
          <input
            value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value })}
            required
            autoFocus={!d}
          />
          {errors.name && <span className="field-error">{errors.name}</span>}
        </label>
        <label>
          Code (optional, typed at the register)
          <input
            value={f.code}
            onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })}
            maxLength={20}
            placeholder="e.g. EMP"
          />
          {errors.code && <span className="field-error">{errors.code}</span>}
        </label>
        <div className="form">
          <label>
            Kind
            <select
              value={f.kind}
              onChange={(e) => setF({ ...f, kind: e.target.value as "percent" | "fixed" })}
            >
              <option value="percent">Percent off</option>
              <option value="fixed">Dollar amount off</option>
            </select>
          </label>
          <label>
            {f.kind === "percent" ? "Percent (%)" : "Amount ($)"}
            <input
              value={f.amount}
              onChange={(e) => setF({ ...f, amount: e.target.value })}
              inputMode="decimal"
            />
            {errors.amount && <span className="field-error">{errors.amount}</span>}
          </label>
          <label>
            Applies to
            <select
              value={f.cashOnly ? "ticket" : f.scope}
              disabled={f.cashOnly}
              onChange={(e) => setF({ ...f, scope: e.target.value as "ticket" | "line" })}
            >
              <option value="ticket">Whole ticket</option>
              <option value="line">One item</option>
            </select>
          </label>
        </div>
        {check("cashOnly", "Only when paying cash (offered when the cashier taps Cash)")}
        {check("needsApproval", "Needs a manager to approve")}
        {check("askNote", "Ask for a note (for example, which employee)")}
        {check("combinable", "Can combine with another whole-ticket discount")}
        {check("active", "On (shows at the register)")}
        <div className="actions">
          <button className="primary" disabled={save.isPending}>
            {d ? "Save discount" : "Add discount"}
          </button>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          {d && (
            <span style={{ marginLeft: "auto" }}>
              <TwoTapButton
                className="danger"
                label={d.timesUsed ? "Archive" : "Delete"}
                confirmLabel={d.timesUsed ? "Tap again to archive" : "Tap again to delete"}
                onConfirm={() => del.mutate()}
              />
            </span>
          )}
        </div>
      </form>
    </SlideOver>
  );
}
