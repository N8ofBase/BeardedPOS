// The only way the store's screens reach data. Offline for now: the catalog comes from the saved
// Square snapshot, signups and reviews go nowhere, and checkout lands on a preview thank-you page.
// The store server (step 3) swaps in a version that calls /api.
import { createContext, useContext } from "react";
import type { SquareCatalog } from "../catalog/catalog.ts";
import snapshot from "../catalog/square-snapshot.json";
import type { CartLine } from "../cart/cart.ts";
import type { Review, ReviewInput } from "../reviews/reviews.ts";

export { looksLikeEmail } from "./email.ts";

export interface StoreApi {
  catalog(): Promise<SquareCatalog>;
  joinVip(email: string): Promise<void>;
  /** Starts checkout for these lines; resolves to the page to send the shopper to (Square's, once live). */
  checkout(lines: CartLine[]): Promise<{ url: string }>;
  /** Approved reviews, newest first. */
  reviews(): Promise<Review[]>;
  /** Sends a review for the team to approve. */
  submitReview(input: ReviewInput): Promise<void>;
}

export const offlineStore: StoreApi = {
  catalog: async () => snapshot as SquareCatalog,
  joinVip: async () => {},
  checkout: async () => ({ url: "/thanks?preview=1" }),
  reviews: async () => [],
  submitReview: async () => {},
};

export const StoreContext = createContext<StoreApi>(offlineStore);
export const useStore = () => useContext(StoreContext);

export type Loadable<T> = { state: "loading" } | { state: "ready"; value: T } | { state: "failed" };
