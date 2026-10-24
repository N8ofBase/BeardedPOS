export { handlers, invoke, type HandlerName, type InputOf, type OutputOf } from "./registry.ts";
export { defineHandler, type Handler } from "./handler.ts";
export type { Me, StaffInput, StaffListItem } from "./handlers/staff.ts";
export { MAX_LOGO_CHARS, type SettingsInput, type StoreSettings } from "./handlers/settings.ts";
export type { DemoCounts } from "./handlers/demo.ts";
export type {
  CountLine,
  CountResult,
  ListProductsInput,
  MoveRow,
  ProductRow,
  SaveProductInput,
} from "./handlers/inventory.ts";
export type { AstroQueueRow, ProgramRow, SaveProgramInput } from "./handlers/astro.ts";
export type {
  AstroEffect,
  RefundInput,
  RefundPlan,
  RefundResult,
  RefundSaleInput,
  RefundableLineView,
} from "./handlers/refunds.ts";
export type { GameProfitRow, ProfitReport } from "./handlers/profit.ts";
export type { SendReceiptInput, SentReceipt } from "./handlers/receipts.ts";
export type {
  DrawerCountInput,
  DrawerCountResult,
  DrawerCountRow,
  DrawerSummary,
} from "./handlers/drawer.ts";
export type { CustomerHistory, HistoryOrder } from "./handlers/history.ts";
export type { MoneyTotals } from "./handlers/totals.ts";
export { MAX_ASTRO_ATTEMPTS, processAstroQueue, type SendSummary } from "./astro/sender.ts";
export { CHUNK_SIZE, MAX_ROWS, type ImportBatchRow } from "./handlers/import.ts";
export type { ImportResult, RowOutcome } from "./import/engine.ts";
export type { UndoResult } from "./import/undo.ts";
export type {
  CustomerCard,
  CustomerProfile,
  DeletePreview,
  PunchCard,
  TagChip,
} from "./handlers/customers.ts";
export {
  recordStoreContact,
  sqlClient,
  VIP_TAG,
  type CustomerProfit,
  type FollowUpRow,
  type SqlClient,
  type StoreContact,
  type TagRow,
  type TimelineEntry,
  type TimelineKind,
} from "./handlers/crm.ts";
export {
  deliverBatch,
  queueCampaign,
  recordSesEvent,
  type AudienceCount,
  type CampaignDetail,
  type CampaignEmailRow,
  type CampaignInput,
  type CampaignRow,
  type EmailSetup,
  type SendResult,
  type SesEvent,
  type UnsubscribeInfo,
} from "./handlers/email.ts";
export { mailer, PreviewMailer, sesSendEmailInput, type Mailer } from "./email/mailer.ts";
export type { DiscountInput, DiscountRow } from "./handlers/discounts.ts";
export type {
  CheckoutResult,
  PaymentResult,
  Receipt,
  RegisterCustomer,
  SaleListRow,
  SalesDay,
  TicketInput,
} from "./handlers/register.ts";
export {
  invokePublic,
  type PublicCaller,
  type PublicInput,
  type PublicName,
  type PublicOutput,
} from "./public/registry.ts";
export type { CodeSent, MyAccount, StoreInfo, VerifyResult } from "./public/account.ts";
