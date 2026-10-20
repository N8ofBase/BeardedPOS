import { useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";
import { can, formatMoney } from "@pet-pos/core";
import { useSession } from "../../session.tsx";
import { errorMessage } from "../../ui/errors.ts";
import { SaleReceipt } from "../SalesPage.tsx";

const day = (d: Date | null) =>
  d ? new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—";

/** Order history on the customer profile: register sales and imported orders together. */
export function OrderHistory({ customerId }: { customerId: string }) {
  const { api, me } = useSession();
  const canOpen = can(me.staff.role, "register.use");
  const [open, setOpen] = useState<string | null>(null);
  const h = useInfiniteQuery({
    queryKey: ["history", customerId],
    queryFn: ({ pageParam }) => api.call("customerHistory", { id: customerId, before: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next,
  });
  const first = h.data?.pages[0];

  return (
    <section className="panel">
      <h2>Order history</h2>
      {h.isError && <p className="error-box">{errorMessage(h.error)}</p>}
      {first && first.orders === 0 && <p className="muted">No orders yet.</p>}
      {first && first.orders > 0 && (
        <>
          <div className="kpis">
            <Kpi label="Total spent" value={formatMoney(first.totalSpentCents)} />
            <Kpi label="Orders" value={String(first.orders)} />
            <Kpi label="First visit" value={day(first.firstVisit)} />
            <Kpi label="Last visit" value={day(first.lastVisit)} />
          </div>
          {first.mostBought.length > 0 && (
            <p style={{ margin: 0 }}>
              <span className="muted">Most bought: </span>
              {first.mostBought.map((m) => `${m.name} (${m.qty})`).join(", ")}
            </p>
          )}
          <div className="tablewrap">
            <table className="wide">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Receipt</th>
                  <th>Items</th>
                  <th className="r">Total</th>
                </tr>
              </thead>
              <tbody>
                {(h.data?.pages ?? [])
                  .flatMap((p) => p.page)
                  .map((o) => (
                    <tr key={o.id}>
                      <td className="num" style={{ whiteSpace: "nowrap" }}>
                        {day(o.date)}
                      </td>
                      <td>
                        {o.source === "register" && canOpen ? (
                          <button type="button" className="link" onClick={() => setOpen(o.id)}>
                            {o.label}
                          </button>
                        ) : (
                          <span className="muted">{o.label}</span>
                        )}
                        {o.refundedCents > 0 && (
                          <span className="tag low">
                            {" "}
                            {o.refundedCents >= o.totalCents
                              ? "Fully refunded"
                              : `Refunded ${formatMoney(o.refundedCents)}`}
                          </span>
                        )}
                      </td>
                      <td>{o.items}</td>
                      <td className="r num">{formatMoney(o.totalCents)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {h.hasNextPage && (
            <div>
              <button type="button" onClick={() => void h.fetchNextPage()} disabled={h.isFetchingNextPage}>
                Show more
              </button>
            </div>
          )}
        </>
      )}
      {open && <SaleReceipt id={open} onClose={() => setOpen(null)} />}
    </section>
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
