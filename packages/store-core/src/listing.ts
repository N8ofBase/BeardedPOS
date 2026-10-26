// Which Square items the Bearded store sells, and which game each belongs to. The site and the
// store server both read this, so checkout can only ever sell what the store shows.

export type ProductKind = "game" | "expansion" | "preorder" | "digital" | "merch";

/** A Square item that belongs in the store. `square` is the item's name in Square, which is how we match it. */
export interface StoreItem {
  square: string;
  kind: ProductKind;
  /** Shown instead of the Square name, when the Square name reads badly on a shelf. */
  name?: string;
}

/** Every game on the shelf, in shelf order, with its Square items (none yet for unreleased games). */
export const gameItems: { game: string; items: StoreItem[] }[] = [
  {
    game: "fences",
    items: [
      { square: "Fences", kind: "game" },
      { square: "Fences 5–6 Player Expansion", kind: "expansion" },
      { square: "Fences: The Ranch", kind: "expansion" },
      { square: "Fences: Seasons", kind: "expansion" },
      { square: "Fences Premium Print & Play", kind: "digital" },
    ],
  },
  { game: "locked-out", items: [{ square: "Locked Out", kind: "game" }] },
  { game: "soccer-blocker", items: [] },
  {
    game: "mine-and-find",
    items: [{ square: "Mine Find", kind: "preorder", name: "Mine & Find (Pre-order)" }],
  },
  { game: "pack-lash", items: [{ square: "Pack Lash VIP Reservation", kind: "preorder" }] },
  { game: "fences-roll-and-write", items: [] },
];

/** Square items sold in the store that don't belong to one game. Anything not listed here or on a game stays off the site. */
export const extraItems: StoreItem[] = [
  { square: "Jibe Card Game", kind: "game" },
  { square: "Future Board Gamer Onesie", kind: "merch" },
  { square: "Board Gamer in Training Kids Tee", kind: "merch" },
];

export const gameSlugs = gameItems.map((g) => g.game);

/** "Only N left" shows at or below this count. */
export const lowStockAt = 5;
