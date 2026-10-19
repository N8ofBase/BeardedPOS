import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { formatMoney } from "@pet-pos/core";
import { useSession } from "../session.tsx";
import { errorMessage } from "../ui/errors.ts";
import { SlideOver } from "../ui/SlideOver.tsx";
import { ReceiptView } from "./register/ReceiptView.tsx";

/** Local midnight to the next midnight, for "today". */
export function todayRange(now = new Date()): { from: string; to: string } {
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return { from: from.toISOString(), to: to.toISOString() };
}

export function SalesPage() {
  const { api } = useSession();
  const [range] = useState(todayRange);
  const [open, setOpen] = useState<string | null>(null);
  const day = useQuery({ queryKey: ["sales", range], queryFn: () => api.call("listSales", range) });

  return (
    <>
      <div className="page-head">
        <h1>Sales</h1>
        <span className="muted">
          Today,{" "}
          {new Date().toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}
        </span>
      </div>
      {day.isError && <p className="error-box">{errorMessage(day.error)}</p>}
      {day.data && (
        <div className="kpis">
          <Kpi label="Sales" value={String(day.data.count)} />
          <Kpi label="Total" value={formatMoney(day.data.totalCents)} />
          <Kpi label="Card" value={formatMoney(day.data.cardCents)} />
          <Kpi label="Cash" value={formatMoney(day.data.cashCents)} />
          <Kpi label="Discounts" value={formatMoney(day.data.discountCents)} />
          <Kpi label="Astro discounts" value={formatMoney(day.data.astroDiscountCents)} />
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
            {day.data?.sales.map((s) => (
              <tr key={s.id} onClick={() => setOpen(s.id)} style={{ cursor: "pointer" }}>
                <td className="num" style={{ whiteSpace: "nowrap" }}>
                  {new Date(s.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                </td>
                <td>
                  <button type="button" className="link" onClick={() => setOpen(s.id)}>
                    #{s.receiptNumber}
                  </button>
                  {s.status === "canceled" && <span className="tag muted"> Canceled</span>}
                </td>
                <td>{s.customerName ?? "Walk-in"}</td>
                <td>{s.items}</td>
                <td>{s.payment || "—"}</td>
                <td className="r num">{s.discountCents ? `−${formatMoney(s.discountCents)}` : ""}</td>
                <td className="r num">{formatMoney(s.totalCents)}</td>
              </tr>
            ))}
            {day.data?.sales.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  No sales yet today. Ring one up on the Register.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        Refunds, receipt reprints for other days and the end-of-day drawer count come next.
      </p>
      {open && <SaleReceipt id={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function SaleReceipt({ id, onClose }: { id: string; onClose: () => void }) {
  const { api } = useSession();
  const r = useQuery({ queryKey: ["sale", id], queryFn: () => api.call("getSale", { id }) });
  return (
    <SlideOver title={r.data ? `Receipt #${r.data.receiptNumber}` : "Receipt"} onClose={onClose}>
      {r.isError && <p className="error-box">{errorMessage(r.error)}</p>}
      {r.data && (
        <>
          <ReceiptView receipt={r.data} />
          <div>
            <button type="button" onClick={() => window.print()}>
              Print receipt
            </button>
          </div>
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
