import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { formatCents, type OrderView } from "@bearded/store-core";
import { errorText, useStore, type Loadable } from "../api/store.ts";

/**
 * Offline stand-in for Square's payment page, so the whole order can be tried before Square is
 * connected. It asks for no card details and charges nothing.
 */
export function CheckoutPreviewPage() {
  const { id = "" } = useParams();
  const store = useStore();
  const navigate = useNavigate();
  const [order, setOrder] = useState<Loadable<OrderView>>({ state: "loading" });
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    store.previewOrder(id).then(
      (value) => live && setOrder({ state: "ready", value }),
      () => live && setOrder({ state: "failed" }),
    );
    return () => {
      live = false;
    };
  }, [store, id]);

  async function pay() {
    setPaying(true);
    setError("");
    try {
      await store.payPreviewOrder(id);
      navigate(`/thanks?order=${encodeURIComponent(id)}&preview=1`);
    } catch (e) {
      setError(errorText(e, "That didn’t go through. Try again in a minute."));
      setPaying(false);
    }
  }

  return (
    <section className="wrap pad checkout-preview">
      <p className="tag">Preview</p>
      <h1>Checkout preview</h1>
      <p className="lede">
        Once the store is connected, this step is Square’s secure payment page. For now it shows the order the
        server priced, and nothing is charged.
      </p>
      {order.state === "loading" && <p>Loading your order…</p>}
      {order.state === "failed" && (
        <p>
          We couldn’t find that order. <Link to="/cart">Back to your cart</Link>
        </p>
      )}
      {order.state === "ready" && (
        <div className="preview-order">
          <ul className="cart-lines">
            {order.value.lines.map((l) => (
              <li key={l.productId}>
                <div>
                  <strong>{l.name}</strong>
                  <span className="each">
                    {l.qty} × {formatCents(l.priceCents)}
                  </span>
                </div>
                <span className="line-total">{formatCents(l.priceCents * l.qty)}</span>
              </li>
            ))}
          </ul>
          <p className="subtotal">
            <span>Subtotal</span>
            <strong>{formatCents(order.value.subtotalCents)}</strong>
          </p>
          {order.value.status === "paid" ? (
            <p>This order is already paid.</p>
          ) : (
            <div className="row-actions">
              <button type="button" className="btn red" onClick={pay} disabled={paying}>
                {paying ? "Paying…" : "Pay (preview, no charge)"}
              </button>
              <Link className="btn" to="/cart">
                Back to cart
              </Link>
            </div>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
