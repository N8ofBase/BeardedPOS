import type { Kysely } from "kysely";
import type { Ctx } from "@bearded/core";
import {
  invoke,
  invokePublic,
  type HandlerName,
  type InputOf,
  type OutputOf,
  type PublicInput,
  type PublicName,
  type PublicOutput,
} from "@bearded/api";
import type { DB } from "@bearded/db";

/** How screens talk to the back end. Demo mode calls handlers directly; hosted mode (1f) will use HTTPS. */
export interface Api {
  call<N extends HandlerName>(
    name: N,
    ...input: InputOf<N> extends void ? [] : [InputOf<N>]
  ): Promise<OutputOf<N>>;
}

export function createDemoApi(db: Kysely<DB>, ctx: Ctx): Api {
  return {
    call(name, ...input) {
      return invoke(db, ctx, name, input[0] as InputOf<typeof name>);
    },
  };
}

/** The public pages' back end: only the public handlers, as a signed-in customer or nobody. */
export interface PublicApi {
  call<N extends PublicName>(
    name: N,
    ...input: PublicInput<N> extends void ? [] : [PublicInput<N>]
  ): Promise<PublicOutput<N>>;
}

export function createDemoPublicApi(
  db: Kysely<DB>,
  businessId: string,
  token: () => string | null,
): PublicApi {
  return {
    call(name, ...input) {
      return invokePublic(
        db,
        { businessId, token: token(), demo: true },
        name,
        input[0] as PublicInput<typeof name>,
      );
    },
  };
}
