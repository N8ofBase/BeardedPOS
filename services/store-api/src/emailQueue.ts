// Real bulk email for the hosted register. The register's Email page queues one send per customer
// (services/api handlers/email.ts); every minute EventBridge wakes this Lambda with
// { job: "email-queue" }, and runEmailQueue() releases scheduled emails that are due and sends the
// queue through Amazon SES in small batches, staying under the account's sending rate. Each batch
// commits on its own, so a cut-off run never sends an email twice. The unsubscribe link in every
// email lands on beardedboardgames.com/unsubscribe, and mail apps' own button posts to /api/unsubscribe.
import type { Kysely } from "kysely";
import { AppError, type RenderedEmail } from "@bearded/core";
import {
  invokePublic,
  releaseDueCampaigns,
  sendQueued,
  sesSendEmailInput,
  type Mailer,
  type UnsubscribeInfo,
} from "@bearded/api";
import { sql } from "kysely";
import { withBusiness, type DB } from "@bearded/db";
import type { StoreCtx } from "./context.ts";
import { HttpError, ok, type ApiRequest, type ApiResponse } from "./http.ts";

/** The event the every-minute schedule sends. */
export const EMAIL_JOB = "email-queue";
/** A run stops starting batches after this long, well inside the Lambda's 29 seconds. */
export const EMAIL_RUN_MS = 20_000;
/** SES's own limit is higher (14 a second for a new account); this leaves room for receipts and codes. */
export const DEFAULT_PER_SECOND = 10;

export type SesSend = (input: ReturnType<typeof sesSendEmailInput>) => Promise<{ MessageId?: string }>;

/** Sends bulk email through Amazon SES. `send` is the SES call, so tests can pass their own. */
export function sesBulkMailer(opts: {
  siteUrl: string;
  send: SesSend;
  perSecond?: number;
  configurationSet?: string;
}): Mailer {
  return {
    name: "Amazon SES",
    preview: false,
    siteUrl: opts.siteUrl,
    perSecond: opts.perSecond ?? DEFAULT_PER_SECOND,
    async send(email: RenderedEmail, meta) {
      const r = await opts.send(sesSendEmailInput(email, meta, opts.configurationSet));
      if (!r.MessageId) throw new Error("Amazon SES didn't take the email.");
      return { messageId: r.MessageId };
    },
  };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface EmailRun {
  released: number;
  sent: number;
  failed: number;
  left: number;
}

/**
 * One turn of the queue: scheduled emails that are due start going out, then queued emails go in
 * batches of `perSecond`, one batch a second, until none are left or the time is up. Only one run
 * sends at a time (a lock per business), so two overlapping runs can't send the same email.
 */
export async function runEmailQueue(
  pos: Kysely<DB>,
  businessId: string,
  mailer: Mailer,
  opts: { runMs?: number; now?: () => number; sleep?: (ms: number) => Promise<unknown> } = {},
): Promise<EmailRun> {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? wait;
  const stopAt = now() + (opts.runMs ?? EMAIL_RUN_MS);
  const worker = { businessId, staffId: "", role: "owner" as const };
  const { released } = await withBusiness(pos, businessId, (trx) =>
    releaseDueCampaigns.run(trx, worker, undefined),
  );
  const out: EmailRun = { released, sent: 0, failed: 0, left: 0 };
  while (now() < stopAt) {
    const started = now();
    const r = await withBusiness(pos, businessId, async (trx) => {
      const { rows } = await sql<{ got: boolean }>`
        SELECT pg_try_advisory_xact_lock(hashtext(${`bulk-email:${businessId}`})) AS got`.execute(trx);
      return rows[0]?.got ? sendQueued(trx, mailer, businessId, mailer.perSecond) : null;
    });
    if (!r) break; // another run is sending
    out.sent += r.sent;
    out.failed += r.failed;
    out.left = r.left;
    if (r.left === 0 || r.sent + r.failed === 0) break;
    const rest = 1000 - (now() - started);
    if (rest > 0) await sleep(rest);
  }
  return out;
}

/** The scheduled job: sends the register's queued email, when the register is hosted here. */
export async function emailJob(ctx: StoreCtx, mailer: Mailer): Promise<EmailRun | null> {
  if (!ctx.pos) return null;
  const r = await runEmailQueue(ctx.pos, ctx.config.businessId, mailer);
  if (r.released || r.sent || r.failed) console.log("bulk email", JSON.stringify(r));
  return r;
}

export const UNSUBSCRIBE_PATH = "/api/unsubscribe";
const BAD_LINK = "That unsubscribe link isn't right. Reply to the email and we'll take you off the list.";

/**
 * The unsubscribe link from every bulk email (no sign-in: the random token is the key, and it can
 * only turn email off). GET says whose address it is; POST turns email off, from our page or from
 * a mail app's one-click button, which posts a form body we don't need to read.
 */
export async function unsubscribeRoute(ctx: StoreCtx, req: ApiRequest): Promise<ApiResponse> {
  const businessId = req.query.get("b") ?? "";
  const token = req.query.get("t") ?? "";
  if (!ctx.pos || businessId !== ctx.config.businessId || !token) throw new HttpError(404, BAD_LINK);
  const caller = { businessId, token: null, demo: false };
  try {
    const info: UnsubscribeInfo =
      req.method === "POST"
        ? await invokePublic(ctx.pos, caller, "unsubscribe", { token })
        : await invokePublic(ctx.pos, caller, "unsubscribeStatus", { token });
    return ok(info);
  } catch (e) {
    if (e instanceof AppError) throw new HttpError(e.code === "not_found" ? 404 : 400, e.message);
    throw e;
  }
}
