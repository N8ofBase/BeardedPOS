import { useState, type FormEvent } from "react";
import meeple from "../assets/meeple.webp";
import { looksLikeEmail, useStore } from "../api/store.ts";
import { brand } from "../content/site.ts";

export function VipBand() {
  const store = useStore();
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "joined" | "failed">("idle");
  const [error, setError] = useState("");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!looksLikeEmail(email)) {
      setError("Check the email address. It needs an @ and a domain, like name@example.com.");
      return;
    }
    setError("");
    setState("sending");
    try {
      await store.joinVip(email.trim());
      setState("joined");
    } catch {
      setState("failed");
    }
  }

  return (
    <section className="vip" id="vip">
      <div className="wrap pad">
        <img className="meeple" src={meeple} alt="" width="520" height="508" />
        <div>
          <h2>The Bearded Bundle is coming.</h2>
          <p>
            Three new games for the 2026 holiday season (hopefully — we all have day jobs). Join the VIP list
            for first dibs on pre-orders and 10% off.
          </p>
          {state === "joined" ? (
            <p className="joined" role="status">
              {brand.vipThanks}
            </p>
          ) : (
            <form className="signup" onSubmit={onSubmit} noValidate>
              <label htmlFor="vip-email">Join the VIP list</label>
              <div className="row">
                <input
                  id="vip-email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? "vip-error" : undefined}
                />
                <button className="btn red" type="submit" disabled={state === "sending"}>
                  {state === "sending" ? "Joining…" : "Join"}
                </button>
              </div>
              {error && (
                <p className="error" id="vip-error">
                  {error}
                </p>
              )}
              {state === "failed" && <p className="error">That didn’t go through. Try again in a minute.</p>}
            </form>
          )}
        </div>
        <ul className="perks">
          <li>
            <strong>10% off</strong> pre-orders
          </li>
          <li>
            <strong>First dibs</strong> on limited runs
          </li>
          <li>
            <strong>Playtest invites</strong> and market dates
          </li>
        </ul>
      </div>
    </section>
  );
}
