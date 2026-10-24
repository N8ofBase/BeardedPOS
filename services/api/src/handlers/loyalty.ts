// Beard Buddy loyalty. The rules are in packages/core/src/loyalty.ts; this keeps the
// ledger. Sales write their entries in the same transaction as the sale (register.ts
// and refunds.ts call the helpers here), so the balance can't drift from what was sold.
import { sql, type Transaction } from "kysely";
import {
  AppError,
  BIRTHDAY_BUCKS,
  BUCKS_PER_REWARD,
  birthdayGiftDue,
  bucksEarned,
  refundBucks,
  todayIso,
  type Ctx,
  type LedgerKind,
} from "@bearded/core";
import type { DB } from "@bearded/db";
import { defineHandler } from "../handler.ts";
import { audit, requireInt } from "../shared.ts";

type Trx = Transaction<DB>;

export async function loyaltyEnabled(trx: Trx, ctx: Ctx): Promise<boolean> {
  const b = await trx
    .selectFrom("businesses")
    .select("loyalty_enabled")
    .where("id", "=", ctx.businessId)
    .executeTakeFirstOrThrow();
  return b.loyalty_enabled;
}

export async function bucksBalance(trx: Trx, customerId: string): Promise<number> {
  const r = await trx
    .selectFrom("loyalty_ledger")
    .select(sql<number>`coalesce(sum(bucks), 0)::int`.as("n"))
    .where("customer_id", "=", customerId)
    .executeTakeFirstOrThrow();
  return r.n;
}

/** The date of the customer's last birthday gift, or null. */
async function lastGiftOn(trx: Trx, customerId: string): Promise<string | null> {
  const r = await trx
    .selectFrom("loyalty_ledger")
    .select("created_at")
    .where("customer_id", "=", customerId)
    .where("kind", "=", "birthday")
    .orderBy("created_at", "desc")
    .executeTakeFirst();
  return r ? todayIso(new Date(r.created_at)) : null;
}

export interface LoyaltyCard {
  balance: number;
  /** Paying for a sale today adds the birthday gift. */
  birthdayGiftDue: boolean;
}

/** What the register shows for the customer on the ticket; null when loyalty is off. */
export async function loyaltyCard(trx: Trx, ctx: Ctx, customerId: string): Promise<LoyaltyCard | null> {
  if (!(await loyaltyEnabled(trx, ctx))) return null;
  const c = await trx
    .selectFrom("customers")
    .select("birthday")
    .where("id", "=", customerId)
    .executeTakeFirstOrThrow();
  return {
    balance: await bucksBalance(trx, customerId),
    birthdayGiftDue: birthdayGiftDue(c.birthday, await lastGiftOn(trx, customerId)),
  };
}

async function add(
  trx: Trx,
  ctx: Ctx,
  e: { customerId: string; saleId: string | null; kind: LedgerKind; bucks: number; note?: string | null },
): Promise<void> {
  if (e.bucks === 0) return;
  await trx
    .insertInto("loyalty_ledger")
    .values({
      business_id: ctx.businessId,
      customer_id: e.customerId,
      sale_id: e.saleId,
      kind: e.kind,
      bucks: e.bucks,
      note: e.note ?? null,
      staff_id: ctx.staffId,
    })
    .execute();
}

/**
 * Spends Bucks on rewards when a sale opens. The customer row is locked so two
 * registers can't spend the same Bucks.
 */
export async function redeemRewards(
  trx: Trx,
  ctx: Ctx,
  customerId: string | null,
  saleId: string,
  rewards: number,
): Promise<void> {
  if (rewards === 0) return;
  if (!customerId) throw new AppError("invalid", "Add the customer to use their Beard Bucks.");
  if (!(await loyaltyEnabled(trx, ctx))) throw new AppError("invalid", "Beard Buddy is turned off.");
  await trx.selectFrom("customers").select("id").where("id", "=", customerId).forUpdate().execute();
  const balance = await bucksBalance(trx, customerId);
  const cost = rewards * BUCKS_PER_REWARD;
  if (cost > balance)
    throw new AppError("invalid", `They have ${balance} Beard Bucks, not enough for ${cost}.`);
  await add(trx, ctx, { customerId, saleId, kind: "redeem", bucks: -cost });
}

/** Bucks for a paid sale, and the birthday gift if it's due. Runs once, when the sale is finished. */
export async function earnOnSale(
  trx: Trx,
  ctx: Ctx,
  sale: { id: string; customer_id: string | null; subtotal_cents: number; discount_cents: number },
): Promise<void> {
  if (!sale.customer_id || !(await loyaltyEnabled(trx, ctx))) return;
  await add(trx, ctx, {
    customerId: sale.customer_id,
    saleId: sale.id,
    kind: "earn",
    bucks: bucksEarned(sale.subtotal_cents - sale.discount_cents),
  });
  const card = await loyaltyCard(trx, ctx, sale.customer_id);
  if (card?.birthdayGiftDue)
    await add(trx, ctx, {
      customerId: sale.customer_id,
      saleId: sale.id,
      kind: "birthday",
      bucks: BIRTHDAY_BUCKS,
    });
}

