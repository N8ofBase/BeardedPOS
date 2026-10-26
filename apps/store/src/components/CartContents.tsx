import { useId, useState } from "react";
import { Link, useNavigate } from "react-router";
import {
  BUCKS_PER_REWARD,
  bucksEarned,
  bucksLabel,
  formatCents,
  maxQty,
  REWARD_CENTS,
  REWARD_NAME,
  rewardsAllowed,
} from "@bearded/store-core";
import { errorText, useStore } from "../api/store.ts";
import { BuddySignIn } from "../buddy/BuddySignIn.tsx";
import { useSignedIn } from "../buddy/BuddyProvider.tsx";
import { useCart } from "../cart/CartProvider.tsx";
import { useTracker } from "../track/Tracker.tsx";

/** The cart's lines, subtotal and checkout button: shown in the drawer and on /cart. */
export function CartContents({ onLeave }: { onLeave?: () => void }) {
  const cart = useCart();
  const store = useStore();
  const navigate = useNavigate();
  const tracker = useTracker();
  const [state, setState] = useState<"idle" | "sending" | "failed">("idle");
  const [error, setError] = useState("");
  // Signed out, "Check out" first asks: sign in and earn Bucks, or go on as a guest.
  const [choice, setChoice] = useState<"closed" | "open" | "signing-in">("closed");
  const [wantRewards, setWantRewards] = useState(0);
  const guestNote = useId();
  const account = useSignedIn();
  const summary = cart.summary;

  if (!summary) return <p>Loading your cart…</p>;

  const maxRewards = account ? rewardsAllowed(account.balance, summary.subtotalCents) : 0;
  const rewards = Math.min(wantRewards, maxRewards);
  const discountCents = rewards * REWARD_CENTS;
  const earns = bucksEarned(summary.subtotalCents - discountCents);

  async function checkout() {
    setState("sending");
    try {
      const lines = summary!.lines.map((l) => ({ productId: l.product.id, qty: l.qty }));
      const { url } = await store.checkout(lines, tracker.visitorId, account ? rewards : 0);
      tracker.track({ type: "checkout_start", qty: lines.reduce((n, l) => n + l.qty, 0) });
      onLeave?.();
      if (url.startsWith("/")) navigate(url);
      else window.location.assign(url);
    } catch (e) {
      setError(errorText(e, "Checkout didn’t open. Try again in a minute."));
      setState("failed");
    }
  }

  return (
    <div className="cart">
      {summary.changes.length > 0 && (
        <ul className="cart-changes" role="status">
          {summary.changes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      )}
      {summary.lines.length === 0 ? (
        <div className="cart-empty">
          <p>Your cart is empty.</p>
          <Link className="btn go" to="/shop" onClick={onLeave}>
            Browse the shop
          </Link>
        </div>
      ) : (
        <>
          <ul className="cart-lines">
            {summary.lines.map(({ product, qty, lineCents }) => (
              <li key={product.id}>
                <div>
                  <strong>{product.name}</strong>
                  <span className="each">{formatCents(product.priceCents)} each</span>
                </div>
                <div className="qty" role="group" aria-label={`Quantity of ${product.name}`}>
                  <button
                    type="button"
                    onClick={() => cart.setQty(product, qty - 1)}
                    aria-label={`One fewer ${product.name}`}
                  >
                    −
                  </button>
                  <output aria-live="polite">{qty}</output>
                  <button
                    type="button"
                    onClick={() => cart.setQty(product, qty + 1)}
                    disabled={qty >= maxQty(product)}
                    aria-label={`One more ${product.name}`}
                  >
                    +
                  </button>
                </div>
                <span className="line-total">{formatCents(lineCents)}</span>
                <button type="button" className="remove" onClick={() => cart.remove(product.id)}>
                  Remove<span className="sr"> {product.name}</span>
                </button>
              </li>
            ))}
          </ul>
          {account && maxRewards > 0 && (
            <div className="bucks-reward" role="group" aria-label="Beard Bucks reward">
              <p>
                You have {bucksLabel(account.balance)}.{" "}
                {rewards > 0
                  ? `Use ${(rewards * BUCKS_PER_REWARD).toLocaleString("en-US")} for ${formatCents(discountCents)} off.`
                  : `Use ${BUCKS_PER_REWARD} for ${formatCents(REWARD_CENTS)} off?`}
              </p>
              <div className="qty">
                <button
                  type="button"
                  onClick={() => setWantRewards(rewards - 1)}
                  disabled={rewards === 0}
                  aria-label="One fewer reward"
                >
                  −
                </button>
                <output aria-live="polite" aria-label="Rewards used">
                  {rewards}
                </output>
                <button
                  type="button"
                  onClick={() => setWantRewards(rewards + 1)}
                  disabled={rewards >= maxRewards}
                  aria-label="One more reward"
                >
                  +
                </button>
              </div>
            </div>
          )}
          {discountCents > 0 && (
            <p className="subtotal reward">
              <span>{REWARD_NAME}</span>
              <strong>−{formatCents(discountCents)}</strong>
            </p>
          )}
          <p className="subtotal">
            <span>Subtotal</span>
            <strong>{formatCents(summary.subtotalCents - discountCents)}</strong>
          </p>
          {account && earns > 0 && <p className="earns">This order earns {bucksLabel(earns)}.</p>}
          <p className="fine">
            Tax and shipping are added on Square’s secure checkout page. Pickup in St. Louis is free.
          </p>
          {account || choice === "closed" ? (
            <button
              type="button"
              className="btn red checkout"
              onClick={account ? checkout : () => setChoice("open")}
              disabled={state === "sending"}
            >
              {state === "sending" ? "Opening checkout…" : "Check out"}
            </button>
          ) : choice === "signing-in" ? (
            <BuddySignIn
              intro={`Sign in to earn ${bucksLabel(earns)} on this order. We’ll email you a 6-digit code.`}
              onSignedIn={() => setChoice("closed")}
            />
          ) : (
            <div className="checkout-choice">
              <button type="button" className="btn go checkout" onClick={() => setChoice("signing-in")}>
                Sign in and earn {bucksLabel(earns)}
              </button>
              <button
                type="button"
                className="btn red checkout"
                onClick={checkout}
                disabled={state === "sending"}
                aria-describedby={guestNote}
              >
                {state === "sending" ? "Opening checkout…" : "Check out as a guest"}
              </button>
              <p className="fine" id={guestNote}>
                Guest orders don’t earn Beard Bucks.
              </p>
            </div>
          )}
          {state === "failed" && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </>
      )}
    </div>
  );
}
