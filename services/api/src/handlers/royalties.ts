// Royalties: the people who earn them, what each earns on each game by sale type, and the monthly
// statement. The math is royaltyStatements() in core; this gathers what moved in the period:
// register sale lines paid in it, refunds made in it, and website orders paid in it.
import { sql, type Transaction } from "kysely";
import {
  AppError,
  royaltyStatements,
  SALE_TYPES,
  validateRoyaltyTerms,
  type RoyaltyBasis,
  type RoyaltyEntry,
  type RoyaltyGame,
  type RoyaltyRates,
  type RoyaltyStatement,
  type SaleType,
} from "@bearded/core";
import type { DB } from "@bearded/db";
import { defineHandler } from "../handler.ts";
import { audit } from "../shared.ts";

type Trx = Transaction<DB>;

export interface RoyaltyPayee {
  id: string;
  name: string;
  email: string | null;
  notes: string | null;
  active: boolean;
  /** Games this person earns on. */
  games: number;
}

export const listRoyaltyPayees = defineHandler<void, RoyaltyPayee[]>({
  action: "sales.view",
  async run(trx) {
    return trx
      .selectFrom("royalty_payees as r")
      .select([
        "r.id",
        "r.name",
        "r.email",
        "r.notes",
        "r.active",
        sql<number>`(SELECT count(*)::int FROM game_royalties g WHERE g.payee_id = r.id)`.as("games"),
      ])
      .orderBy("r.active", "desc")
      .orderBy(sql`lower(r.name)`)
      .execute();
  },
});

export interface SavePayeeInput {
  id?: string;
  name: string;
  email?: string | null;
  notes?: string | null;
  active?: boolean;
}

const blank = (s: string | null | undefined) => (s ?? "").trim() || null;

function cleanPayee(p: SavePayeeInput) {
  const name = p.name.trim();
  const email = blank(p.email);
  const notes = blank(p.notes);
  const fields: Record<string, string> = {};
  if (!name) fields.name = "Name is required.";
  else if (name.length > 100) fields.name = "Keep the name under 100 characters.";
  if (email && (email.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))
    fields.email = "Enter an email like ada@example.com, or leave it blank.";
  if (notes && notes.length > 500) fields.notes = "Keep notes under 500 characters.";
  const first = Object.values(fields)[0];
  if (first) throw new AppError("invalid", first, fields);
  return { name, email, notes };
}

async function nameTaken(trx: Trx, name: string, exceptId?: string): Promise<boolean> {
  let q = trx
    .selectFrom("royalty_payees")
    .select("id")
    .where(sql<boolean>`lower(name) = lower(${name})`);
  if (exceptId) q = q.where("id", "<>", exceptId);
  return !!(await q.executeTakeFirst());
}

/** Adds or updates a person who earns royalties. Names are unique, ignoring case. */
export const saveRoyaltyPayee = defineHandler<SavePayeeInput, { id: string }>({
  action: "products.edit",
  async run(trx, ctx, input) {
    const p = cleanPayee(input);
    if (await nameTaken(trx, p.name, input.id))
      throw new AppError("conflict", `${p.name} is already on the royalties list.`, {
        name: "That name is already on the list.",
      });
    if (input.id) {
      const row = await trx
        .updateTable("royalty_payees")
        .set({ ...p, ...(input.active !== undefined ? { active: input.active } : {}) })
        .where("id", "=", input.id)
        .returning("id")
        .executeTakeFirst();
      if (!row) throw new AppError("not_found", "That person isn't on the royalties list anymore.");
      return row;
    }
    const row = await trx
      .insertInto("royalty_payees")
      .values({ ...p, business_id: ctx.businessId })
      .returning("id")
      .executeTakeFirstOrThrow();
    await audit(trx, ctx, {
      action: "royalty.payee_add",
      entity: "royalty_payee",
      entityId: row.id,
      after: { name: p.name },
    });
    return row;
  },
});

export interface GameRoyalty {
  payeeId: string;
  payeeName: string;
  basis: RoyaltyBasis;
  rates: RoyaltyRates;
}

async function loadGameRoyalties(trx: Trx, productId: string): Promise<GameRoyalty[]> {
  const rows = await trx
    .selectFrom("game_royalties as g")
    .innerJoin("royalty_payees as r", "r.id", "g.payee_id")
    .select([
      "g.payee_id as payeeId",
      "r.name as payeeName",
      "g.basis",
      "g.retail_mpct",
      "g.online_mpct",
      "g.wholesale_mpct",
    ])
    .where("g.product_id", "=", productId)
    .orderBy("g.created_at")
    .execute();
  return rows.map((r) => ({
    payeeId: r.payeeId,
    payeeName: r.payeeName,
    basis: r.basis,
    rates: { retail: r.retail_mpct, online: r.online_mpct, wholesale: r.wholesale_mpct },
  }));
}

