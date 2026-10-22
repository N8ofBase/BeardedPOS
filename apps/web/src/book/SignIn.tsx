import { useMutation } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import type { CodeSent } from "@pet-pos/api";
import { errorMessage } from "../ui/errors.ts";
import { useBooking } from "./context.ts";

/** Sign in or sign up with a one-time code sent to a phone or email. */
export function SignIn() {
  const { api, signIn } = useBooking();
  const [contact, setContact] = useState("");
  const [sent, setSent] = useState<CodeSent | null>(null);
  const [code, setCode] = useState("");
  const [needsName, setNeedsName] = useState(false);
  const [name, setName] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const ask = useMutation({
    mutationFn: () => api.call("requestCode", { contact }),
    onSuccess: (r) => {
      setSent(r);
      setMessage(null);
    },
    onError: (err) => setMessage(errorMessage(err)),
  });
  const verify = useMutation({
    mutationFn: () => api.call("verifyCode", { contact, code, name: needsName ? name : undefined }),
    onSuccess: (r) => {
      if (r.status === "signed_in") return signIn(r.token, r.name);
      if (r.status === "needs_name") {
        setNeedsName(true);
        return setMessage(null);
      }
      setMessage(r.message);
    },
    onError: (err) => setMessage(errorMessage(err)),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!sent) ask.mutate();
    else verify.mutate();
  }

  return (
    <form className="panel" onSubmit={submit} style={{ display: "grid", gap: 12 }} aria-label="Sign in">
      <h2 style={{ margin: 0 }}>Sign in to book</h2>
      {!sent ? (
        <>
          <p className="muted" style={{ margin: 0 }}>
            We'll send you a code. New here? Use the same steps to sign up.
          </p>
          <label>
            Mobile number or email
            <input
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              autoComplete="email tel"
              placeholder="(212) 555-0100 or you@example.com"
              autoFocus
              required
            />
          </label>
          <button className="primary big" disabled={ask.isPending}>
            Send me a code
          </button>
        </>
      ) : (
        <>
          <p style={{ margin: 0 }}>We sent a 6-digit code in {sent.sentTo}.</p>
          {sent.demoCode && (
            <p className="note" style={{ margin: 0 }}>
              In the demo your code is <b className="num">{sent.demoCode}</b>. In the hosted version it's sent
              by text or email.
            </p>
          )}
          <label>
            Code
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              required
            />
          </label>
          {needsName && (
            <label>
              Your name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                required
                autoFocus
              />
              <span className="muted small">Welcome! We just need your name to set up your account.</span>
            </label>
          )}
          <button className="primary big" disabled={verify.isPending || code.length !== 6}>
            {needsName ? "Create my account" : "Sign in"}
          </button>
          <button
            type="button"
            className="link"
            onClick={() => {
              setSent(null);
              setCode("");
              setNeedsName(false);
            }}
          >
            Use a different number or email
          </button>
        </>
      )}
      {message && (
        <p className="error-box" role="alert" style={{ margin: 0 }}>
          {message}
        </p>
      )}
    </form>
  );
}
