import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { can, formatMoney, REFUND_REASON_LABEL, todayIso } from "@pet-pos/core";
import type { SaleListRow } from "@pet-pos/api";
import { useSession } from "../session.tsx";
import { errorMessage } from "../ui/errors.ts";
import { SlideOver } from "../ui/SlideOver.tsx";
import { ReceiptView } from "./register/ReceiptView.tsx";
import { ReceiptSend } from "./sales/ReceiptSend.tsx";
import { RefundPanel } from "./sales/RefundPanel.tsx";

/** Local midnight to the next midnight of a "YYYY-MM-DD" day. */
export function dayRange(day: string): { from: string; to: string } {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return {
    from: new Date(y, m - 1, d).toISOString(),
    to: new Date(y, m - 1, d + 1).toISOString(),
  };
}

/** Local midnight to the next midnight, for "today". */
export function todayRange(now = new Date()): { from: string; to: string } {
  return dayRange(todayIso(now));
}

function shiftDay(day: string, by: number): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return todayIso(new Date(y, m - 1, d + by));
}

/** "Refunded $12.99" or "Fully refunded", for the list. */
export function refundTag(s: Pick<SaleListRow, "refundedCents" | "totalCents">): string | null {
  if (!s.refundedCents) return null;
  return s.refundedCents >= s.totalCents ? "Fully refunded" : `Refunded ${formatMoney(s.refundedCents)}`;
}

export function SalesPage() {
  const { api } = useSession();
  const today = todayIso();
  const [day, setDay] = useState(today);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const range = dayRange(day);
  const search = q.trim();
  const list = useQuery({
    queryKey: ["sales", range, search],
    queryFn: () => api.call("listSales", { ...range, q: search }),
  });
  const yesterday = shiftDay(today, -1);
  const label = day === today ? "Today" : day === yesterday ? "Yesterday" : null;

  return (
    <>
      <div className="page-head">
        <h1>Sales</h1>
        <span className="muted">
          {label ? `${label}, ` : ""}
          {new Date(dayRange(day).from).toLocaleDateString(undefined, {
            weekday: "long",
            month: "short",
            day: "numeric",
            year: label ? undefined : "numeric",
          })}
        </span>
      </div>
      <div className="toolbar">
        <div className="cat-tabs" style={{ marginTop: 0 }}>
          <button type="button" aria-pressed={day === today} onClick={() => setDay(today)}>
            Today
          </button>
          <button type="button" aria-pressed={day === yesterday} onClick={() => setDay(yesterday)}>
            Yesterday
          </button>
        </div>
        <label>
          <span className="muted small">Day </span>
          <input
            type="date"
            value={day}
            max={today}
            onChange={(e) => e.target.value && setDay(e.target.value)}
            aria-label="Pick a day"
          />
        </label>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Receipt # or customer name"
          aria-label="Search sales"
        />
      </div>
      {list.isError && <p className="error-box">{errorMessage(list.error)}</p>}
      {list.data && (
        <div className="kpis">
          <Kpi label="Sales" value={String(list.data.count)} />
          <Kpi label="Total" value={formatMoney(list.data.totalCents)} />
          <Kpi label="Card" value={formatMoney(list.data.cardCents)} />
          <Kpi label="Cash" value={formatMoney(list.data.cashCents)} />
          <Kpi
            label={`Refunds${list.data.refundCount ? ` (${list.data.refundCount})` : ""}`}
            value={list.data.refundCents ? `−${formatMoney(list.data.refundCents)}` : formatMoney(0)}
          />
          <Kpi label="Discounts" value={formatMoney(list.data.discountCents)} />
          <Kpi label="Astro discounts" value={formatMoney(list.data.astroDiscountCents)} />
        </div>
      )}
      <div className="tablewrap">
        <table className="wide">
          <thead>
            <tr>
              <th>Time</th>
              <th>Receipt</th>
              <th>Customer</th>
              <th>Items</th>
              <th>Pay</th>
              <th className="r">Discounts</th>
              <th className="r">Total</th>
            </tr>
          </thead>
          <tbody>
            {list.data?.sales.map((s) => {
              const tag = refundTag(s);
              return (
                <tr key={s.id} onClick={() => setOpen(s.id)} style={{ cursor: "pointer" }}>
                  <td className="num" style={{ whiteSpace: "nowrap" }}>
                    {new Date(s.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                  </td>
                  <td>
                    <button type="button" className="link" onClick={() => setOpen(s.id)}>
                      #{s.receiptNumber}
                    </button>
                    {s.status === "canceled" && <span className="tag muted"> Canceled</span>}
                    {tag && <span className="tag low"> {tag}</span>}
                  </td>
                  <td>{s.customerName ?? "Walk-in"}</td>
                  <td>{s.items}</td>
                  <td>{s.payment || "—"}</td>
                  <td className="r num">{s.discountCents ? `−${formatMoney(s.discountCents)}` : ""}</td>
                  <td className="r num">{formatMoney(s.totalCents)}</td>
                </tr>
              );
            })}
            {list.data?.sales.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  {search
                    ? `No sales on this day match "${search}".`
                    : day === today
                      ? "No sales yet today. Ring one up on the Register."
                      : "No sales on this day."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="muted small">The end-of-day drawer count comes next.</p>
      {open && <SaleReceipt id={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function SaleReceipt({ id, onClose }: { id: string; onClose: () => void }) {
  const { api, me } = useSession();
  const [refunding, setRefunding] = useState(false);
  const r = useQuery({ queryKey: ["sale", id], queryFn: () => api.call("getSale", { id }) });
  const canRefund = can(me.staff.role, "sales.refund") && r.data?.status === "paid";
  const title = r.data ? `${refunding ? "Refund" : "Receipt"} #${r.data.receiptNumber}` : "Receipt";
  return (
    <SlideOver title={title} onClose={onClose}>
      {r.isError && <p className="error-box">{errorMessage(r.error)}</p>}
      {r.data && refunding && (
        <>
          <div>
            <button type="button" onClick={() => setRefunding(false)}>
              Back to the receipt
            </button>
          </div>
          <RefundPanel saleId={id} onDone={() => setRefunding(false)} />
        </>
      )}
      {r.data && !refunding && (
        <>
          <ReceiptView receipt={r.data} />
          {r.data.refunds.length > 0 && (
            <div style={{ display: "grid", gap: 6 }}>
              <h3 style={{ margin: 0 }}>Refunds</h3>
              {r.data.refunds.map((f) => (
                <div key={f.id} className="sub">
                  <b className="num">{formatMoney(f.amountCents + f.taxCents)}</b> ·{" "}
                  {new Date(f.createdAt).toLocaleString([], {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}{" "}
                  · {REFUND_REASON_LABEL[f.reason]}
                  {f.note ? ` (${f.note})` : ""} · by {f.staffName ?? "someone"}
                  {f.approvedByName ? `, approved by ${f.approvedByName}` : ""}
                  {f.restock ? "" : " · not restocked"}
                </div>
              ))}
            </div>
          )}
          <div className="actions">
            <button type="button" onClick={() => window.print()}>
              Print receipt
            </button>
            {canRefund && (
              <button type="button" onClick={() => setRefunding(true)}>
                Refund
              </button>
            )}
          </div>
          {r.data.status !== "open" && <ReceiptSend receipt={r.data} />}
        </>
      )}
    </SlideOver>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="kpi">
      <span className="muted">{label}</span>
      <b className="num">{value}</b>
    </div>
  );
}
