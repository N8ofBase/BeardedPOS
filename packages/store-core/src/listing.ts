// How Square items are placed in the Bearded store. Every Square item with a fixed price shows up
// (sold-out ones marked Sold out); the lists below only say which game an item belongs to, what kind
// it is, or a nicer name. The site and the store server both read this, so checkout can only ever
// sell what the store shows.

export type ProductKind = "game" | "expansion" | "preorder" | "digital" | "merch";

/** A Square item that belongs in the store. `square` is the item's name in Square, which is how we match it. */
export interface StoreItem {
  square: string;
  kind: ProductKind;
  /** Shown instead of the Square name, when the Square name reads badly on a shelf. */
  name?: string;
}

/**
 * Every game on the shelf, in shelf order, with its known Square items (none yet for unreleased games).
 * A Square item that isn't listed still lands on a game when its name starts with the game's name
 * ("Fences: Holiday Pack" goes with Fences); `names` are the extra ways Square spells a game.
 */
export const gameItems: { game: string; names?: string[]; items: StoreItem[] }[] = [
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
    names: ["Mine Find", "Mine and Find"],
    items: [{ square: "Mine Find", kind: "preorder", name: "Mine & Find (Pre-order)" }],
  },
  { game: "pack-lash", items: [{ square: "Pack Lash VIP Reservation", kind: "preorder" }] },
  { game: "fences-roll-and-write", items: [] },
];

/** Square items that don't belong to one of our games, placed by hand. Unlisted ones are placed by their Square category and name. */
export const extraItems: StoreItem[] = [
  { square: "Jibe Card Game", kind: "game" },
  { square: "Future Board Gamer Onesie", kind: "merch" },
  { square: "Board Gamer in Training Kids Tee", kind: "merch" },
];

/**
 * Square items that never show online (matched like the names above): things only sold at the
 * counter or at markets. Keep this short: everything else in Square shows.
 */
export const hiddenItems: string[] = ["Soccer Blocker Version Zero Limited Edition"];

/** Square product types the store sells. Donations, gift cards, services and events stay at the counter. */
export const sellableTypes = ["REGULAR", "DIGITAL"];

export const gameSlugs = gameItems.map((g) => g.game);

/** "Only N left" shows at or below this count. */
export const lowStockAt = 5;
