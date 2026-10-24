import type { Kysely } from "kysely";
import { assertCan, AppError, type Ctx } from "@pet-pos/core";
import { withBusiness, type DB } from "@pet-pos/db";
import type { Handler } from "./handler.ts";
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
  searchCustomers,
} from "./handlers/customers.ts";
import {
  finishImport,
  importChunk,
  listImports,
  previewImport,
  startImport,
  undoImport,
  undoPreview,
} from "./handlers/import.ts";
import { demoDataPreview, removeDemoData } from "./handlers/demo.ts";
import { drawerSummary, listDrawerCounts, saveDrawerCount } from "./handlers/drawer.ts";
import { customerHistory } from "./handlers/history.ts";
import { deleteDiscount, listDiscounts, saveDiscount } from "./handlers/discounts.ts";
import {
  cancelSale,
  getSale,
  listSales,
  payCash,
  registerCustomer,
  simulateTerminalResult,
  startCardPayment,
  startCheckout,
} from "./handlers/register.ts";
import { profitByGame } from "./handlers/profit.ts";
import { sendReceipt } from "./handlers/receipts.ts";
import { refundPreview, refundSale } from "./handlers/refunds.ts";
import { getSettings, updateSettings } from "./handlers/settings.ts";
import { addStaff, listStaff, me, updateStaff } from "./handlers/staff.ts";

/** Every handler by name. The demo transport and (in 1f) the Lambda adapters both dispatch through here. */
export const handlers = {
  me,
  listStaff,
  addStaff,
  updateStaff,
  getSettings,
  updateSettings,
  demoDataPreview,
  removeDemoData,
  listProducts,
  findByCode,
  getProduct,
  saveProduct,
  archiveProduct,
  receiveStock,
  saveCounts,
  searchCustomers,
  lookupByPhone,
  getCustomer,
  saveCustomer,
  deletePreview,
  deleteCustomer,
  previewImport,
  startImport,
  importChunk,
  finishImport,
  listImports,
  undoPreview,
  undoImport,
  listDiscounts,
  saveDiscount,
  deleteDiscount,
  registerCustomer,
  startCheckout,
  payCash,
  startCardPayment,
  simulateTerminalResult,
  cancelSale,
  getSale,
  listSales,
  profitByGame,
  refundPreview,
  refundSale,
  sendReceipt,
  drawerSummary,
  saveDrawerCount,
  listDrawerCounts,
  customerHistory,
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
