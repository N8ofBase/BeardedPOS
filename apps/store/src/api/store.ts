// The only way the store's screens reach data. Offline for now: the catalog comes from the saved
// Square snapshot and signups go nowhere. The store server (step 3) swaps in a version that calls /api.
import { createContext, useContext, useEffect, useState } from "react";
import { storeProducts, type Product, type SquareCatalog } from "../catalog/catalog.ts";
import snapshot from "../catalog/square-snapshot.json";

export interface StoreApi {
  catalog(): Promise<SquareCatalog>;
  joinVip(email: string): Promise<void>;
}

export const offlineStore: StoreApi = {
  catalog: async () => snapshot as SquareCatalog,
  joinVip: async () => {},
};

export const StoreContext = createContext<StoreApi>(offlineStore);
export const useStore = () => useContext(StoreContext);

export type Loadable<T> = { state: "loading" } | { state: "ready"; value: T } | { state: "failed" };

/** The store's products, loaded once per screen. */
export function useProducts(): Loadable<Product[]> {
  const store = useStore();
  const [result, setResult] = useState<Loadable<Product[]>>({ state: "loading" });
  useEffect(() => {
    let live = true;
    store.catalog().then(
      (c) => live && setResult({ state: "ready", value: storeProducts(c) }),
      () => live && setResult({ state: "failed" }),
    );
    return () => {
      live = false;
    };
  }, [store]);
  return result;
}

/** A plain check, so obvious typos are caught before Square sees them. */
export const looksLikeEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim());
