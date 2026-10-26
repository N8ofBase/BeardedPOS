// Beard Buddy: a shopper's Beard Bucks, their birthday and the last moves of their Bucks.
import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import {
  BIRTHDAY_BUCKS,
  BUCKS_PER_REWARD,
  bucksLabel,
  formatCents,
  LEDGER_LABEL,
  MIN_REWARD_ORDER_CENTS,
  PROGRAM_NAME,
  REWARD_CENTS,
  WELCOME_BUCKS,
  type Account,
} from "@bearded/store-core";
import { errorText, useStore } from "../api/store.ts";
import { BuddySignIn } from "../buddy/BuddySignIn.tsx";
import { useBuddy } from "../buddy/BuddyProvider.tsx";

const when = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

export function AccountPage() {
  const { account } = useBuddy();
  return (
    <section className="wrap pad account">
      <h1>{PROGRAM_NAME}</h1>
      {account.state === "loading" && <p>Checking your account…</p>}
      {account.state === "failed" && (
        <p>We couldn’t reach the store server. Refresh the page to try again.</p>
      )}
      {account.state === "ready" &&
        (account.value ? (
          <SignedIn account={account.value} />
        ) : (
          <BuddySignIn
            intro={`Join and get ${WELCOME_BUCKS} Beard Bucks (${formatCents(REWARD_CENTS)} off) right away, then earn more on every order. Enter your email and we’ll send a 6-digit code.`}
          />
        ))}
    </section>
  );
}

function SignedIn({ account }: { account: Account }) {
  const buddy = useBuddy();
  return (
    <>
      <div className="staff-bar">
        <p>
          Signed in as <strong>{account.email}</strong>
        </p>
        <button type="button" className="btn" onClick={() => void buddy.signOut()}>
          Sign out
        </button>
      </div>
      <div className="bucks-card">
        {!!account.welcomeBucks && (
          <p role="status">
            Welcome to Beard Buddy! We added {bucksLabel(account.welcomeBucks)} to get you started.
          </p>
        )}
        <p className="balance">
          <strong>{bucksLabel(account.balance)}</strong>
        </p>
        <p>
          {BUCKS_PER_REWARD} Bucks = {formatCents(REWARD_CENTS)} off any order of{" "}
          {formatCents(MIN_REWARD_ORDER_CENTS)} or more. You earn 1 Buck for every dollar you spend. Use them
          in your cart at checkout.
        </p>
        {account.held > 0 && (
          <p className="fine">
            {bucksLabel(account.held)} are saved for a checkout you started. They come back in 24 hours if it
            isn’t paid.
          </p>
        )}
        <Link className="btn go" to="/shop">
          Shop the games
        </Link>
      </div>
      <Details account={account} />
      <h2>Your Beard Bucks</h2>
      {account.history.length === 0 ? (
        <p>Nothing yet. Your first order earns your first Bucks.</p>
      ) : (
        <ul className="ledger">
          {account.history.map((e, i) => (
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
    </>
  );
}

function Details({ account }: { account: Account }) {
  const store = useStore();
  const buddy = useBuddy();
  const [name, setName] = useState(account.name ?? "");
  const [birthday, setBirthday] = useState(account.birthday ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState("");

  async function save(e: FormEvent) {
    e.preventDefault();
    setState("saving");
    setError("");
    try {
      buddy.set(
        await store.buddy.save({
          name,
          ...(account.birthdayLocked ? {} : { birthday: birthday || null }),
        }),
      );
      setState("saved");
    } catch (err) {
      setError(errorText(err, "That didn’t save. Try again in a minute."));
      setState("idle");
    }
  }

  return (
    <form className="account-details" onSubmit={save} noValidate>
      <h2>About you</h2>
      <label htmlFor="buddy-name">Name</label>
      <input
        id="buddy-name"
        autoComplete="name"
        maxLength={60}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <label htmlFor="buddy-birthday">Birthday</label>
      <input
        id="buddy-birthday"
        type="date"
        value={birthday}
        disabled={account.birthdayLocked}
        onChange={(e) => setBirthday(e.target.value)}
      />
      <p className="fine">
        {account.birthdayLocked
          ? "Your birthday is set. Email us if it needs fixing."
          : `Get ${BIRTHDAY_BUCKS} Bucks on your first order in your birthday month each year. Once it’s set, it can’t be changed for a year.`}
      </p>
      <button className="btn go" type="submit" disabled={state === "saving"}>
        {state === "saving" ? "Saving…" : "Save"}
      </button>
      {state === "saved" && <p role="status">Saved.</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
