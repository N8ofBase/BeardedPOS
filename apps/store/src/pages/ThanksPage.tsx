import { useEffect } from "react";
import { Link, useSearchParams } from "react-router";
import { useCart } from "../cart/CartProvider.tsx";

/** Where Square sends shoppers after paying. */
export function ThanksPage() {
  const [params] = useSearchParams();
  const { clear } = useCart();
  const preview = params.get("preview") === "1";
  useEffect(() => clear(), [clear]);
  return (
    <section className="wrap pad thanks">
      <h1>Thanks for your order!</h1>
      {preview ? (
        <p className="lede">
          This is a preview of the store, so no payment was taken and no order was placed. Once checkout is
          connected, this page shows your order number.
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
