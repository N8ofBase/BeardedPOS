import { CartContents } from "../components/CartContents.tsx";

export function CartPage() {
  return (
    <section className="wrap pad cart-page">
      <h1>Your cart</h1>
      <CartContents />
    </section>
  );
}
