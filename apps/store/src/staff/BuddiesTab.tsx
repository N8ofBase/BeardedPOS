// Beard Buddies: every shopper with an account, their Beard Bucks and, on a click, their history.
// Read-only for now: Bucks change only through paid web orders.
import { useEffect, useState } from "react";
import { bucksLabel, LEDGER_LABEL, type LedgerEntry, type StaffBuddy } from "@bearded/store-core";
import { useStore, type Loadable } from "../api/store.ts";

const when = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

export function BuddiesTab() {
  const store = useStore();
  const [buddies, setBuddies] = useState<Loadable<StaffBuddy[]>>({ state: "loading" });

  useEffect(() => {
    let live = true;
    store.staff.buddies().then(
      (value) => live && setBuddies({ state: "ready", value }),
      () => live && setBuddies({ state: "failed" }),
    );
    return () => {
      live = false;
    };
  }, [store]);

  if (buddies.state === "loading") return <p>Loading Beard Buddies…</p>;
  if (buddies.state === "failed")
    return <p>We couldn’t load Beard Buddies. Refresh the page to try again.</p>;
  if (buddies.value.length === 0)
    return <p>No one has signed in to Beard Buddy yet. Shoppers join the first time they sign in.</p>;
  return (
    <div className="buddies">
      <p className="hint">
        {buddies.value.length} Beard {buddies.value.length === 1 ? "Buddy" : "Buddies"}, biggest balance
        first. Bucks are earned and used on paid web orders.
      </p>
      <ul className="staff-list">
        {buddies.value.map((b) => (
          <Buddy key={b.id} buddy={b} />
        ))}
      </ul>
    </div>
  );
}

function Buddy({ buddy }: { buddy: StaffBuddy }) {
  const store = useStore();
  const [history, setHistory] = useState<Loadable<LedgerEntry[]> | null>(null);

  function toggle() {
    if (history) return setHistory(null);
    setHistory({ state: "loading" });
    store.staff.buddyHistory(buddy.id).then(
      (value) => setHistory({ state: "ready", value }),
      () => setHistory({ state: "failed" }),
    );
  }

  return (
    <li className="review buddy">
      <div className="top">
        <strong>{buddy.name || buddy.email}</strong>
        {buddy.name && <span>{buddy.email}</span>}
        <strong className="balance">{bucksLabel(buddy.balance)}</strong>
      </div>
      <p className="fine">
        {buddy.paidOrders} paid {buddy.paidOrders === 1 ? "order" : "orders"}
        {buddy.lastOrderAt && `, last on ${when.format(new Date(buddy.lastOrderAt))}`}. Joined{" "}
        {when.format(new Date(buddy.joinedAt))}.
      </p>
      <button type="button" className="link" aria-expanded={!!history} onClick={toggle}>
        {history ? "Hide history" : "Show history"}
      </button>
      {history?.state === "loading" && <p>Loading…</p>}
      {history?.state === "failed" && <p>We couldn’t load the history. Try again in a minute.</p>}
      {history?.state === "ready" && (
        <ul className="ledger">
          {history.value.map((e, i) => (
            <li key={`${e.at}-${i}`}>
              <span>{LEDGER_LABEL[e.kind]}</span>
              <span className="when">{when.format(new Date(e.at))}</span>
              <strong className={e.bucks < 0 ? "minus" : "plus"}>
                {e.bucks > 0 ? "+" : "−"}
                {Math.abs(e.bucks).toLocaleString("en-US")}
              </strong>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
