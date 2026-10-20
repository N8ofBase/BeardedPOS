import { sql } from "kysely";
import {
  AppError,
  astroEntryLines,
  can,
  isUniqueViolation,
  type AstroRefundPayload,
  type AstroSalePayload,
} from "@pet-pos/core";
import { defineHandler } from "../handler.ts";
import { requireInt } from "../shared.ts";

export interface ProgramRow {
  id: string;
  name: string;
  brand: string | null;
  buyCount: number;
  rewardText: string;
  productCount: number;
}

export const listPrograms = defineHandler<void, ProgramRow[]>({
  action: "astro.view",
  async run(trx) {
    return trx
      .selectFrom("astro_programs as a")
      .select([
        "a.id",
        "a.name",
        "a.brand",
        "a.buy_count as buyCount",
        "a.reward_text as rewardText",
        sql<number>`(SELECT count(*)::int FROM products p WHERE p.astro_program_id = a.id AND p.active)`.as(
          "productCount",
        ),
      ])
      .where("a.active", "=", true)
      .orderBy("a.name")
      .execute();
  },
});

export interface SaveProgramInput {
  id?: string;
  name: string;
  brand: string | null;
  buyCount: number;
  rewardText: string;
}

export const saveProgram = defineHandler<SaveProgramInput, { id: string }>({
  action: "astro.edit",
  async run(trx, ctx, input) {
    const name = input.name.trim();
    if (!name)
      throw new AppError("invalid", "Program name is required.", { name: "Program name is required." });
    requireInt(input.buyCount, "Buy how many", { min: 2, max: 1000 });
    const values = {
      name,
      brand: input.brand?.trim() || null,
      buy_count: input.buyCount,
      reward_text: input.rewardText.trim() || "Reward",
    };
    try {
      if (input.id) {
        const res = await trx
          .updateTable("astro_programs")
          .set(values)
          .where("id", "=", input.id)
          .executeTakeFirst();
        if (res.numUpdatedRows === 0n) throw new AppError("not_found", "That program doesn't exist.");
        return { id: input.id };
      }
      const row = await trx
        .insertInto("astro_programs")
        .values({ ...values, business_id: ctx.businessId })
        .returning("id")
        .executeTakeFirstOrThrow();
      return { id: row.id };
    } catch (err) {
      if (isUniqueViolation(err, "astro_programs_name_per_business"))
        throw new AppError("conflict", "There's already a program with that name.", {
          name: "There's already a program with that name.",
        });
      throw err;
    }
  },
});

export interface AstroQueueRow {
  id: string;
  kind: "sale" | "refund";
  status: "pending" | "entered" | "sent" | "failed";
  createdAt: Date;
  saleId: string;
  receiptNumber: number;
  customerName: string | null;
  customerPhone: string | null;
  /** What to enter in the portal, written out: "+2 Sample dry food club". */
  entries: string[];
  attempts: number;
  error: string | null;
  enteredByName: string | null;
  enteredAt: Date | null;
}

/** "To enter in Astro": pending (and failed sends), or already entered (and sent). */
export const listAstroQueue = defineHandler<{ status: "pending" | "entered" }, AstroQueueRow[]>({
  action: "astro.view",
  async run(trx, _ctx, { status }) {
    const rows = await trx
      .selectFrom("astro_queue as q")
      .innerJoin("sales as s", "s.id", "q.sale_id")
      .leftJoin("customers as c", "c.id", "s.customer_id")
      .leftJoin("staff as st", "st.id", "q.entered_by")
      .select([
        "q.id",
        "q.kind",
        "q.status",
        "q.created_at",
        "q.sale_id",
        "q.payload",
        "q.attempts",
        "q.error",
        "q.entered_at",
        "s.receipt_number",
        "c.name as customer_name",
        "c.phone as customer_phone",
        "st.name as entered_by_name",
      ])
      .where("q.status", "in", status === "pending" ? ["pending", "failed"] : ["entered", "sent"])
      .orderBy("q.created_at", status === "pending" ? "asc" : "desc")
      .limit(500)
      .execute();
    return rows.map((r) => {
      const payload = r.payload as unknown as AstroSalePayload | AstroRefundPayload;
      return {
        id: r.id,
        kind: r.kind,
        status: r.status,
        createdAt: r.created_at,
        saleId: r.sale_id,
        receiptNumber: r.receipt_number!,
        customerName: r.customer_name ?? payload.customer?.name ?? null,
        customerPhone: r.customer_phone ?? payload.customer?.phone ?? null,
        entries: astroEntryLines(r.kind, payload),
        attempts: r.attempts,
        error: r.error,
        enteredByName: r.entered_by_name,
        enteredAt: r.entered_at,
      };
    });
  },
});

/** Mark entered records who and when. Undo (owner or manager) puts it back to pending. */
export const markAstroEntered = defineHandler<{ id: string; entered: boolean }, void>({
  action: "astro.view",
  async run(trx, ctx, { id, entered }) {
    if (!entered && !can(ctx.role, "astro.edit"))
      throw new AppError("forbidden", "Ask a manager or the owner to undo this.");
    const row = await trx
      .selectFrom("astro_queue")
      .select(["status"])
      .where("id", "=", id)
      .forUpdate()
      .executeTakeFirst();
    if (!row) throw new AppError("not_found", "That queue row doesn't exist.");
    if (entered) {
      if (row.status !== "pending" && row.status !== "failed")
        throw new AppError("conflict", "This one is already entered.");
      await trx
        .updateTable("astro_queue")
        .set({ status: "entered", entered_by: ctx.staffId, entered_at: new Date() })
        .where("id", "=", id)
        .execute();
    } else {
      if (row.status !== "entered") throw new AppError("conflict", "Only entered rows can be undone.");
      await trx
        .updateTable("astro_queue")
        .set({ status: "pending", entered_by: null, entered_at: null })
        .where("id", "=", id)
        .execute();
    }
  },
});
