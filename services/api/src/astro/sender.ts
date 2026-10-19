// Sends pending Astro queue rows through AstroClient. With today's not-connected
// client it changes nothing: rows stay pending for staff to enter by hand. Once
// Astro issues credentials (Phase 5) an SQS worker runs this for each business.
import type { Transaction } from "kysely";
import {
  astroClient as defaultClient,
  type AstroClient,
  type AstroRefundPayload,
  type AstroSalePayload,
} from "@pet-pos/core";
import type { DB } from "@pet-pos/db";

/** After this many failed sends a row is marked failed and shown on the Astro screen. */
export const MAX_ASTRO_ATTEMPTS = 5;

export interface SendSummary {
  sent: number;
  failed: number;
  waiting: number;
}

/** Runs inside withBusiness, so it only sees one business's rows. */
export async function processAstroQueue(
  trx: Transaction<DB>,
  client: AstroClient = defaultClient,
  limit = 50,
): Promise<SendSummary> {
  const summary: SendSummary = { sent: 0, failed: 0, waiting: 0 };
  if (!client.connected) return summary;
  const rows = await trx
    .selectFrom("astro_queue")
    .select(["id", "kind", "payload", "attempts"])
    .where("status", "=", "pending")
    .orderBy("created_at")
    .limit(limit)
    .forUpdate()
    .skipLocked()
    .execute();
  for (const r of rows) {
    try {
      const res =
        r.kind === "refund"
          ? await client.sendRefund(r.payload as unknown as AstroRefundPayload)
          : await client.sendSale(r.payload as unknown as AstroSalePayload);
      if (res.sent) {
        await trx
          .updateTable("astro_queue")
          .set({ status: "sent", error: null })
          .where("id", "=", r.id)
          .execute();
        summary.sent++;
      } else {
        summary.waiting++;
      }
    } catch (err) {
      const attempts = r.attempts + 1;
      const failed = attempts >= MAX_ASTRO_ATTEMPTS;
      await trx
        .updateTable("astro_queue")
        .set({
          attempts,
          error: (err instanceof Error ? err.message : String(err)).slice(0, 500),
          status: failed ? "failed" : "pending",
        })
        .where("id", "=", r.id)
        .execute();
      if (failed) summary.failed++;
      else summary.waiting++;
    }
  }
  return summary;
}
