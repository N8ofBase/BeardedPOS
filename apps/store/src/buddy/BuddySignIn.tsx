// Beard Buddy sign-in: an email, then the six-digit code we send. Signing in is joining.
import { useId, useState, type FormEvent } from "react";
import type { Account } from "@bearded/store-core";
import { errorText, looksLikeEmail, useStore } from "../api/store.ts";
import { useBuddy } from "./BuddyProvider.tsx";

export function BuddySignIn({
  intro,
  onSignedIn,
}: {
  intro: string;
  onSignedIn?: (account: Account) => void;
}) {
  const store = useStore();
  const buddy = useBuddy();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [devCode, setDevCode] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const id = useId();

  async function sendCode(e: FormEvent) {
    e.preventDefault();
    if (!looksLikeEmail(email)) {
      setError("Check the email address, like name@example.com.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const sent = await store.buddy.requestCode(email.trim());
      setDevCode(sent.devCode);
      setStep("code");
    } catch (err) {
      setError(errorText(err, "That didn’t go through. Try again in a minute."));
    } finally {
      setBusy(false);
    }
  }

  async function signIn(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const account = await store.buddy.signIn(email.trim(), code);
      buddy.set(account);
      onSignedIn?.(account);
    } catch (err) {
      setError(errorText(err, "That didn’t go through. Try again in a minute."));
      setBusy(false);
    }
  }

  return (
    <div className="code-signin">
      {step === "email" ? (
        <form onSubmit={sendCode} noValidate>
          <p className="lede">{intro}</p>
          <label htmlFor={`${id}-email`}>Email</label>
          <div className="row">
            <input
              id={`${id}-email`}
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <button className="btn go" type="submit" disabled={busy}>
              {busy ? "Sending…" : "Email me a code"}
            </button>
          </div>
        </form>
      ) : (
        <form onSubmit={signIn} noValidate>
          <p className="lede">We sent a code to {email.trim()}. It works for 10 minutes.</p>
          {devCode && (
            <p className="dev-code" role="status">
              Preview: no email is sent yet, so here is the code: <strong>{devCode}</strong>
            </p>
          )}
          <label htmlFor={`${id}-code`}>Code</label>
          <div className="row">
            <input
              id={`${id}-code`}
              className="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            />
            <button className="btn go" type="submit" disabled={busy || code.length !== 6}>
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </div>
          <button
            type="button"
            className="link"
            onClick={() => {
              setStep("email");
              setCode("");
              setError("");
            }}
          >
            Use a different email
          </button>
        </form>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
