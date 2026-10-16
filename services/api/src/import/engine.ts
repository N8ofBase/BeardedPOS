// Runs import rows one at a time. Each row has its own savepoint, so a row the
// database refuses becomes a skip instead of failing the whole chunk. Every change
// is recorded in import_changes (when there's a batch) so undo can reverse it.
import { sql, type Transaction } from "kysely";
import { AppError, isUniqueViolation, todayIso, type Ctx, type ImportType } from "@pet-pos/core";
import type { DB } from "@pet-pos/db";
import { programRow, punchRow } from "./astro.ts";
import {
  Changes,
  Skip,
  type ImportResult,
  type Row,
  type RowCtx,
  type RowOutcome,
  type RowResult,
} from "./base.ts";
import { customerRow, petRow } from "./customers.ts";
import { productRow } from "./products.ts";

export type { ImportResult, RowOutcome } from "./base.ts";

const HANDLERS: Record<ImportType, (r: Row, rc: RowCtx) => Promise<RowResult>> = {
  customers: customerRow,
  pets: petRow,
  products: productRow,
  programs: programRow,
  punches: punchRow,
};

/** Plain words for the database refusals a row can hit. */
function refusalReason(err: unknown): string {
  if (err instanceof Skip || err instanceof AppError) return err.message;
  const unique: [string, string][] = [
    ["products_barcode_per_business", "Another product already has that barcode"],
    ["products_sku_per_business", "Another product already has that SKU"],
    ["customers_phone_per_business", "Another customer already has that phone number"],
    ["customers_email_per_business", "Another customer already has that email"],
    ["pets_name_per_customer", "This customer already has a pet with that name"],
    ["astro_programs_name_per_business", "There's already a program with that name"],
  ];
  for (const [constraint, reason] of unique) if (isUniqueViolation(err, constraint)) return reason;
  const msg = (err as { message?: string })?.message ?? String(err);
  return `Couldn't save this row (${msg})`;
}

/**
 * Imports rows of one type. `offset` is how many data rows came before this chunk,
 * so row numbers match the spreadsheet (header is row 1).
 */
export async function runImport(
  trx: Transaction<DB>,
  ctx: Ctx,
  type: ImportType,
  rows: Row[],
  { offset, batchId }: { offset: number; batchId: string | null },
): Promise<ImportResult> {
  const handler = HANDLERS[type];
  if (!handler) throw new AppError("invalid", "Pick what's in the file.");
  const changes = new Changes(trx, ctx.businessId, batchId);
  const today = todayIso();
  const result: ImportResult = {
    rows: rows.length,
    created: 0,
    updated: 0,
    skipped: 0,
    skips: [],
    warnings: [],
    sample: [],
  };

  for (const [i, r] of rows.entries()) {
    const rowNo = offset + i + 2;
    const warnings: string[] = [];
    let outcome: RowOutcome;
    await sql`SAVEPOINT import_row`.execute(trx);
    try {
      const res = await handler(r, { trx, ctx, changes, today, warn: (m) => warnings.push(m) });
      await sql`RELEASE SAVEPOINT import_row`.execute(trx);
      outcome = { row: rowNo, ...res };
      if (res.action === "new") result.created++;
      else result.updated++;
      for (const message of warnings) result.warnings.push({ row: rowNo, message });
    } catch (err) {
      await sql`ROLLBACK TO SAVEPOINT import_row`.execute(trx);
      const reason = refusalReason(err);
      outcome = { row: rowNo, action: "skip", label: rowLabel(r), reason };
      result.skipped++;
      result.skips.push({ row: rowNo, reason });
    }
    if (result.sample.length < 20) result.sample.push(outcome);
  }
  return result;
}

function rowLabel(r: Row): string {
  return (
    r.name ||
    [r.first, r.last].filter(Boolean).join(" ") ||
    r.petName ||
    r.sku ||
    r.program ||
    r.phone ||
    r.email ||
    r.ownerPhone ||
    "(blank row)"
  );
}
