import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { can, formatPhone } from "@pet-pos/core";
import type { AstroQueueRow } from "@pet-pos/api";
import { useSession } from "../session.tsx";
import { errorMessage } from "../ui/errors.ts";
import { useToast } from "../ui/Toast.tsx";

const when = (d: Date) =>
  new Date(d).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** "To enter in Astro": every sale and refund with Astro activity, until staff mark it entered. */
export function AstroQueue() {
  const { api, me } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<"pending" | "entered">("pending");
  const canUndo = can(me.staff.role, "astro.edit");
  const rows = useQuery({
    queryKey: ["astroQueue", tab],
    queryFn: () => api.call("listAstroQueue", { status: tab }),
  });
  const mark = useMutation({
    mutationFn: (v: { id: string; entered: boolean }) => api.call("markAstroEntered", v),
    onSuccess: (_r, v) => {
      toast(v.entered ? "Marked entered" : "Put back to enter");
      void qc.invalidateQueries({ queryKey: ["astroQueue"] });
    },
    onError: (err) => toast(errorMessage(err)),
  });

  return (
    <>
      <h2>To enter in Astro</h2>
      <div className="cat-tabs" style={{ marginTop: 0, marginBottom: 10 }}>
        <button type="button" aria-pressed={tab === "pending"} onClick={() => setTab("pending")}>
          Pending
        </button>
        <button type="button" aria-pressed={tab === "entered"} onClick={() => setTab("entered")}>
          Entered
        </button>
      </div>
      {rows.isError && <p className="error-box">{errorMessage(rows.error)}</p>}
      <div className="tablewrap">
        <table className="wide">
          <thead>
            <tr>
              <th>Time</th>
              <th>Receipt</th>
              <th>Customer</th>
              <th>Enter in Astro</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.data?.map((r) => (
              <QueueRow
                key={r.id}
                r={r}
                canUndo={canUndo}
                busy={mark.isPending}
                onMark={(entered) => mark.mutate({ id: r.id, entered })}
              />
            ))}
            {rows.data?.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  {tab === "pending"
                    ? "Nothing to enter. Sales with Astro credit, rewards or offers show up here."
                    : "Nothing entered yet."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function QueueRow({
  r,
  canUndo,
  busy,
  onMark,
}: {
  r: AstroQueueRow;
  canUndo: boolean;
  busy: boolean;
  onMark: (entered: boolean) => void;
}) {
  return (
    <tr>
      <td className="num" style={{ whiteSpace: "nowrap" }}>
        {when(r.createdAt)}
      </td>
      <td>
        #{r.receiptNumber}
        {r.kind === "refund" && <span className="tag low"> Refund</span>}
        {r.status === "failed" && <span className="tag out"> Send failed</span>}
      </td>
      <td>
        {r.customerName ?? "Walk-in"}
        {r.customerPhone && <span className="sub">{formatPhone(r.customerPhone)}</span>}
      </td>
      <td>
        {r.entries.map((e) => (
          <div key={e}>{e}</div>
        ))}
        {r.status === "failed" && r.error && (
          <span className="sub">
            Tried {r.attempts} times: {r.error}
          </span>
        )}
        {r.enteredAt && (
          <span className="sub">
            {r.status === "sent" ? "Sent" : `Entered by ${r.enteredByName ?? "someone"}`}, {when(r.enteredAt)}
          </span>
        )}
      </td>
      <td>
        {r.status === "pending" || r.status === "failed" ? (
          <button type="button" className="primary" disabled={busy} onClick={() => onMark(true)}>
            Mark entered
          </button>
        ) : (
          r.status === "entered" &&
          canUndo && (
            <button type="button" disabled={busy} onClick={() => onMark(false)}>
              Undo
            </button>
          )
        )}
      </td>
    </tr>
  );
}
