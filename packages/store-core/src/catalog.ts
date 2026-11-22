// Turns the Square catalog into the store's products. Square owns names, prices and stock, and
// every Square item with a fixed price shows; listing.ts places items by game and kind.
import {
  extraItems,
  gameItems,
  hiddenItems,
  lowStockAt,
  sellableTypes,
  type ProductKind,
  type StoreItem,
} from "./listing.ts";

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
  /** The item's Square category name (reporting category first), when it has one. */
  category?: string | null;
}

export interface SquareCatalog {
  capturedAt: string;
  locationId: string;
  currency: string;
  items: SquareItem[];
  /**
   * True for the shop's own Square account: every item there shows in the store. The Sandbox demo
   * copies Prism Cortex's account, which also holds N8's other games, so there only listed items show.
   */
  everyItem?: boolean;
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
    ...gameItems.flatMap((g) => g.items.map((i) => ({ ...i, game: g.game }))),
    ...extraItems.map((i) => ({ ...i, game: null })),
  ].map((l) => [matchKey(l.square), l]),
);
const hidden = new Set(hiddenItems.map(matchKey));

/** Lowercase words only: "Mine & Find: Deluxe" → "mine and find deluxe". For matching game names. */
const words = (name: string) =>
  name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Each game's names as words, longest first, so "Fences Roll and Write" wins over "Fences". */
const gameNames = gameItems
  .flatMap((g) =>
    [g.game.replace(/-/g, " "), ...(g.names ?? [])].map((n) => ({ game: g.game, words: words(n) })),
  )
  .sort((a, b) => b.words.length - a.words.length);

const MERCH =
  /\b(shirts?|t shirts?|tees?|onesies?|hoodies?|sweatshirts?|hats?|caps?|beanies?|stickers?|buttons?|pins?|bags?|totes?|mugs?|cups?|socks?|posters?|prints?|patch(es)?|keychains?|apparel|merch(andise)?|clothing|accessor(y|ies)|jewelry)\b/;

/**
 * Where an unlisted Square item goes: onto one of our games when its name starts with the game's
 * name, otherwise by its Square category, then by words in its name. Anything still unknown is merch.
 */
export function placeItem(name: string, category: string | null = null): Listing {
  const w = words(name);
  const own = gameNames.find((g) => w === g.words || w.startsWith(`${g.words} `));
  if (own) {
    const rest = w.slice(own.words.length).trim();
    const kind: ProductKind = MERCH.test(rest)
      ? "merch"
      : /\bprint and play\b|\bpnp\b/.test(w)
        ? "digital"
        : /\b(pre ?order|reservation)\b/.test(w)
          ? "preorder"
          : rest === "" || /^((the )?(board |card )?game|deluxe|edition|.* edition)$/.test(rest)
            ? "game"
            : "expansion";
    return { square: name, kind, game: own.game };
  }
  const c = words(category ?? "");
  if (MERCH.test(c)) return { square: name, kind: "merch", game: null };
  if (/\bexpansions?\b/.test(c)) return { square: name, kind: "expansion", game: null };
  if (/\bgames?\b/.test(c)) return { square: name, kind: "game", game: null };
  if (MERCH.test(w)) return { square: name, kind: "merch", game: null };
  if (/\b(board|card|dice) games?\b/.test(w)) return { square: name, kind: "game", game: null };
  return { square: name, kind: "merch", game: null };
}

/**
 * The products the store sells: every Square item with a fixed price (only the listed ones unless
 * `everyItem`), except hidden ones and donations, gift cards and the like. Listed items come first,
 * in listed order, then the rest by name. Items with several variations become one product per
 * variation. Sold-out items stay, marked.
 */
export function storeProducts(catalog: SquareCatalog): Product[] {
  const order = [...listings.keys()];
  return catalog.items
    .flatMap((item) => {
      const key = matchKey(item.name);
      if (hidden.has(key) || !sellableTypes.includes(item.productType || "REGULAR")) return [];
      if (item.priceCents === null || !Number.isInteger(item.priceCents)) return [];
      const listing =
        listings.get(key) ?? (catalog.everyItem ? placeItem(item.name, item.category ?? null) : null);
      if (!listing) return [];
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
      const rank = order.indexOf(key);
      return [{ product, rank: rank === -1 ? order.length : rank, name: item.name.toLowerCase() }];
    })
    .sort((a, b) => a.rank - b.rank || (a.rank === order.length ? a.name.localeCompare(b.name) : 0))
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
