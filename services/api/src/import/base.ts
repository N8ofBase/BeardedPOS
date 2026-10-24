// Shared pieces for the import row handlers and the engine.
import type { Transaction } from "kysely";
import type { Ctx } from "@bearded/core";
import type { DB, ImportEntity, ImportOp } from "@bearded/db";

export type Row = Record<string, string>;

export interface RowOutcome {
  row: number;
  action: "new" | "update" | "skip";
  label: string;
  reason?: string;
}

export interface ImportResult {
  rows: number;
  created: number;
  updated: number;
  skipped: number;
  skips: { row: number; reason: string }[];
  warnings: { row: number; message: string }[];
  /** What happens to the first 20 rows, for the preview. */
  sample: RowOutcome[];
}

/** A row that can't be imported, with the reason staff will read. */
export class Skip extends Error {}

/** Records changes to import_changes, so undo can reverse them. Does nothing in a preview. */
export class Changes {
  constructor(
    private readonly trx: Transaction<DB>,
    private readonly businessId: string,
    readonly batchId: string | null,
  ) {}

  async add(
    entity: ImportEntity,
    entityId: string,
    op: ImportOp,
    before: Record<string, unknown> | null,
    after: Record<string, unknown> | null,
  ): Promise<void> {
    if (!this.batchId) return;
    await this.trx
      .insertInto("import_changes")
      .values({
        business_id: this.businessId,
        batch_id: this.batchId,
        entity,
        entity_id: entityId,
        op,
        before: before ? JSON.stringify(before) : null,
        after: after ? JSON.stringify(after) : null,
      })
      .execute();
  }
}

export interface RowCtx {
  trx: Transaction<DB>;
  ctx: Ctx;
  changes: Changes;
  today: string;
  warn(message: string): void;
}

export interface RowResult {
  action: "new" | "update";
  label: string;
}

/** Columns whose values differ: before has the old values, after the new ones. Undefined means "not in the file". */
export function diff(
  current: Record<string, unknown>,
  next: Record<string, unknown>,
): { before: Record<string, unknown>; after: Record<string, unknown> } | null {
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(next)) {
    if (v === undefined) continue;
    if (!sameValue(current[k], v)) {
      before[k] = current[k] ?? null;
      after[k] = v;
    }
  }
  return Object.keys(after).length ? { before, after } : null;
}

export function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

export const text = (s: string | undefined): string | undefined => (s && s.trim() ? s.trim() : undefined);
