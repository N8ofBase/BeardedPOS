// Behind the Beard: the staff page. Sign in with a one-time code, then approve reviews, read store
// stats and sort through what to keep from the old site. Hidden from shoppers: no links to it, no tracking, and search engines are told to skip it.
import { useEffect, useState, type FormEvent } from "react";
import type { StaffMe } from "@bearded/store-core";
import { errorText, looksLikeEmail, useStore, type Loadable } from "../api/store.ts";
import { BuddiesTab } from "./BuddiesTab.tsx";
import { OldSiteTab } from "./OldSiteTab.tsx";
import { ReviewsTab } from "./ReviewsTab.tsx";
import { StatsTab } from "./StatsTab.tsx";

type Tab = "reviews" | "stats" | "buddies" | "old-site";

export function BehindTheBeard() {
  const store = useStore();
  const [me, setMe] = useState<Loadable<StaffMe | null>>({ state: "loading" });

  useEffect(() => {
    const robots = document.createElement("meta");
    robots.name = "robots";
    robots.content = "noindex";
    document.head.append(robots);
    let live = true;
    store.staff.me().then(
      (value) => live && setMe({ state: "ready", value }),
      () => live && setMe({ state: "failed" }),
    );
    return () => {
      live = false;
      robots.remove();
    };
  }, [store]);

  return (
    <section className="wrap pad staff" data-no-track>
      <h1>Behind the Beard</h1>
      {me.state === "loading" && <p>Checking who you are…</p>}
      {me.state === "failed" && <p>We couldn’t reach the store server. Refresh the page to try again.</p>}
      {me.state === "ready" && !me.value && (
        <SignIn onSignedIn={(value) => setMe({ state: "ready", value })} />
      )}
      {me.state === "ready" && me.value && (
        <SignedIn
          me={me.value}
          onSignedOut={() => {
            setMe({ state: "ready", value: null });
          }}
        />
      )}
    </section>
  );
}

function SignedIn({ me, onSignedOut }: { me: StaffMe; onSignedOut: () => void }) {
  const store = useStore();
  const [tab, setTab] = useState<Tab>("reviews");
  const tabs: [Tab, string][] = [
    ["reviews", "Reviews"],
    ["stats", "Stats"],
    ["buddies", "Beard Buddies"],
    ["old-site", "Old site"],
  ];
  return (
    <>
      <div className="staff-bar">
        <p>
          Signed in as <strong>{me.email}</strong>
        </p>
        <button type="button" className="btn" onClick={() => store.staff.signOut().finally(onSignedOut)}>
          Sign out
        </button>
      </div>
      <div className="tabs" role="tablist" aria-label="Behind the Beard">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={`tab-${key}`}
            aria-selected={tab === key}
            aria-controls={`panel-${key}`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "reviews" ? (
          <ReviewsTab />
        ) : tab === "stats" ? (
          <StatsTab />
        ) : tab === "buddies" ? (
          <BuddiesTab />
        ) : (
          <OldSiteTab />
        )}
      </div>
    </>
  );
}

function SignIn({ onSignedIn }: { onSignedIn: (me: StaffMe) => void }) {
  const store = useStore();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [devCode, setDevCode] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function sendCode(e: FormEvent) {
    e.preventDefault();
    if (!looksLikeEmail(email)) {
      setError("Check the email address, like name@beardedboardgames.com.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const sent = await store.staff.requestCode(email.trim());
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
      onSignedIn(await store.staff.signIn(email.trim(), code));
    } catch (err) {
      setError(errorText(err, "That didn’t go through. Try again in a minute."));
      setBusy(false);
    }
  }

  return (
    <div className="staff-signin">
      {step === "email" ? (
        <form onSubmit={sendCode} noValidate>
          <p className="lede">For the Bearded team. We’ll email you a six-digit code to sign in.</p>
          <label htmlFor="staff-email">Work email</label>
          <div className="row">
            <input
              id="staff-email"
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
          <p className="lede">
            If {email.trim()} is on the team list, a code is on its way. It works for 10 minutes.
          </p>
          {devCode && (
            <p className="dev-code" role="status">
              Preview: no email is sent yet, so here is the code: <strong>{devCode}</strong>
            </p>
          )}
          <label htmlFor="staff-code">Code</label>
          <div className="row">
            <input
              id="staff-code"
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
