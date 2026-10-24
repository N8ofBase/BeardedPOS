import { sql, type Transaction } from "kysely";
import { AppError, can, isUniqueViolation, type DiscountRule } from "@bearded/core";
import type { DB } from "@bearded/db";
import { defineHandler } from "../handler.ts";
import { audit } from "../shared.ts";

export interface DiscountRow extends DiscountRule {
  code: string | null;
  cashOnly: boolean;
  needsApproval: boolean;
  askNote: boolean;
  active: boolean;
  archived: boolean;
  timesUsed: number;
}

function discountQuery(trx: Transaction<DB>) {
  return trx
    .selectFrom("discounts as d")
    .select([
      "d.id",
      "d.name",
      "d.code",
      "d.kind",
      "d.percent_mpct as percentMpct",
      "d.amount_cents as amountCents",
      "d.scope",
      "d.combinable",
      "d.cash_only as cashOnly",
      "d.needs_approval as needsApproval",
      "d.ask_note as askNote",
      "d.active",
      sql<boolean>`d.archived_at IS NOT NULL`.as("archived"),
      sql<number>`(SELECT count(*)::int FROM sale_discounts s WHERE s.discount_id = d.id)`.as("timesUsed"),
    ]);
}

/** Active discounts for the register; Settings (managers) can include inactive and archived ones. */
export const listDiscounts = defineHandler<{ all?: boolean }, DiscountRow[]>({
  action: "register.use",
  async run(trx, ctx, input) {
    let q = discountQuery(trx);
    const all = !!input?.all && can(ctx.role, "discounts.manage");
    if (!all) q = q.where("d.active", "=", true).where("d.archived_at", "is", null);
    return q.orderBy("d.archived_at", "desc").orderBy("d.name").execute();
  },
});

export interface DiscountInput {
  id?: string;
  name: string;
  code: string;
  kind: "percent" | "fixed";
  percentMpct: number | null;
  amountCents: number | null;
  scope: "ticket" | "line";
  cashOnly: boolean;
  needsApproval: boolean;
  askNote: boolean;
  combinable: boolean;
  active: boolean;
}

function clean(input: DiscountInput) {
  const errors: Record<string, string> = {};
  const name = input.name.trim();
  if (!name) errors.name = "Name is required.";
  const code = input.code.trim().toUpperCase() || null;
  if (code && !/^[A-Z0-9-]{1,20}$/.test(code))
    errors.code = "Codes can use letters, numbers and dashes, up to 20 characters.";
  if (input.kind === "percent") {
    if (!Number.isSafeInteger(input.percentMpct) || input.percentMpct! < 1 || input.percentMpct! > 100_000)
      errors.amount = "Enter a percent from 0.001 to 100.";
  } else if (input.kind === "fixed") {
    if (!Number.isSafeInteger(input.amountCents) || input.amountCents! < 1)
      errors.amount = "Enter an amount like 5.00.";
  } else errors.kind = "Pick percent or dollar amount.";
  if (input.scope !== "ticket" && input.scope !== "line") errors.scope = "Pick whole ticket or one item.";
  if (input.cashOnly && input.scope === "line")
    errors.cashOnly = "A cash-only discount applies to the whole ticket.";
  const first = Object.values(errors)[0];
  if (first) throw new AppError("invalid", first, errors);
  return {
    name,
    code,
    kind: input.kind,
    percent_mpct: input.kind === "percent" ? input.percentMpct : null,
    amount_cents: input.kind === "fixed" ? input.amountCents : null,
    scope: input.scope,
    cash_only: input.cashOnly,
    needs_approval: input.needsApproval,
    ask_note: input.askNote,
    combinable: input.combinable,
    active: input.active,
  };
}

/** Create or edit a discount. Changes are audited: they change what customers pay. */
export const saveDiscount = defineHandler<DiscountInput, { id: string }>({
  action: "discounts.manage",
  async run(trx, ctx, input) {
    const values = clean(input);
    // The register's scan field takes both SKUs and discount codes; keep them apart.
    if (values.code) {
      const clash = await trx
        .selectFrom("products")
        .select("sku")
        .where(sql`lower(sku)`, "=", values.code.toLowerCase())
        .executeTakeFirst();
      if (clash)
        throw new AppError("conflict", `A product already uses SKU ${clash.sku}. Pick another code.`, {
          code: `A product already uses SKU ${clash.sku}. Pick another code.`,
        });
    }
    try {
      if (input.id) {
        const before = await trx
          .selectFrom("discounts")
          .selectAll()
          .where("id", "=", input.id)
          .executeTakeFirst();
        if (!before || before.archived_at)
          throw new AppError("not_found", "That discount doesn't exist anymore.");
        await trx.updateTable("discounts").set(values).where("id", "=", input.id).execute();
        await audit(trx, ctx, {
          action: "discount.change",
          entity: "discount",
          entityId: input.id,
          before: pick(before),
          after: values,
        });
        return { id: input.id };
      }
      const row = await trx
        .insertInto("discounts")
        .values({ ...values, business_id: ctx.businessId })
        .returning("id")
        .executeTakeFirstOrThrow();
      await audit(trx, ctx, {
        action: "discount.change",
        entity: "discount",
        entityId: row.id,
        after: values,
      });
      return { id: row.id };
    } catch (err) {
      if (isUniqueViolation(err, "discounts_code_per_business"))
        throw new AppError("conflict", "Another discount already uses that code.", {
          code: "Another discount already uses that code.",
        });
      throw err;
    }
  },
});

function pick(d: Record<string, unknown>) {
  const keys = [
    "name",
    "code",
    "kind",
    "percent_mpct",
    "amount_cents",
    "scope",
    "cash_only",
    "needs_approval",
    "ask_note",
    "combinable",
    "active",
  ];
  return Object.fromEntries(keys.map((k) => [k, d[k]]));
}

/**
 * A discount that was never used is deleted. One on past sales is archived instead:
 * gone from the register and Settings, but past receipts keep its name.
 */
export const deleteDiscount = defineHandler<{ id: string }, { archived: boolean }>({
  action: "discounts.manage",
  async run(trx, ctx, { id }) {
    const d = await trx.selectFrom("discounts").selectAll().where("id", "=", id).executeTakeFirst();
    if (!d || d.archived_at) throw new AppError("not_found", "That discount doesn't exist anymore.");
    const used = await trx
      .selectFrom("sale_discounts")
      .select("id")
      .where("discount_id", "=", id)
      .executeTakeFirst();
    if (used)
      await trx
        .updateTable("discounts")
        .set({ archived_at: new Date(), active: false })
        .where("id", "=", id)
        .execute();
    else await trx.deleteFrom("discounts").where("id", "=", id).execute();
    await audit(trx, ctx, {
      action: "discount.change",
      entity: "discount",
      entityId: id,
      before: pick(d),
      after: { [used ? "archived" : "deleted"]: true },
    });
    return { archived: !!used };
  },
});
