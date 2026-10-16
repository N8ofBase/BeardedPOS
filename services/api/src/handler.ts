import type { Transaction } from "kysely";
import type { Action, Ctx } from "@pet-pos/core";
import type { DB } from "@pet-pos/db";

/**
 * A handler is a plain function: the demo transport calls it directly, and in hosted
 * mode (1f) a Lambda adapter calls the same function. `action` is checked before run;
 * null means any signed-in staff member may call it.
 */
export interface Handler<I, O> {
  action: Action | null;
  run(trx: Transaction<DB>, ctx: Ctx, input: I): Promise<O>;
}

export function defineHandler<I = void, O = unknown>(h: Handler<I, O>): Handler<I, O> {
  return h;
}
