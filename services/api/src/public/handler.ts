// Handlers the public pages can reach. They're a separate, small set: the
// staff registry is never reachable from here, and every handler that needs a
// customer gets one only from a valid session token.
import type { Transaction } from "kysely";
import type { DB } from "@pet-pos/db";

export interface PublicCtx {
  businessId: string;
  /** The signed-in customer, or null. */
  customerId: string | null;
  /** Demo mode: codes are shown on screen instead of sent. */
  demo: boolean;
}

export interface PublicHandler<I, O> {
  /** True when the customer must be signed in. */
  signedIn: boolean;
  run(trx: Transaction<DB>, ctx: PublicCtx, input: I): Promise<O>;
}

export function definePublic<I = void, O = unknown>(h: PublicHandler<I, O>): PublicHandler<I, O> {
  return h;
}

/** Signed-in handlers get a ctx whose customerId is never null. */
export type SignedCtx = PublicCtx & { customerId: string };
