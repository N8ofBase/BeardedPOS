// Who the shopper is for Beard Buddy: signed in (with their Bucks), a guest, or still checking.
// The header, cart, account page and thank-you page all read it from here.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Account } from "@bearded/store-core";
import { useStore, type Loadable } from "../api/store.ts";

interface BuddyState {
  account: Loadable<Account | null>;
  /** After a sign-in or a save: the server's latest account. */
  set(account: Account | null): void;
  /** Asks the server again, e.g. once a paid order has earned Bucks. */
  refresh(): void;
  signOut(): Promise<void>;
}

const BuddyContext = createContext<BuddyState>({
  account: { state: "ready", value: null },
  set: () => {},
  refresh: () => {},
  signOut: async () => {},
});

export function BuddyProvider({ children }: { children: ReactNode }) {
  const store = useStore();
  const [account, setAccount] = useState<Loadable<Account | null>>({ state: "loading" });
  const [asks, setAsks] = useState(0);

  useEffect(() => {
    let live = true;
    store.buddy.account().then(
      (value) => live && setAccount({ state: "ready", value }),
      // Can't tell: treat the shopper as a guest, so checkout still works.
      () => live && setAccount({ state: "failed" }),
    );
    return () => {
      live = false;
    };
  }, [store, asks]);

  const set = useCallback((value: Account | null) => setAccount({ state: "ready", value }), []);
  const refresh = useCallback(() => setAsks((n) => n + 1), []);
  const signOut = useCallback(async () => {
    await store.buddy.signOut().catch(() => {});
    setAccount({ state: "ready", value: null });
  }, [store]);

  const value = useMemo(() => ({ account, set, refresh, signOut }), [account, set, refresh, signOut]);
  return <BuddyContext.Provider value={value}>{children}</BuddyContext.Provider>;
}

export const useBuddy = () => useContext(BuddyContext);

/** The signed-in account, or null for a guest (or while it's unknown). */
export function useSignedIn(): Account | null {
  const { account } = useBuddy();
  return account.state === "ready" ? account.value : null;
}