/** Who earns royalties on one game, and at what rates. */
export const gameRoyalties = defineHandler<{ productId: string }, GameRoyalty[]>({
  action: "sales.view",
  async run(trx, _ctx, { productId }) {
    return loadGameRoyalties(trx, productId);
  },
});

export interface SaveGameRoyaltiesInput {
  productId: string;
  /** The whole list for the game: anyone left out stops earning on it. */
  terms: {
    /** An existing person, or `newPayeeName` to add one. */
    payeeId?: string | null;
    newPayeeName?: string | null;
    basis: RoyaltyBasis;
    rates: RoyaltyRates;
  }[];
}

/** Replaces who earns royalties on a game. Every change is written to the audit log. */
export const saveGameRoyalties = defineHandler<SaveGameRoyaltiesInput, GameRoyalty[]>({
  action: "products.edit",
  async run(trx, ctx, { productId, terms }) {
    const product = await trx
      .selectFrom("products")
      .select(["id", "name"])
      .where("id", "=", productId)
      .executeTakeFirst();
    if (!product) throw new AppError("not_found", "That game isn't in inventory anymore.");
    if (terms.length > 20) throw new AppError("invalid", "A game can pay up to 20 people.");

    const rows: { payeeId: string; basis: RoyaltyBasis; rates: RoyaltyRates }[] = [];
    for (const t of terms) {
      const problem = validateRoyaltyTerms(t)[0];
      if (problem) throw new AppError("invalid", problem);
      let payeeId = t.payeeId ?? null;
      if (!payeeId) {
        const name = (t.newPayeeName ?? "").trim();
        if (!name) throw new AppError("invalid", "Pick who earns the royalty, or type a new name.");
        const existing = await trx
          .selectFrom("royalty_payees")
          .select("id")
          .where(sql<boolean>`lower(name) = lower(${name})`)
          .executeTakeFirst();
        payeeId = existing?.id ?? (await saveRoyaltyPayee.run(trx, ctx, { name })).id;
      } else {
        const found = await trx
          .selectFrom("royalty_payees")
          .select("id")
          .where("id", "=", payeeId)
          .executeTakeFirst();
        if (!found) throw new AppError("invalid", "Someone on the list isn't on the royalties list anymore.");
      }
      if (rows.some((r) => r.payeeId === payeeId))
        throw new AppError("invalid", "The same person is on this game twice. Keep one row for them.");
      rows.push({ payeeId, basis: t.basis, rates: { ...t.rates } });
    }

    const before = await loadGameRoyalties(trx, productId);
    await trx.deleteFrom("game_royalties").where("product_id", "=", productId).execute();
    for (const r of rows)
      await trx
        .insertInto("game_royalties")
        .values({
          business_id: ctx.businessId,
          product_id: productId,
          payee_id: r.payeeId,
          basis: r.basis,
          retail_mpct: r.rates.retail,
          online_mpct: r.rates.online,
          wholesale_mpct: r.rates.wholesale,
        })
        .execute();
    const after = await loadGameRoyalties(trx, productId);

    const summary = (list: GameRoyalty[]) =>
      list.map((g) => ({ payee: g.payeeName, basis: g.basis, ...g.rates }));
    if (JSON.stringify(summary(before)) !== JSON.stringify(summary(after)))
      await audit(trx, ctx, {
        action: "royalty.change",
        entity: "product",
        entityId: productId,
        before: { royalties: summary(before) },
        after: { royalties: summary(after) },
      });
    return after;
  },
});