async function saleSums(trx: Trx, saleId: string): Promise<Record<LedgerKind, number>> {
  const rows = await trx
    .selectFrom("loyalty_ledger")
    .select(["kind", sql<number>`sum(bucks)::int`.as("n")])
    .where("sale_id", "=", saleId)
    .groupBy("kind")
    .execute();
  const out = { earn: 0, birthday: 0, redeem: 0, take_back: 0, give_back: 0, adjust: 0 };
  for (const r of rows) out[r.kind] = r.n;
  return out;
}

/** A canceled sale gives back any Bucks spent on it. */
export async function giveBackOnVoid(trx: Trx, ctx: Ctx, saleId: string, customerId: string | null) {
  if (!customerId) return;
  const s = await saleSums(trx, saleId);
  await add(trx, ctx, { customerId, saleId, kind: "give_back", bucks: -s.redeem - s.give_back });
}

/** What a refund does to the balance, for the preview and the refund itself. */
export async function planRefundBucks(
  trx: Trx,
  sale: { id: string; customer_id: string | null; subtotal_cents: number; discount_cents: number },
  refundedNetCents: number,
): Promise<{ takeBack: number; giveBack: number }> {
  if (!sale.customer_id) return { takeBack: 0, giveBack: 0 };
  const s = await saleSums(trx, sale.id);
  return refundBucks({
    saleNetCents: sale.subtotal_cents - sale.discount_cents,
    refundedNetCents,
    bucksHeld: s.earn + s.take_back,
    bucksRedeemed: -s.redeem,
    bucksGivenBack: s.give_back,
  });
}

export async function applyRefundBucks(
  trx: Trx,
  ctx: Ctx,
  saleId: string,
  customerId: string | null,
  b: { takeBack: number; giveBack: number },
): Promise<void> {
  if (!customerId) return;
  await add(trx, ctx, { customerId, saleId, kind: "take_back", bucks: -b.takeBack });
  await add(trx, ctx, { customerId, saleId, kind: "give_back", bucks: b.giveBack });
}

/** Bucks a sale moved, for its receipt. */
export async function saleBucks(
  trx: Trx,
  saleId: string,
  customerId: string | null,
): Promise<{ earned: number; birthday: number; redeemed: number; balance: number } | null> {
  if (!customerId) return null;
  const s = await saleSums(trx, saleId);
  if (!s.earn && !s.birthday && !s.redeem) return null;
  return {
    earned: s.earn,
    birthday: s.birthday,
    redeemed: Math.abs(s.redeem),
    balance: await bucksBalance(trx, customerId),
  };
}

export interface LedgerRow {
  id: string;
  createdAt: Date;
  kind: LedgerKind;
  bucks: number;
  note: string | null;
  receiptNumber: number | null;
  saleId: string | null;
  staffName: string | null;
}

export interface CustomerBucks extends LoyaltyCard {
  enabled: boolean;
  history: LedgerRow[];
}

/** The balance and recent entries, for the customer profile. */
export const customerBucks = defineHandler<{ customerId: string }, CustomerBucks>({
  action: "customers.view",
  async run(trx, ctx, { customerId }) {
    const c = await trx.selectFrom("customers").select("id").where("id", "=", customerId).executeTakeFirst();
    if (!c) throw new AppError("not_found", "That customer doesn't exist.");
    const card = await loyaltyCard(trx, ctx, customerId);
    const history = await trx
      .selectFrom("loyalty_ledger as l")
      .leftJoin("sales as s", "s.id", "l.sale_id")
      .leftJoin("staff as st", "st.id", "l.staff_id")
      .select([
        "l.id",
        "l.created_at as createdAt",
        "l.kind",
        "l.bucks",
        "l.note",
        "s.receipt_number as receiptNumber",
        "l.sale_id as saleId",
        "st.name as staffName",
      ])
      .where("l.customer_id", "=", customerId)
      .orderBy("l.created_at", "desc")
      .limit(50)
      .execute();
    return {
      enabled: !!card,
      balance: card?.balance ?? (await bucksBalance(trx, customerId)),
      birthdayGiftDue: card?.birthdayGiftDue ?? false,
      history,
    };
  },
});

/** Adds or takes away Bucks by hand (a goodwill gift, a fix). Audited. */
export const adjustBucks = defineHandler<
  { customerId: string; bucks: number; note: string },
  { balance: number }
>({
  action: "loyalty.adjust",
  async run(trx, ctx, { customerId, bucks, note }) {
    requireInt(bucks, "Beard Bucks", { min: -100_000, max: 100_000 });
    if (bucks === 0) throw new AppError("invalid", "Enter how many Beard Bucks to add or take away.");
    const why = note.trim();
    if (!why) throw new AppError("invalid", "Add a note saying why.");
    if (why.length > 200) throw new AppError("invalid", "Keep the note under 200 characters.");
    const c = await trx
      .selectFrom("customers")
      .select("id")
      .where("id", "=", customerId)
      .forUpdate()
      .executeTakeFirst();
    if (!c) throw new AppError("not_found", "That customer doesn't exist.");
    const before = await bucksBalance(trx, customerId);
    await add(trx, ctx, { customerId, saleId: null, kind: "adjust", bucks, note: why });
    await audit(trx, ctx, {
      action: "loyalty.adjust",
      entity: "customer",
      entityId: customerId,
      before: { balance: before },
      after: { balance: before + bucks, bucks, note: why },
    });
    return { balance: before + bucks };
  },
});
