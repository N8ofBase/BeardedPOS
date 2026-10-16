import type { Kysely } from "kysely";
import type { Ctx } from "@pet-pos/core";
import { invoke, type HandlerName, type InputOf, type OutputOf } from "@pet-pos/api";
import type { DB } from "@pet-pos/db";

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
