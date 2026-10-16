import type { Kysely } from "kysely";
import { assertCan, AppError, type Ctx } from "@pet-pos/core";
import { withBusiness, type DB } from "@pet-pos/db";
import type { Handler } from "./handler.ts";
import { listPrograms, saveProgram } from "./handlers/astro.ts";
import {
  archiveProduct,
  findByCode,
  getProduct,
  listProducts,
  receiveStock,
  saveCounts,
  saveProduct,
} from "./handlers/inventory.ts";
import {
  deleteCustomer,
  deletePreview,
  getCustomer,
  lookupByPhone,
  saveCustomer,
  savePetDetails,
  saveVaccinations,
  searchCustomers,
} from "./handlers/customers.ts";
import { listStaff, me } from "./handlers/staff.ts";

/** Every handler by name. The demo transport and (in 1f) the Lambda adapters both dispatch through here. */
export const handlers = {
  me,
  listStaff,
  listProducts,
  findByCode,
  getProduct,
  saveProduct,
  archiveProduct,
  receiveStock,
  saveCounts,
  listPrograms,
  saveProgram,
  searchCustomers,
  lookupByPhone,
  getCustomer,
  saveCustomer,
  savePetDetails,
  saveVaccinations,
  deletePreview,
  deleteCustomer,
};

export type Handlers = typeof handlers;
export type HandlerName = keyof Handlers;
export type InputOf<N extends HandlerName> = Handlers[N] extends Handler<infer I, unknown> ? I : never;
export type OutputOf<N extends HandlerName> = Handlers[N] extends Handler<unknown, infer O> ? O : never;

/** Checks permission, then runs the handler in a transaction scoped to the caller's business. */
export async function invoke<N extends HandlerName>(
  db: Kysely<DB>,
  ctx: Ctx,
  name: N,
  input: InputOf<N>,
): Promise<OutputOf<N>> {
  const handler = handlers[name] as unknown as Handler<InputOf<N>, OutputOf<N>> | undefined;
  if (!handler) throw new AppError("not_found", `Unknown action: ${String(name)}`);
  if (handler.action) assertCan(ctx.role, handler.action);
  return withBusiness(db, ctx.businessId, (trx) => handler.run(trx, ctx, input));
}
