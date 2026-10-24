// Turns the Square catalog into the store's products. Square owns names, prices and stock;
// site.ts decides which Square items appear and which game they belong to.
import { extraItems, games, lowStockAt, type ProductKind, type StoreItem } from "../content/site.ts";

/** One Square item variation, as the store server returns it (and as the offline snapshot saves it). */
export interface SquareItem {
  itemId: string;
  variationId: string;
  name: string;
  variationName: string | null;
  productType: string;
  /** Integer cents. Null for variable-price items, which the store never sells. */
  priceCents: number | null;
  tracksStock: boolean;
  /** Units on hand at the store's Square location; null when Square doesn't track stock for it. */
  stock: number | null;
  imageUrl: string | null;
}

export interface SquareCatalog {
  capturedAt: string;
  locationId: string;
  currency: string;
  items: SquareItem[];
}

export type StockStatus = "in-stock" | "low" | "sold-out" | "untracked";

export interface Product {
  /** The Square item variation id: what checkout sends to Square. */
  id: string;
  itemId: string;
  name: string;
  priceCents: number;
  kind: ProductKind;
  game: string | null;
  stock: number | null;
  stockStatus: StockStatus;
  imageUrl: string | null;
}

/** Square names are matched ignoring case, spacing and dash style, so "5-6" and "5–6" are the same item. */
export const matchKey = (name: string) =>
  name
    .toLowerCase()
    .replace(/[‐-―−]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

export function stockStatus(stock: number | null): StockStatus {
  if (stock === null) return "untracked";
  if (stock <= 0) return "sold-out";
  if (stock <= lowStockAt) return "low";
  return "in-stock";
}

interface Listing extends StoreItem {
  game: string | null;
}

const listings = new Map<string, Listing>(
  [
    ...games.flatMap((g) => g.items.map((i) => ({ ...i, game: g.slug }))),
    ...extraItems.map((i) => ({ ...i, game: null })),
  ].map((l) => [matchKey(l.square), l]),
);

/**
 * The products the store sells: only Square items listed in site.ts, with a fixed price, in the
 * order they're listed. Items with several variations become one product per variation.
 */
export function storeProducts(catalog: SquareCatalog): Product[] {
  const order = [...listings.keys()];
  return catalog.items
    .flatMap((item) => {
      const key = matchKey(item.name);
      const listing = listings.get(key);
      if (!listing || item.priceCents === null || !Number.isInteger(item.priceCents)) return [];
      const several = catalog.items.filter((i) => i.itemId === item.itemId).length > 1;
      const name = listing.name ?? item.name;
      const stock = item.tracksStock ? item.stock : null;
      const product: Product = {
        id: item.variationId,
        itemId: item.itemId,
        name: several && item.variationName ? `${name} (${item.variationName})` : name,
        priceCents: item.priceCents,
        kind: listing.kind,
        game: listing.game,
        stock,
        stockStatus: stockStatus(stock),
        imageUrl: item.imageUrl,
      };
      return [{ product, rank: order.indexOf(key) }];
    })
    .sort((a, b) => a.rank - b.rank)
    .map((r) => r.product);
}

/** Listed items that Square doesn't have (yet), so staff can see what's missing. */
export function missingItems(catalog: SquareCatalog): string[] {
  const have = new Set(catalog.items.map((i) => matchKey(i.name)));
  return [...listings.values()].filter((l) => !have.has(matchKey(l.square))).map((l) => l.square);
}

const dollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** $25.00 → "$25", $8.50 → "$8.50". Money stays in integer cents everywhere else. */
export function formatCents(cents: number): string {
  const text = dollars.format(cents / 100);
  return cents % 100 === 0 ? text.replace(/\.00$/, "") : text;
}

export function stockLabel(p: Product): string | null {
  if (p.kind === "preorder") return "Pre-order";
  if (p.kind === "digital") return "Digital download";
  switch (p.stockStatus) {
    case "sold-out":
      return "Sold out";
    case "low":
      return `Only ${p.stock} left`;
    default:
      return null;
  }
}
