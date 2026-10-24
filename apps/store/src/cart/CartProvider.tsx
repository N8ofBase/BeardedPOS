import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Product } from "../catalog/catalog.ts";
import { useProducts } from "../api/data.tsx";
import { readKey, writeKey } from "../storage.ts";
import {
  addToCart,
  parseCart,
  removeFromCart,
  setQty,
  summarize,
  type CartLine,
  type CartSummary,
} from "./cart.ts";

export const CART_KEY = "bbg.cart";

interface CartValue {
  lines: CartLine[];
  /** Null until the catalog loads. */
  summary: CartSummary | null;
  isOpen: boolean;
  open(): void;
  close(): void;
  add(p: Product, qty?: number): void;
  setQty(p: Product, qty: number): void;
  remove(productId: string): void;
  clear(): void;
}

const CartContext = createContext<CartValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const products = useProducts();
  const [lines, setLines] = useState<CartLine[]>(() => parseCart(readKey("local", CART_KEY)));
  const [isOpen, setOpen] = useState(false);

  useEffect(() => writeKey("local", CART_KEY, lines.length ? JSON.stringify(lines) : null), [lines]);

  const summary = useMemo(
    () => (products.state === "ready" ? summarize(lines, products.value) : null),
    [lines, products],
  );

  const open = useCallback(() => setOpen(true), []);
  const close = useCallback(() => setOpen(false), []);
  const clear = useCallback(() => setLines([]), []);

  const value: CartValue = {
    lines,
    summary,
    isOpen,
    open,
    close,
    add: (p, qty = 1) => {
      setLines((l) => addToCart(l, p, qty));
      setOpen(true);
    },
    setQty: (p, qty) => setLines((l) => setQty(l, p, qty)),
    remove: (id) => setLines((l) => removeFromCart(l, id)),
    clear,
  };
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartValue {
  const cart = useContext(CartContext);
  if (!cart) throw new Error("useCart needs a CartProvider");
  return cart;
}
