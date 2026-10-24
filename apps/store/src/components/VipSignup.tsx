import { useId, useState, type FormEvent } from "react";
import { looksLikeEmail, useStore } from "../api/store.ts";
import { brand } from "../content/site.ts";
import { useTracker } from "../track/Tracker.tsx";

/** The VIP email form, used by the VIP band and the popup. */
export function VipSignup({
  label = "Join the VIP list",
  source = "band",
  onJoined,
}: {
  label?: string;
  /** Which signup it was, for store stats. */
  source?: "band" | "popup";
  onJoined?: () => void;
}) {
  const store = useStore();
  const { track } = useTracker();
  const id = useId();
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
      await store.joinVip(email.trim(), source);
      track({ type: "vip_join", label: source });
      setState("joined");
      onJoined?.();
    } catch {
      setState("failed");
    }
  }

  if (state === "joined")
    return (
      <p className="joined" role="status">
        {brand.vipThanks}
      </p>
    );

  return (
    <form className="signup" onSubmit={onSubmit} noValidate>
      <label htmlFor={`${id}-email`}>{label}</label>
      <div className="row">
        <input
          id={`${id}-email`}
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
        />
        <button className="btn red" type="submit" disabled={state === "sending"}>
          {state === "sending" ? "Joining…" : "Join"}
        </button>
      </div>
      {error && (
        <p className="error" id={`${id}-error`}>
          {error}
        </p>
      )}
      {state === "failed" && <p className="error">That didn’t go through. Try again in a minute.</p>}
    </form>
  );
}
