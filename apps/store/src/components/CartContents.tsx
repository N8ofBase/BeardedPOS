import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { formatCents, maxQty } from "@bearded/store-core";
import { errorText, useStore } from "../api/store.ts";
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
  const summary = cart.summary;

  if (!summary) return <p>Loading your cart…</p>;

  async function checkout() {
    setState("sending");
    try {
      const lines = summary!.lines.map((l) => ({ productId: l.product.id, qty: l.qty }));
      const { url } = await store.checkout(lines, tracker.visitorId);
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
          <p className="subtotal">
            <span>Subtotal</span>
            <strong>{formatCents(summary.subtotalCents)}</strong>
          </p>
          <p className="fine">
            Tax and shipping are added on Square’s secure checkout page. Pickup in St. Louis is free.
          </p>
          <button
            type="button"
            className="btn red checkout"
            onClick={checkout}
            disabled={state === "sending"}
          >
            {state === "sending" ? "Opening checkout…" : "Check out"}
          </button>
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
