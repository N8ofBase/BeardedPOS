// Beard Buddy on the customer profile: the balance, recent Bucks in and out, and a
// manager's add-or-take-away with a note.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { bucksLabel, can, LEDGER_LABEL, PROGRAM_NAME } from "@bearded/core";
import { useSession } from "../../session.tsx";
import { errorMessage } from "../../ui/errors.ts";
import { useToast } from "../../ui/Toast.tsx";

const day = (d: Date) =>
  new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

export function BeardBucks({ customerId }: { customerId: string }) {
  const { api, me } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const canAdjust = can(me.staff.role, "loyalty.adjust");
  const [adjusting, setAdjusting] = useState(false);
  const [bucks, setBucks] = useState("");
  const [note, setNote] = useState("");
  const q = useQuery({
    queryKey: ["bucks", customerId],
    queryFn: () => api.call("customerBucks", { customerId }),
  });
  const save = useMutation({
    mutationFn: () => api.call("adjustBucks", { customerId, bucks: Number(bucks), note }),
    onSuccess: (r) => {
      toast(`Balance is now ${bucksLabel(r.balance)}`);
      setAdjusting(false);
      setBucks("");
      setNote("");
      void qc.invalidateQueries({ queryKey: ["bucks", customerId] });
    },
    onError: (err) => toast(errorMessage(err)),
  });

  if (!q.data) return q.isError ? <p className="error-box">{errorMessage(q.error)}</p> : null;
  const b = q.data;
  if (!b.enabled && !b.history.length) return null;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!/^-?\d+$/.test(bucks.trim()) || Number(bucks) === 0)
      return toast("Enter a whole number of Beard Bucks, like 50 or -20.");
    save.mutate();
  }

  return (
    <section className="panel">
      <h2>{PROGRAM_NAME}</h2>
      <p style={{ margin: 0 }}>
        <b className="num">{bucksLabel(b.balance)}</b>
        {b.balance >= 100 && (
          <span className="muted"> · worth ${Math.floor(b.balance / 100) * 5} off at the register</span>
        )}
      </p>
      {!b.enabled && <p className="muted">Beard Buddy is turned off in Settings.</p>}
      {b.birthdayGiftDue && (
        <p style={{ margin: 0 }}>
          <span className="tag low">Birthday month: +100 Beard Bucks on their next sale</span>
        </p>
      )}
      {b.history.length > 0 ? (
        <div className="tablewrap">
          <table className="wide">
            <thead>
              <tr>
                <th>Date</th>
                <th>What</th>
                <th className="r">Bucks</th>
              </tr>
            </thead>
            <tbody>
              {b.history.map((e) => (
                <tr key={e.id}>
                  <td>{day(e.createdAt)}</td>
                  <td>
                    {LEDGER_LABEL[e.kind]}
                    {e.receiptNumber ? ` · #${e.receiptNumber}` : ""}
                    {e.note ? <span className="muted"> · {e.note}</span> : null}
                  </td>
                  <td className="r num">{e.bucks > 0 ? `+${e.bucks}` : e.bucks}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">No Beard Bucks yet. They earn 1 for every dollar they spend.</p>
      )}
      {canAdjust &&
        (adjusting ? (
          <form className="actions" onSubmit={submit}>
            <input
              value={bucks}
              onChange={(e) => setBucks(e.target.value)}
              inputMode="numeric"
              placeholder="50 or -20"
              aria-label="Beard Bucks to add or take away"
              style={{ width: "8em" }}
            />
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Why (shown in the history)"
              aria-label="Why"
              maxLength={200}
            />
            <button type="submit" className="primary" disabled={save.isPending}>
              Save
            </button>
            <button type="button" onClick={() => setAdjusting(false)}>
              Cancel
            </button>
          </form>
        ) : (
          <div className="actions">
            <button type="button" onClick={() => setAdjusting(true)}>
              Add or take away Bucks
            </button>
          </div>
        ))}
    </section>
  );
}
