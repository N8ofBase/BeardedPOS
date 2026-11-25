// Where the unsubscribe link in every news email lands. No sign-in: the token in the link says who,
// and it can only turn news email off (services/store-api/src/emailQueue.ts).
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { errorText, useStore, type UnsubscribeInfo } from "../api/store.ts";

const BROKEN = "That unsubscribe link isn’t complete. Reply to the email and we’ll take you off the list.";
const TRY_AGAIN = "We couldn’t reach the shop just now. Try the link again in a minute.";

type State =
  { state: "loading" } | { state: "ready"; info: UnsubscribeInfo } | { state: "failed"; message: string };

export function UnsubscribePage() {
  const store = useStore();
  const [params] = useSearchParams();
  const b = params.get("b") ?? "";
  const t = params.get("t") ?? "";
  const [status, setStatus] = useState<State>(
    b && t ? { state: "loading" } : { state: "failed", message: BROKEN },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!b || !t) return;
    let live = true;
    store.unsubscribeStatus(b, t).then(
      (info) => live && setStatus({ state: "ready", info }),
      (e: unknown) => live && setStatus({ state: "failed", message: errorText(e, TRY_AGAIN) }),
    );
    return () => {
      live = false;
    };
  }, [store, b, t]);

  async function turnOff() {
    setBusy(true);
    setError("");
    try {
      setStatus({ state: "ready", info: await store.unsubscribe(b, t) });
    } catch (e) {
      setError(errorText(e, TRY_AGAIN));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="wrap pad unsubscribe">
      {status.state === "loading" && <p>Loading…</p>}
      {status.state === "failed" && (
        <>
          <h1>Unsubscribe</h1>
          <p className="lede">{status.message}</p>
        </>
      )}
      {status.state === "ready" &&
        (status.info.alreadyOff ? (
          <>
            <h1>You’re unsubscribed</h1>
            <p className="lede">
              {status.info.email} won’t get any more news emails from {status.info.storeName}. Receipts for
              things you buy still come by email.
            </p>
            <a className="btn" href="/">
              Back to the games
            </a>
          </>
        ) : (
          <>
            <h1>Unsubscribe?</h1>
            <p className="lede">
              Stop news emails from {status.info.storeName} to {status.info.email}?
            </p>
            {error && <p role="alert">{error}</p>}
            <button type="button" className="btn go" onClick={() => void turnOff()} disabled={busy}>
              {busy ? "Unsubscribing…" : "Unsubscribe"}
            </button>
          </>
        ))}
    </section>
  );
}
