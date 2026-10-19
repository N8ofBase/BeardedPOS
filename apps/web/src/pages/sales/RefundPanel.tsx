import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { formatMoney, REFUND_REASON_LABEL, REFUND_REASONS, type RefundReasonCode } from "@pet-pos/core";
import type { AstroEffect, RefundPlan } from "@pet-pos/api";
import { useSession } from "../../session.tsx";
import { errorMessage } from "../../ui/errors.ts";
import { useToast } from "../../ui/Toast.tsx";
import { TwoTapButton } from "../../ui/TwoTapButton.tsx";

/** Units left to refund on each line, keyed by sale line id. */
export function leftToRefund(plan: Pick<RefundPlan, "refundable">): Record<string, number> {
  return Object.fromEntries(plan.refundable.map((l) => [l.saleLineId, l.qty - l.refundedQty]));
}

/** "−1 punch Dry food club", "+12 punches … (reward given back)", for the breakdown. */
export function astroEffectText(a: AstroEffect): string[] {
  const p = (n: number) => `${n} punch${n === 1 ? "" : "es"}`;
  const out: string[] = [];
  if (a.reversed) out.push(`−${p(a.reversed)} ${a.programName}`);
  if (a.short) out.push(`${p(a.short)} ${a.programName} already spent, so not taken back`);
  if (a.returned) out.push(`+${p(a.returned)} ${a.programName} (the free item came back)`);
  return out;
}

/**
 * Refund some or all of a sale. Every change reruns refundPreview, so the breakdown
 * is the server's own math; Refund runs the same math again in one transaction.
 */
