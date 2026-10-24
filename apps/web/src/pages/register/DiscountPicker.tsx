import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { can, discountValueLabel, ROLE_LABEL } from "@bearded/core";
import type { DiscountRow } from "@bearded/api";
import { useSession } from "../../session.tsx";
import { SlideOver } from "../../ui/SlideOver.tsx";
import type { TicketDiscountState, TicketLineState } from "./ticket.ts";

/**
 * The register's Discounts button: one tap for most discounts, plus the item to
 * apply it to, a note, or a manager's approval when the discount asks for them.
 */
export function DiscountPicker({
  discounts,
  lines,
  start,
  onApply,
  onClose,
}: {
  discounts: DiscountRow[];
  lines: TicketLineState[];
  /** Open straight on one discount (typed code). */
  start?: DiscountRow;
  onApply: (d: TicketDiscountState) => void;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<DiscountRow | null>(start ?? null);

  return (
    <SlideOver title={picked ? picked.name : "Discounts"} onClose={onClose}>
      {!picked ? (
        <div className="discount-grid">
          {discounts.map((d) => (
            <button key={d.id} type="button" className="discount-btn" onClick={() => setPicked(d)}>
              <b>{d.name}</b>
              <span>
                {discountValueLabel(d)} {d.scope === "line" ? "off one item" : "off the ticket"}
              </span>
              <span className="muted small">
                {[d.code, d.cashOnly && "cash only", d.needsApproval && "manager OK"]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </button>
          ))}
          {discounts.length === 0 && (
            <p className="muted">No discounts set up yet. Owners and managers add them in Settings.</p>
          )}
        </div>
      ) : (
        <Details
          d={picked}
          lines={lines}
          onApply={onApply}
          onBack={start ? onClose : () => setPicked(null)}
        />
      )}
    </SlideOver>
  );
}

function Details({
  d,
  lines,
  onApply,
  onBack,
}: {
  d: DiscountRow;
  lines: TicketLineState[];
  onApply: (x: TicketDiscountState) => void;
  onBack: () => void;
}) {
  const { api, me } = useSession();
  const selfApproves = can(me.staff.role, "discounts.approve");
  const [lineKey, setLineKey] = useState<string | null>(
    d.scope === "line" && lines.length === 1 ? lines[0]!.key : null,
  );
  const [note, setNote] = useState("");
  const [approver, setApprover] = useState<{ id: string; name: string } | null>(null);
  const staff = useQuery({
    queryKey: ["staff"],
    queryFn: () => api.call("listStaff"),
    enabled: d.needsApproval && !selfApproves,
  });
  const approvers = (staff.data ?? []).filter(
    (s) => s.active && (s.role === "owner" || s.role === "manager"),
  );

  const ready =
    (d.scope !== "line" || !!lineKey) &&
    (!d.askNote || !!note.trim()) &&
    (!d.needsApproval || selfApproves || !!approver);

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <p>
        {discountValueLabel(d)} {d.scope === "line" ? "off one item" : "off the whole ticket"}
        {d.cashOnly ? ", only when paying cash" : ""}.
      </p>
      {d.scope === "line" && (
        <fieldset style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 6 }}>
          <legend className="muted small">Which item?</legend>
          {lines.map((l) => (
            <label key={l.key} className="check">
              <input
                type="radio"
                name="discount-line"
                checked={lineKey === l.key}
                onChange={() => setLineKey(l.key)}
              />
              {l.qty > 1 ? `${l.qty}× ` : ""}
              {l.product.name}
            </label>
          ))}
          {lines.length === 0 && <span className="muted">Add the item to the ticket first.</span>}
        </fieldset>
      )}
      {d.askNote && (
        <label>
          Note (for example, the employee's name)
          <input value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
        </label>
      )}
      {d.needsApproval &&
        (selfApproves ? (
          <p className="muted small">Approved by you ({ROLE_LABEL[me.staff.role]}).</p>
        ) : (
          <fieldset style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 6 }}>
            <legend className="muted small">A manager approves this discount</legend>
            {approvers.map((s) => (
              <label key={s.id} className="check">
                <input
                  type="radio"
                  name="approver"
                  checked={approver?.id === s.id}
                  onChange={() => setApprover({ id: s.id, name: s.name })}
                />
                {s.name} <span className="muted">· {ROLE_LABEL[s.role]}</span>
              </label>
            ))}
            <span className="muted small">
              In this demo the manager picks their name here. In the hosted version they enter their PIN.
            </span>
          </fieldset>
        ))}
      <div className="actions">
        <button
          type="button"
          className="primary"
          disabled={!ready}
          onClick={() =>
            onApply({
              discount: d,
              lineKey: d.scope === "line" ? lineKey : null,
              note: note.trim() || null,
              approvedBy: approver?.id ?? null,
              approverName: approver?.name ?? null,
            })
          }
        >
          Apply {d.name}
        </button>
        <button type="button" onClick={onBack}>
          Back
        </button>
      </div>
    </div>
  );
}
