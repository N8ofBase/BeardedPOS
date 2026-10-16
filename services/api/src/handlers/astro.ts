import { sql } from "kysely";
import { AppError, isUniqueViolation } from "@pet-pos/core";
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
