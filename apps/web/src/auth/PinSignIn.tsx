import { useState } from "react";
import { PIN_RULES } from "@bearded/core";
import { posFetch } from "../api/http.ts";
import { errorMessage } from "../ui/errors.ts";

export interface TabletInfo {
  tablet: { name: string } | null;
  staff: { id: string; name: string }[];
}

/** On a tablet set up for PINs: tap your name, then enter your PIN on the keypad. */
export function PinSignIn({
  info,
  onSignedIn,
  onUseEmail,
}: {
  info: TabletInfo;
  onSignedIn: () => void;
  onUseEmail: () => void;
}) {
  const [who, setWho] = useState<{ id: string; name: string } | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function pick(s: { id: string; name: string } | null) {
    setWho(s);
    setPin("");
    setError(null);
  }

  async function signIn() {
    if (!who || pin.length < PIN_RULES.minDigits) return;
    setBusy(true);
    setError(null);
    try {
      await posFetch("pin-session", { staffId: who.id, pin });
      onSignedIn();
    } catch (err) {
      setError(errorMessage(err));
      setPin("");
      setBusy(false);
    }
  }

  const press = (d: string) => setPin((p) => (p.length < PIN_RULES.maxDigits ? p + d : p));

  return (
    <div className="center">
      <div className="card">
        {!who ? (
          <>
            <h1>Who's at the register?</h1>
            <p className="muted">Tap your name, then enter your PIN.</p>
            <div className="pin-names">
              {info.staff.map((s) => (
                <button key={s.id} type="button" onClick={() => pick(s)}>
                  {s.name}
                </button>
              ))}
            </div>
            <div className="actions">
              <button type="button" className="link" onClick={onUseEmail}>
                Sign in with email instead
              </button>
            </div>
          </>
        ) : (
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              void signIn();
            }}
          >
            <h1>Hi, {who.name}</h1>
            <label>
              PIN
              <input
                className="pin-input"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                maxLength={PIN_RULES.maxDigits}
                autoFocus
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, PIN_RULES.maxDigits))}
              />
            </label>
            <div className="pin-pad" role="group" aria-label="Keypad">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
                <button key={d} type="button" onClick={() => press(d)} disabled={busy}>
                  {d}
                </button>
              ))}
              <button type="button" onClick={() => setPin("")} disabled={busy}>
                Clear
              </button>
              <button type="button" onClick={() => press("0")} disabled={busy}>
                0
              </button>
              <button
                type="button"
                onClick={() => setPin((p) => p.slice(0, -1))}
                disabled={busy}
                aria-label="Delete"
              >
                ⌫
              </button>
            </div>
            {error && <p className="error-box">{error}</p>}
            <div className="actions">
              <button type="submit" className="primary" disabled={busy || pin.length < PIN_RULES.minDigits}>
                {busy ? "Signing in…" : "Sign in"}
              </button>
              <button type="button" onClick={() => pick(null)} disabled={busy}>
                Not {who.name}?
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