/** Every movement of every game from `from` up to `to`, ready for royaltyStatements(). */
export async function royaltyEntries(trx: Trx, from: Date, to: Date): Promise<RoyaltyEntry[]> {
  const sold = await trx
    .selectFrom("sale_lines as l")
    .innerJoin("sales as s", "s.id", "l.sale_id")
    .innerJoin("products as p", "p.id", "l.product_id")
    .select([
      "p.id as productId",
      "s.sale_type as saleType",
      "l.qty",
      "l.line_total_cents as lineTotalCents",
      sql<number>`coalesce(l.unit_cost_cents, p.cost_cents)`.as("unitCostCents"),
    ])
    .where("s.source", "=", "register")
    .where("s.status", "=", "paid")
    .where("s.paid_at", ">=", from)
    .where("s.paid_at", "<", to)
    .execute();

  // Refunds count in the month they're given, so a month already paid out never changes.
  const refunded = await trx
    .selectFrom("refund_lines as rl")
    .innerJoin("refunds as r", "r.id", "rl.refund_id")
    .innerJoin("sale_lines as l", "l.id", "rl.sale_line_id")
    .innerJoin("sales as s", "s.id", "l.sale_id")
    .innerJoin("products as p", "p.id", "l.product_id")
    .select([
      "p.id as productId",
      "s.sale_type as saleType",
      "rl.qty",
      "rl.amount_cents as amountCents",
      "r.restock",
      sql<number>`coalesce(l.unit_cost_cents, p.cost_cents)`.as("unitCostCents"),
    ])
    .where("s.source", "=", "register")
    .where("r.created_at", ">=", from)
    .where("r.created_at", "<", to)
    .execute();

  const web = await trx
    .selectFrom("web_sale_lines")
    .select([
      "product_id as productId",
      "qty",
      "line_total_cents as lineTotalCents",
      "unit_cost_cents as unitCostCents",
    ])
    .where("sold_at", ">=", from)
    .where("sold_at", "<", to)
    .execute();

  return [
    ...sold.map((l) => ({
      productId: l.productId,
      saleType: l.saleType as SaleType,
      units: l.qty,
      revenueCents: l.lineTotalCents,
      costCents: l.unitCostCents * l.qty,
    })),
    // A unit put back on the shelf gives its cost back; one written off still cost us.
    ...refunded.map((r) => ({
      productId: r.productId,
      saleType: r.saleType as SaleType,
      units: -r.qty,
      revenueCents: -r.amountCents,
      costCents: r.restock ? -r.unitCostCents * r.qty : 0,
    })),
    ...web.map((l) => ({
      productId: l.productId,
      saleType: "online" as const,
      units: l.qty,
      revenueCents: l.lineTotalCents,
      costCents: l.unitCostCents * l.qty,
    })),
  ];
}

export interface RoyaltyReportGame extends RoyaltyGame {
  name: string;
  sku: string | null;
}

export interface RoyaltyReportPerson extends Omit<RoyaltyStatement, "games"> {
  name: string;
  email: string | null;
  games: RoyaltyReportGame[];
}

export interface RoyaltyReport {
  people: RoyaltyReportPerson[];
  /** Royalties owed by sale type, all people together. */
  byType: Record<SaleType, number>;
  totalCents: number;
}

/** Royalties owed for sales from `from` up to `to` (ISO times), by person, game and sale type. */
export const royaltyReport = defineHandler<{ from: string; to: string }, RoyaltyReport>({
  action: "sales.view",
  async run(trx, _ctx, { from, to }) {
    const start = new Date(from);
    const end = new Date(to);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end)
      throw new AppError("invalid", "Pick a start date before the end date.");

    const terms = await trx
      .selectFrom("game_royalties as g")
      .innerJoin("royalty_payees as r", "r.id", "g.payee_id")
      .innerJoin("products as p", "p.id", "g.product_id")
      .select([
        "g.payee_id as payeeId",
        "g.product_id as productId",
        "g.basis",
        "g.retail_mpct",
        "g.online_mpct",
        "g.wholesale_mpct",
        "r.name as payeeName",
        "r.email",
        "p.name as productName",
        "p.sku",
      ])
      .orderBy(sql`lower(r.name)`)
      .orderBy(sql`lower(p.name)`)
      .execute();

    const statements = royaltyStatements(
      await royaltyEntries(trx, start, end),
      terms.map((t) => ({
        payeeId: t.payeeId,
        productId: t.productId,
        basis: t.basis,
        rates: { retail: t.retail_mpct, online: t.online_mpct, wholesale: t.wholesale_mpct },
      })),
    );

    const byType = Object.fromEntries(SALE_TYPES.map((t) => [t, 0])) as Record<SaleType, number>;
    const people = statements.map((s): RoyaltyReportPerson => {
      const payee = terms.find((t) => t.payeeId === s.payeeId)!;
      return {
        ...s,
        name: payee.payeeName,
        email: payee.email,
        games: s.games.map((g) => {
          for (const c of g.cells) byType[c.saleType] += c.royaltyCents;
          const p = terms.find((t) => t.productId === g.productId)!;
          return { ...g, name: p.productName, sku: p.sku };
        }),
      };
    });
    return { people, byType, totalCents: people.reduce((n, p) => n + p.royaltyCents, 0) };
  },
});
