import { useState } from "react";
import { posFetch } from "../api/http.ts";
import { errorMessage } from "../ui/errors.ts";

/** Hosted sign-in: staff get a 6-digit code at the email in the register's Settings. */
export function EmailSignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await posFetch<{ sent: boolean; devCode?: string }>("code", { email });
      setDevCode(r.devCode ?? null);
      setCode("");
      setStep("code");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await posFetch("session", { email, code });
      onSignedIn();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="center">
      <div className="card">
        <h1>Sign in to the register</h1>
        {step === "email" ? (
          <form onSubmit={sendCode} className="stack">
            <p className="muted">We'll email you a code. Use the email your store has on file for you.</p>
            <label>
              Email
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            {error && <p className="error-box">{error}</p>}
            <div className="actions">
              <button type="submit" className="primary" disabled={busy}>
                {busy ? "Sending…" : "Email me a code"}
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={signIn} className="stack">
            <p className="muted">
              If {email} belongs to someone on staff, a code is on its way. It works for 10 minutes.
            </p>
            {devCode && <p className="muted">Test mode, no email sent. Your code is {devCode}.</p>}
            <label>
              Code
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </label>
            {error && <p className="error-box">{error}</p>}
            <div className="actions">
              <button type="submit" className="primary" disabled={busy}>
                {busy ? "Signing in…" : "Sign in"}
              </button>
              <button type="button" onClick={() => setStep("email")} disabled={busy}>
                Use another email
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
