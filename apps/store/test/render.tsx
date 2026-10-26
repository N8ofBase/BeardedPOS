import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { handle, loadSnapshot, openPglite, SnapshotStore, type StoreCtx } from "@bearded/store-api";
import type { Account } from "@bearded/store-core";
import { App } from "../src/App.tsx";
import { httpStore, StoreContext, type StoreApi } from "../src/api/store.ts";

const snapshot = loadSnapshot();

/** A signed-in Beard Buddy, as the server sends it. */
export const fakeAccount = (over: Partial<Account> = {}): Account => ({
  email: "sam@example.com",
  name: null,
  birthday: null,
  birthdayLocked: false,
  balance: 0,
  held: 0,
  history: [],
  ...over,
});

/** A store with the saved Square catalog where everything else quietly succeeds. */
export function fakeStore(over: Partial<StoreApi> = {}): StoreApi {
  return {
    catalog: async () => snapshot,
    checkout: async () => ({ url: "/thanks?preview=1", orderId: "" }),
    reviews: async () => [],
    submitReview: async () => {},
    track: async () => {},
    orderStatus: async () => ({ status: "paid" }),
    previewOrder: () => Promise.reject(new Error("no server")),
    payPreviewOrder: () => Promise.reject(new Error("no server")),
    staff: {
      requestCode: async () => ({ sent: true }),
      signIn: () => Promise.reject(new Error("no server")),
      me: async () => null,
      signOut: async () => {},
      reviews: async () => [],
      moderate: async () => {},
      stats: () => Promise.reject(new Error("no server")),
      oldSite: async () => [],
      chooseOldSite: () => Promise.reject(new Error("no server")),
      buddies: async () => [],
      buddyHistory: async () => [],
    },
    buddy: {
      requestCode: async () => ({ sent: true }),
      signIn: () => Promise.reject(new Error("no server")),
      account: async () => null,
      save: () => Promise.reject(new Error("no server")),
      signOut: async () => {},
    },
    ...over,
  };
}

/** Renders the whole store at `path` with a fake store api. */
export function renderStore(path = "/", store: Partial<StoreApi> | StoreApi = {}) {
  return render(
    <StoreContext.Provider
      value={"staff" in store && store.staff ? { ...fakeStore(), ...store } : fakeStore(store)}
    >
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </StoreContext.Provider>,
  );
}

export const BUSINESS = "b0a7dbbb-0000-4000-8000-0000000000aa";

/**
 * The real store server on an in-memory database, reached through `fetch` like the browser does,
 * with a cookie jar so staff sign-in works.
 */
export async function realServer() {
  const ctx: StoreCtx = {
    db: await openPglite(),
    square: new SnapshotStore(snapshot),
    mailer: { send: async () => {} },
    config: {
      businessId: BUSINESS,
      staff: ["@beardedboardgames.com"],
      siteUrl: "http://localhost:5174",
      secureCookies: false,
    },
    now: () => new Date(),
  };
  const jar = new Map<string, string>();
  const fetchFn = async (url: string, init: RequestInit = {}) => {
    const u = new URL(url, "http://localhost");
    const headers = Object.fromEntries(
      Object.entries((init.headers as Record<string, string> | undefined) ?? {}).map(([k, v]) => [
        k.toLowerCase(),
        v,
      ]),
    );
    const out = await handle(ctx, {
      method: init.method ?? "GET",
      path: u.pathname,
      query: u.searchParams,
      headers,
      cookies: Object.fromEntries(jar),
      body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
    });
    const cookie = out.headers?.["Set-Cookie"];
    const m = cookie && /^([^=]+)=([^;]*)/.exec(cookie);
    if (m) {
      if (/Max-Age=0/i.test(cookie)) jar.delete(m[1]!);
      else jar.set(m[1]!, m[2]!);
    }
    return new Response(out.body === undefined ? null : JSON.stringify(out.body), { status: out.status });
  };
  return { ctx, store: httpStore(fetchFn), jar };
}
