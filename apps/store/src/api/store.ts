// The only way the store's screens reach data: the store server's /api. The browser never sees a
// Square token; it sends ids and quantities, and the server prices and checks everything again.
import { createContext, useContext } from "react";
import type {
  CartLine,
  CheckoutResponse,
  CodeResponse,
  EventBatch,
  OrderStatus,
  OrderView,
  Review,
  ReviewAction,
  ReviewInput,
  SquareCatalog,
  StaffMe,
  StaffReview,
  StoreStats,
} from "@bearded/store-core";

export { looksLikeEmail } from "@bearded/store-core";

export interface StaffApi {
  /** Emails a sign-in code (offline, the code comes back to show on screen). */
  requestCode(email: string): Promise<CodeResponse>;
  signIn(email: string, code: string): Promise<StaffMe>;
  /** Who is signed in, or null. */
  me(): Promise<StaffMe | null>;
  signOut(): Promise<void>;
  reviews(status: StaffReview["status"]): Promise<StaffReview[]>;
  moderate(id: string, action: ReviewAction): Promise<void>;
  stats(days: number): Promise<StoreStats>;
}

export interface StoreApi {
  catalog(): Promise<SquareCatalog>;
  joinVip(email: string, source: "band" | "popup"): Promise<void>;
  /** Starts checkout for these lines; resolves to the page to send the shopper to (Square's, once live). */
  checkout(lines: CartLine[], visitorId?: string): Promise<CheckoutResponse>;
  /** Approved reviews, newest first. */
  reviews(): Promise<Review[]>;
  /** Sends a review for the team to approve. */
  submitReview(input: ReviewInput): Promise<void>;
  /** Store stats: anonymous page views, clicks and cart activity. */
  track(batch: EventBatch): Promise<void>;
  /** Offline only: the order behind the checkout preview page, and paying it. */
  /** Whether an order is paid yet: the thank-you page asks after Square sends the shopper back. */
  orderStatus(id: string): Promise<OrderStatus>;
  previewOrder(id: string): Promise<OrderView>;
  payPreviewOrder(id: string): Promise<OrderView>;
  staff: StaffApi;
}

/** An answer from the server that isn't a success. `message` is a sentence the screen can show as is. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export function httpStore(fetchFn: Fetch = (url, init) => fetch(url, init)): StoreApi {
  async function call<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    keepalive = false,
  ): Promise<T> {
    const res = await fetchFn(`/api${path}`, {
      method,
      credentials: "same-origin",
      keepalive,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    const data = text ? (JSON.parse(text) as unknown) : undefined;
    if (!res.ok) {
      const error = (data as { error?: unknown } | undefined)?.error;
      throw new ApiError(res.status, typeof error === "string" ? error : "Something went wrong.");
    }
    return data as T;
  }
  const id = (s: string) => encodeURIComponent(s);
  return {
    catalog: () => call("GET", "/catalog"),
    joinVip: async (email, source) => void (await call("POST", "/vip", { email, source })),
    checkout: (lines, visitorId) => call("POST", "/checkout", { lines, visitorId }),
    reviews: () => call("GET", "/reviews"),
    submitReview: async (input) => void (await call("POST", "/reviews", input)),
    track: async (batch) => void (await call("POST", "/events", batch, true)),
    orderStatus: (orderId) => call("GET", `/orders/${id(orderId)}`),
    previewOrder: (orderId) => call("GET", `/checkout-preview/${id(orderId)}`),
    payPreviewOrder: (orderId) => call("POST", `/checkout-preview/${id(orderId)}/pay`, {}),
    staff: {
      requestCode: (email) => call("POST", "/staff/code", { email }),
      signIn: (email, code) => call("POST", "/staff/session", { email, code }),
      me: () =>
        call<StaffMe>("GET", "/staff/me").catch((e: unknown) => {
          if (e instanceof ApiError && e.status === 401) return null;
          throw e;
        }),
      signOut: async () => void (await call("POST", "/staff/signout", {})),
      reviews: (status) => call("GET", `/staff/reviews?status=${status}`),
      moderate: async (reviewId, action) =>
        void (await call("POST", `/staff/reviews/${id(reviewId)}`, { action })),
      stats: (days) => call("GET", `/staff/stats?days=${days}`),
    },
  };
}

export const StoreContext = createContext<StoreApi>(httpStore());
export const useStore = () => useContext(StoreContext);

export type Loadable<T> = { state: "loading" } | { state: "ready"; value: T } | { state: "failed" };

/** The server's sentence for a failed call, or `fallback` when there isn't one (offline, a crash). */
export const errorText = (e: unknown, fallback: string) =>
  e instanceof ApiError && e.status < 500 ? e.message : fallback;
