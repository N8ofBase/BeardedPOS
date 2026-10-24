// Store stats: logging events from the site and pruning old ones.
import { cleanBatch } from "@bearded/store-core";
import type { StoreCtx } from "../context.ts";
import { withBusiness } from "../db.ts";
import { HttpError, type ApiRequest, type ApiResponse } from "../http.ts";

export async function logEvents(ctx: StoreCtx, req: ApiRequest): Promise<ApiResponse> {
  const batch = cleanBatch(req.body);
  if (!batch) throw new HttpError(400, "Bad event batch.");
  if (batch.events.length === 0) return { status: 204 };
  const { businessId } = ctx.config;
  await withBusiness(ctx.db, businessId, async (sql) => {
    const values: unknown[] = [];
    const rows = batch.events.map((e, i) => {
      const o = i * 8;
      values.push(
        businessId,
        batch.visitorId,
        e.type,
        e.path,
        e.label ?? null,
        e.productId ?? null,
        e.qty ?? null,
        e.source ?? null,
      );
      return `($${o + 1}, $${o + 2}, $${o + 3}, $${o + 4}, $${o + 5}, $${o + 6}, $${o + 7}, $${o + 8})`;
    });
    await sql.query(
      `INSERT INTO store_events (business_id, visitor_id, type, path, label, product_id, qty, source) VALUES ${rows.join(", ")}`,
      values,
    );
  });
  return { status: 204 };
}

/** Stats keep 13 months. Runs as the table owner, since the app role can't delete events. */
export async function pruneEvents(ctx: StoreCtx): Promise<void> {
  await ctx.db.query(
    "DELETE FROM store_events WHERE business_id = $1 AND at < now() - interval '13 months'",
    [ctx.config.businessId],
  );
}
