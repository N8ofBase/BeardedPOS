// Cart math. The cart holds only Square variation ids and quantities; names and prices always come
// from the current catalog, and Square prices the order again at checkout, so the browser never sets a price.
import type { Product } from "../catalog/catalog.ts";

export interface CartLine {
  productId: string;
  qty: number;
}

/** Most of one product a single order can hold, when Square isn't tracking its stock. */
export const MAX_PER_LINE = 10;

/** How many of a product one cart may hold: its stock when Square tracks it, else MAX_PER_LINE. */
export function maxQty(p: Product): number {
  return p.stock === null ? MAX_PER_LINE : Math.max(0, Math.min(p.stock, MAX_PER_LINE));
}

export const canBuy = (p: Product) => maxQty(p) > 0;

const clamp = (qty: number, p: Product) => Math.max(0, Math.min(Math.floor(qty), maxQty(p)));

/** Adds `qty` of a product, capped at what's available. */
export function addToCart(lines: CartLine[], p: Product, qty = 1): CartLine[] {
  const have = lines.find((l) => l.productId === p.id)?.qty ?? 0;
  return setQty(lines, p, have + qty);
}

/** Sets a line's quantity, capped at what's available; zero removes it. */
export function setQty(lines: CartLine[], p: Product, qty: number): CartLine[] {
  const next = Number.isFinite(qty) ? clamp(qty, p) : 0;
  const rest = lines.filter((l) => l.productId !== p.id);
  if (next === 0) return rest;
  const at = lines.findIndex((l) => l.productId === p.id);
  const line = { productId: p.id, qty: next };
  if (at === -1) return [...lines, line];
  return lines.map((l, i) => (i === at ? line : l));
}

export const removeFromCart = (lines: CartLine[], productId: string) =>
  lines.filter((l) => l.productId !== productId);

export interface PricedLine {
  product: Product;
  qty: number;
  lineCents: number;
}

export interface CartSummary {
  lines: PricedLine[];
  /** Units in the cart, for the header badge. */
  count: number;
  subtotalCents: number;
  /** Lines dropped or cut back because the shop no longer has them, in plain words. */
  changes: string[];
}

/**
 * Prices the cart against the current catalog. Items that are gone or sold out drop off, and
 * quantities above current stock are cut back, with a note for each so the shopper isn't surprised.
 */
export function summarize(lines: CartLine[], products: Product[]): CartSummary {
  const byId = new Map(products.map((p) => [p.id, p]));
  const priced: PricedLine[] = [];
  const changes: string[] = [];
  for (const l of lines) {
    const product = byId.get(l.productId);
    if (!product) {
      changes.push("An item in your cart is no longer in the shop, so we took it out.");
      continue;
    }
    const qty = clamp(l.qty, product);
    if (qty === 0) {
      changes.push(`${product.name} sold out, so we took it out of your cart.`);
      continue;
    }
    if (qty < l.qty) changes.push(`Only ${qty} of ${product.name} available, so your cart now has ${qty}.`);
    priced.push({ product, qty, lineCents: product.priceCents * qty });
  }
  return {
    lines: priced,
    count: priced.reduce((n, l) => n + l.qty, 0),
    subtotalCents: priced.reduce((n, l) => n + l.lineCents, 0),
    changes,
  };
}

/** Reads a saved cart, dropping anything that doesn't look like a cart line. */
export function parseCart(raw: string | null): CartLine[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter(
      (l): l is CartLine =>
        typeof l === "object" &&
        l !== null &&
        typeof l.productId === "string" &&
        Number.isInteger(l.qty) &&
        l.qty > 0,
    );
  } catch {
    return [];
  }
}
