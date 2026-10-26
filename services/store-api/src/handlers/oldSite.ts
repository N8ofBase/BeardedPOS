// Behind the Beard's "Old site" tab: what the team wants to keep from the Squarespace site.
import {
  NOTE_MAX,
  OLD_SITE_DECISIONS,
  oldSiteItemIds,
  type OldSiteChoice,
  type OldSiteDecision,
} from "@bearded/store-core";
import type { StoreCtx } from "../context.ts";
import { withBusiness } from "../db.ts";
import { asObject, HttpError, ok, type ApiRequest, type ApiResponse } from "../http.ts";
import { requireStaff } from "./staff.ts";

interface ChoiceRow {
  item_id: string;
  decision: OldSiteDecision;
  note: string;
  decided_by: string;
  updated_at: Date;
}

const toChoice = (r: ChoiceRow): OldSiteChoice => ({
  itemId: r.item_id,
  decision: r.decision,
  note: r.note,
  by: r.decided_by,
  at: r.updated_at.toISOString(),
});

export async function oldSiteChoices(ctx: StoreCtx, req: ApiRequest): Promise<ApiResponse> {
  await requireStaff(ctx, req);
  const rows = await withBusiness(
    ctx.db,
    ctx.config.businessId,
    async (sql) =>
      (
        await sql.query<ChoiceRow>(
          "SELECT item_id, decision, note, decided_by, updated_at FROM store_old_site_choices",
        )
      ).rows,
  );
  return ok(rows.map(toChoice));
}

/** Records the team's call on one item. A newer call replaces the older one. */
export async function chooseOldSite(ctx: StoreCtx, req: ApiRequest, itemId: string): Promise<ApiResponse> {
  const email = await requireStaff(ctx, req);
  const body = asObject(req.body);
  const decision = body.decision as OldSiteDecision;
  if (!oldSiteItemIds.has(itemId)) throw new HttpError(404, "That item isn’t on the list.");
  if (!OLD_SITE_DECISIONS.includes(decision)) throw new HttpError(400, "Pick keep, update or drop.");
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (note.length > NOTE_MAX) throw new HttpError(400, `Keep the note under ${NOTE_MAX} characters.`);
  const row = await withBusiness(
    ctx.db,
    ctx.config.businessId,
    async (sql) =>
      (
        await sql.query<ChoiceRow>(
          `INSERT INTO store_old_site_choices (business_id, item_id, decision, note, decided_by)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (business_id, item_id) DO UPDATE
             SET decision = EXCLUDED.decision, note = EXCLUDED.note, decided_by = EXCLUDED.decided_by
           RETURNING item_id, decision, note, decided_by, updated_at`,
          [ctx.config.businessId, itemId, decision, note, email],
        )
      ).rows[0]!,
  );
  return ok(toChoice(row));
}