export function RefundPanel({ saleId, onDone }: { saleId: string; onDone: () => void }) {
  const { api, me } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [qty, setQty] = useState<Record<string, number>>({});
  const [restock, setRestock] = useState(true);
  const [reason, setReason] = useState<RefundReasonCode | null>(null);
  const [note, setNote] = useState("");
  const [approver, setApprover] = useState<string | null>(null);

  const lines = Object.entries(qty)
    .filter(([, n]) => n > 0)
    .map(([saleLineId, n]) => ({ saleLineId, qty: n }));
  const preview = useQuery({
    queryKey: ["refundPreview", saleId, lines, restock],
    queryFn: () => api.call("refundPreview", { saleId, lines, restock }),
    placeholderData: keepPreviousData,
  });
  const plan = preview.data;
  const owners = useQuery({
    queryKey: ["staff"],
    queryFn: () => api.call("listStaff"),
    enabled: !!plan?.needsApproval,
  });

  const refund = useMutation({
    mutationFn: () =>
      api.call("refundSale", {
        saleId,
        lines,
        restock,
        reason: reason!,
        note,
        approvedBy: plan?.needsApproval ? approver : null,
      }),
    onSuccess: (r) => {
      toast(`Refunded ${formatMoney(r.totalCents)}. ${r.label}.`);
      void qc.invalidateQueries({ queryKey: ["sale", saleId] });
      void qc.invalidateQueries({ queryKey: ["sales"] });
      void qc.invalidateQueries({ queryKey: ["products"] });
      void qc.invalidateQueries({ queryKey: ["astroQueue"] });
      onDone();
    },
    onError: (err) => toast(errorMessage(err)),
  });

  if (preview.isError && !plan) return <p className="error-box">{errorMessage(preview.error)}</p>;
  if (!plan) return <p className="muted">Loading the sale…</p>;

  const left = leftToRefund(plan);
  const anyLeft = Object.values(left).some((n) => n > 0);
  if (!anyLeft) return <p className="muted">Everything on this sale has been refunded.</p>;

  const set = (id: string, n: number) => setQty({ ...qty, [id]: Math.max(0, Math.min(left[id]!, n)) });
  const ownerList = (owners.data ?? []).filter((s) => s.active && s.role === "owner");
  const ready =
    lines.length > 0 &&
    !!reason &&
    (reason !== "other" || !!note.trim()) &&
    (!plan.needsApproval || !!approver) &&
    !preview.isFetching;

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {preview.isError && <p className="error-box">{errorMessage(preview.error)}</p>}
      <div className="lines" style={{ maxHeight: "none" }}>
        {plan.refundable.map((l) => {
          const max = left[l.saleLineId]!;
          const n = qty[l.saleLineId] ?? 0;
          return (
            <div className="line" key={l.saleLineId}>
              <span>
                <b>{l.name}</b>
                <span className="sub">
                  {l.qty} sold · {formatMoney(l.lineTotalCents)} paid
                  {l.rewardUnits ? ` · ${l.rewardUnits} free (Astro reward)` : ""}
                  {l.refundedQty ? ` · ${l.refundedQty} already refunded` : ""}
                </span>
              </span>
              {max > 0 ? (
                <span className="qty">
                  <button
                    type="button"
                    aria-label={`Refund fewer ${l.name}`}
                    disabled={n <= 0}
                    onClick={() => set(l.saleLineId, n - 1)}
                  >
                    −
                  </button>
                  <span className="num" aria-label={`${l.name} to refund`}>
                    {n} of {max}
                  </span>
                  <button
                    type="button"
                    aria-label={`Refund more ${l.name}`}
                    disabled={n >= max}
                    onClick={() => set(l.saleLineId, n + 1)}
                  >
                    +
                  </button>
                </span>
              ) : (
                <span className="tag muted">Refunded</span>
              )}
            </div>
          );
        })}
      </div>
      <div>
        <button type="button" onClick={() => setQty(left)}>
          Refund everything
        </button>
      </div>

      <fieldset style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 6 }}>
        <legend style={{ fontWeight: 700, marginBottom: 6 }}>Reason</legend>
        <div className="cat-tabs" style={{ flexWrap: "wrap", marginTop: 0 }}>
          {REFUND_REASONS.map((r) => (
            <button
              type="button"
              key={r}
              aria-pressed={reason === r}
              onClick={() => {
                setReason(r);
                if (r === "damaged") setRestock(false);
              }}
            >
              {REFUND_REASON_LABEL[r]}
            </button>
          ))}
        </div>
        {reason === "other" && (
          <label>
            Note (required)
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What happened?" />
          </label>
        )}
        {reason && reason !== "other" && (
          <label>
            Note (optional)
            <input value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
        )}
      </fieldset>

      <label className="check">
        <input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} />
        Put the items back in stock
      </label>

      <div className="totals" aria-label="Refund breakdown">
        <div>
          <span>Items</span>
          <span className="num">{formatMoney(plan.amountCents)}</span>
        </div>
        <div>
          <span>Tax</span>
          <span className="num">{formatMoney(plan.taxCents)}</span>
        </div>
        <div className="grand">
          <span>Refund</span>
          <span className="num">{formatMoney(plan.totalCents)}</span>
        </div>
        {lines.length > 0 && <p style={{ margin: "6px 0 0" }}>{plan.label}</p>}
        {plan.astro.flatMap(astroEffectText).map((t) => (
          <span key={t} className="disc">
            Astro: {t}
          </span>
        ))}
      </div>

      {plan.needsApproval && (
        <fieldset style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 10 }}>
          <legend className="muted small">
            Over the {formatMoney(plan.limitCents)} limit for managers: the owner approves
          </legend>
          {ownerList.map((s) => (
            <label className="check" key={s.id}>
              <input
                type="radio"
                name="refund-approver"
                checked={approver === s.id}
                onChange={() => setApprover(s.id)}
              />
              {s.name} approves this refund
            </label>
          ))}
          {owners.data && ownerList.length === 0 && <p className="muted small">No owner is set up.</p>}
        </fieldset>
      )}
      {me.staff.role === "owner" && plan.totalCents > plan.limitCents && (
        <p className="muted small">Approved by you (Owner).</p>
      )}

      <div className="actions">
        <TwoTapButton
          className="primary big"
          label={`Refund ${formatMoney(plan.totalCents)}`}
          confirmLabel={`Tap again to refund ${formatMoney(plan.totalCents)}`}
          disabled={!ready || refund.isPending}
          onConfirm={() => refund.mutate()}
        />
      </div>
      {!reason && lines.length > 0 && <p className="muted small">Pick a reason to refund.</p>}
    </div>
  );
}
