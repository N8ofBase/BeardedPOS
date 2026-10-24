import { sql, type Transaction } from "kysely";
import { AppError, IMPORT_TYPE_KEYS, type ImportType } from "@bearded/core";
import type { DB } from "@bearded/db";
import { defineHandler } from "../handler.ts";
import { runImport, type ImportResult } from "../import/engine.ts";
import { undoBatch, type UndoResult } from "../import/undo.ts";

export const CHUNK_SIZE = 500;
export const MAX_ROWS = 20_000;

type Rows = Record<string, string>[];

function checkType(type: string): asserts type is ImportType {
  if (!(IMPORT_TYPE_KEYS as readonly string[]).includes(type))
    throw new AppError("invalid", "Pick what's in the file.");
}

function checkRows(rows: Rows, max: number): void {
  if (!Array.isArray(rows) || rows.length === 0)
    throw new AppError("invalid", "The file has no rows to import.");
  if (rows.length > max)
    throw new AppError(
      "invalid",
      `Files can have up to ${MAX_ROWS.toLocaleString("en-US")} rows. Split this one up.`,
    );
}

/**
 * Runs the real import inside a savepoint and rolls it back, so what the preview
 * says is exactly what Import will do. Nothing is saved.
 */
export const previewImport = defineHandler<{ type: ImportType; rows: Rows }, ImportResult>({
  action: "import.run",
  async run(trx, ctx, { type, rows }) {
    checkType(type);
    checkRows(rows, MAX_ROWS);
    await sql`SAVEPOINT import_preview`.execute(trx);
    try {
      return await runImport(trx, ctx, type, rows, { offset: 0, batchId: null });
    } finally {
      await sql`ROLLBACK TO SAVEPOINT import_preview`.execute(trx);
    }
  },
});

export const startImport = defineHandler<
  { type: ImportType; fileName: string; totalRows: number },
  { batchId: string }
>({
  action: "import.run",
  async run(trx, ctx, { type, fileName, totalRows }) {
    checkType(type);
    if (!Number.isInteger(totalRows) || totalRows < 1 || totalRows > MAX_ROWS)
      throw new AppError("invalid", "The file has no rows to import.");
    const row = await trx
      .insertInto("import_batches")
      .values({
        business_id: ctx.businessId,
        type,
        file_name: fileName.trim().slice(0, 200) || "import.csv",
        staff_id: ctx.staffId,
        total_rows: totalRows,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    return { batchId: row.id };
  },
});

/** One chunk of up to 500 rows, saved in its own transaction. */
export const importChunk = defineHandler<{ batchId: string; offset: number; rows: Rows }, ImportResult>({
  action: "import.run",
  async run(trx, ctx, { batchId, offset, rows }) {
    checkRows(rows, CHUNK_SIZE);
    const batch = await trx
      .selectFrom("import_batches")
      .select(["type", "status"])
      .where("id", "=", batchId)
      .executeTakeFirst();
    if (!batch) throw new AppError("not_found", "That import doesn't exist.");
    if (batch.status !== "running") throw new AppError("conflict", "This import has already finished.");
    const res = await runImport(trx, ctx, batch.type, rows, { offset, batchId });
    await trx
      .updateTable("import_batches")
      .set((eb) => ({
        created: eb("created", "+", res.created),
        updated: eb("updated", "+", res.updated),
        skipped: eb("skipped", "+", res.skipped),
      }))
      .where("id", "=", batchId)
      .execute();
    return res;
  },
});

export interface ImportBatchRow {
  id: string;
  type: ImportType;
  fileName: string;
  staffName: string | null;
  status: "running" | "done" | "undone";
  totalRows: number;
  created: number;
  updated: number;
  skipped: number;
  createdAt: Date;
  undoneAt: Date | null;
}

function batchQuery(trx: Transaction<DB>) {
  return trx
    .selectFrom("import_batches as b")
    .leftJoin("staff as s", "s.id", "b.staff_id")
    .select([
      "b.id",
      "b.type",
      "b.file_name as fileName",
      "s.name as staffName",
      "b.status",
      "b.total_rows as totalRows",
      "b.created",
      "b.updated",
      "b.skipped",
      "b.created_at as createdAt",
      "b.undone_at as undoneAt",
    ]);
}

export const finishImport = defineHandler<{ batchId: string }, ImportBatchRow>({
  action: "import.run",
  async run(trx, _ctx, { batchId }) {
    const res = await trx
      .updateTable("import_batches")
      .set({ status: "done", finished_at: new Date() })
      .where("id", "=", batchId)
      .where("status", "=", "running")
      .executeTakeFirst();
    if (res.numUpdatedRows === 0n) throw new AppError("conflict", "This import isn't running.");
    return batchQuery(trx).where("b.id", "=", batchId).executeTakeFirstOrThrow();
  },
});

export const listImports = defineHandler<void, ImportBatchRow[]>({
  action: "import.run",
  async run(trx) {
    return batchQuery(trx).orderBy("b.created_at", "desc").limit(50).execute();
  },
});

/** What undo would remove, for the typed confirmation. */
export const undoPreview = defineHandler<
  { batchId: string },
  { creates: Record<string, number>; updates: number }
>({
  action: "import.run",
  async run(trx, _ctx, { batchId }) {
    const rows = await trx
      .selectFrom("import_changes")
      .select(["entity", "op", sql<number>`count(*)::int`.as("n")])
      .where("batch_id", "=", batchId)
      .groupBy(["entity", "op"])
      .execute();
    const creates: Record<string, number> = {};
    let updates = 0;
    for (const r of rows) {
      if (r.op === "created") creates[r.entity] = r.n;
      else updates += r.n;
    }
    return { creates, updates };
  },
});

export const undoImport = defineHandler<{ batchId: string }, UndoResult>({
  action: "import.run",
  async run(trx, ctx, { batchId }) {
    return undoBatch(trx, ctx, batchId);
  },
});
