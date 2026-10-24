import { useEffect } from "react";
import { Link, useSearchParams } from "react-router";
import { useCart } from "../cart/CartProvider.tsx";

/** "BBG-" and the start of the order id: enough for a shopper to quote, and for staff to find it. */
export const orderNumber = (id: string) => `BBG-${id.slice(0, 8).toUpperCase()}`;

/** Where Square sends shoppers after paying. */
export function ThanksPage() {
  const [params] = useSearchParams();
  const { clear } = useCart();
  const preview = params.get("preview") === "1";
  const order = params.get("order");
  useEffect(() => clear(), [clear]);
  return (
    <section className="wrap pad thanks">
      <h1>Thanks for your order!</h1>
      {order && /^[0-9a-f-]{36}$/i.test(order) && (
        <p className="order-number">
          Order number <strong>{orderNumber(order)}</strong>
        </p>
      )}
      {preview ? (
        <p className="lede">
          This is a preview of the store, so no payment was taken. Once Square is connected, Square emails
          your receipt here.
        </p>
      ) : (
        <p className="lede">
          Square has emailed your receipt. We’ll email you again when your order ships or is ready for pickup.
        </p>
      )}
      <Link className="btn go" to="/#games">
        Back to the games
      </Link>
    </section>
  );
}
