// Loads the catalog and approved reviews once per visit and shares them with every screen.
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { storeProducts, type Product } from "../catalog/catalog.ts";
import type { Review } from "../reviews/reviews.ts";
import { useStore, type Loadable } from "./store.ts";

const ProductsContext = createContext<Loadable<Product[]>>({ state: "loading" });
const ReviewsContext = createContext<Loadable<Review[]>>({ state: "loading" });

function useLoad<T>(load: () => Promise<T>): Loadable<T> {
  const [result, setResult] = useState<Loadable<T>>({ state: "loading" });
  useEffect(() => {
    let live = true;
    load().then(
      (value) => live && setResult({ state: "ready", value }),
      () => live && setResult({ state: "failed" }),
    );
    return () => {
      live = false;
    };
  }, [load]);
  return result;
}

export function DataProvider({ children }: { children: ReactNode }) {
  const store = useStore();
  const [loadProducts] = useState(() => () => store.catalog().then(storeProducts));
  const [loadReviews] = useState(() => () => store.reviews());
  const products = useLoad(loadProducts);
  const reviews = useLoad(loadReviews);
  return (
    <ProductsContext.Provider value={products}>
      <ReviewsContext.Provider value={reviews}>{children}</ReviewsContext.Provider>
    </ProductsContext.Provider>
  );
}

export const useProducts = () => useContext(ProductsContext);
export const useReviews = () => useContext(ReviewsContext);

/** Approved reviews for one game (or all), or an empty list while loading or if loading failed. */
export function useReviewsFor(game?: string): Review[] {
  const reviews = useReviews();
  if (reviews.state !== "ready") return [];
  return game ? reviews.value.filter((r) => r.game === game) : reviews.value;
}
