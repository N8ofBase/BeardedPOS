import { useEffect, useRef } from "react";
import { useCart } from "../cart/CartProvider.tsx";
import { CartContents } from "./CartContents.tsx";

export function CartDrawer() {
  const cart = useCart();
  const closeRef = useRef<HTMLButtonElement>(null);

  const { isOpen, close } = cart;
  useEffect(() => {
    if (!isOpen) return;
    const back = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      back?.focus?.();
    };
  }, [isOpen, close]);

  if (!cart.isOpen) return null;
  return (
    <div className="drawer-backdrop" onClick={cart.close}>
      <aside
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cart-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="drawer-head">
          <h2 id="cart-title">Your cart</h2>
          <button ref={closeRef} type="button" className="x" onClick={cart.close} aria-label="Close cart">
            ×
          </button>
        </div>
        <CartContents onLeave={cart.close} />
      </aside>
    </div>
  );
}
