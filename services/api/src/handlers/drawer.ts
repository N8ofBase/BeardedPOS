// End of day: count the drawer against what should be in it. The expected amount is
// always worked out here from payments and refunds, never taken from the browser.
import {
  AppError,
  countTotal,
  depositFor,
  expectedCash,
  isIsoDate,
  needsShortNote,
  overShortLabel,
  SHORT_NOTE_CENTS,
  todayIso,
  formatMoney,
} from "@pet-pos/core";
import type { Transaction } from "kysely";
import type { DB } from "@pet-pos/db";
import { defineHandler } from "../handler.ts";
import { audit, currentLocationId, requireInt } from "../shared.ts";
import { moneyTotals, type MoneyTotals } from "./totals.ts";

/** The store's local calendar day, midnight to midnight. */
function dayBounds(day: string): { from: Date; to: Date } {
  if (!isIsoDate(day)) throw new AppError("invalid", "Pick a day.");
  if (day > todayIso()) throw new AppError("invalid", "That day hasn't happened yet.");
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return { from: new Date(y, m - 1, d), to: new Date(y, m - 1, d + 1) };
}

export interface DrawerCountRow {
  id: string;
  day: string;
  createdAt: Date;
  staffName: string | null;
  startingCents: number;
  expectedCents: number;
  countedCents: number;
  overShortCents: number;
  cardCents: number;
  note: string | null;
}

async function counts(trx: Transaction<DB>, from: string, to: string): Promise<DrawerCountRow[]> {
  return trx
    .selectFrom("drawer_counts as d")
    .leftJoin("staff as s", "s.id", "d.staff_id")
    .select([
      "d.id",
      "d.business_date as day",
      "d.created_at as createdAt",
      "s.name as staffName",
      "d.starting_cents as startingCents",
      "d.expected_cents as expectedCents",
      "d.counted_cents as countedCents",
      "d.over_short_cents as overShortCents",
      "d.card_cents as cardCents",
      "d.note",
    ])
    .where("d.business_date", ">=", from)
    .where("d.business_date", "<=", to)
    .orderBy("d.business_date", "desc")
    .orderBy("d.created_at", "desc")
    .limit(200)
    .execute();
}

export interface DrawerSummary {
  day: string;
  /** From settings; the count screen can change it for the day. */
  startingCents: number;
  cashInCents: number;
  cashOutCents: number;
  /** Card payments taken − card refunds. */
  cardCents: number;
  totals: MoneyTotals;
  /** Earlier counts of this day, newest first. The newest one counts. */
  counts: DrawerCountRow[];
  shortNoteCents: number;
}

async function summary(trx: Transaction<DB>, businessId: string, day: string): Promise<DrawerSummary> {
  const { from, to } = dayBounds(day);
  const totals = await moneyTotals(trx, from, to);
  const biz = await trx
    .selectFrom("businesses")
    .select("drawer_float_cents")
    .where("id", "=", businessId)
    .executeTakeFirstOrThrow();
  return {
    day,
    startingCents: biz.drawer_float_cents,
    cashInCents: totals.cashInCents,
    cashOutCents: totals.cashBackCents,
    cardCents: totals.cardInCents - totals.cardBackCents,
    totals,
    counts: await counts(trx, day, day),
    shortNoteCents: SHORT_NOTE_CENTS,
  };
}

export const drawerSummary = defineHandler<{ day: string }, DrawerSummary>({
  action: "drawer.count",
  run: (trx, ctx, { day }) => summary(trx, ctx.businessId, day),
});

export interface DrawerCountInput {
  day: string;
  startingCents: number;
  /** Count per denomination in cents ({"2000": 7}), or null to use countedCents. */
  denominations: Record<string, number> | null;
  countedCents?: number;
  note?: string;
}

export interface DrawerCountResult {
  id: string;
  expectedCents: number;
  countedCents: number;
  overShortCents: number;
  /** "Even", "Over $2.00", "Short $3.50" */
  label: string;
  depositCents: number;
  leaveCents: number;
}

export const saveDrawerCount = defineHandler<DrawerCountInput, DrawerCountResult>({
  action: "drawer.count",
  async run(trx, ctx, input) {
    const s = await summary(trx, ctx.businessId, input.day);
    const starting = requireInt(input.startingCents, "Starting cash", { min: 0, max: 10_000_000 });
    const counted = input.denominations
      ? countTotal(input.denominations)
      : requireInt(input.countedCents, "Cash counted", { min: 0, max: 100_000_000 });
    const expected = expectedCash(starting, s.cashInCents, s.cashOutCents);
    const overShort = counted - expected;
    const note = input.note?.trim() || null;
    if (needsShortNote(overShort) && !note)
      throw new AppError(
        "invalid",
        `The drawer is short more than ${formatMoney(SHORT_NOTE_CENTS)}. Add a note saying what happened.`,
      );
    const row = await trx
      .insertInto("drawer_counts")
      .values({
        business_id: ctx.businessId,
        location_id: await currentLocationId(trx),
        business_date: input.day,
        staff_id: ctx.staffId,
        starting_cents: starting,
        cash_in_cents: s.cashInCents,
        cash_out_cents: s.cashOutCents,
        expected_cents: expected,
        counted_cents: counted,
        over_short_cents: overShort,
        card_cents: s.cardCents,
        denominations: input.denominations ? JSON.stringify(input.denominations) : null,
        note,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await audit(trx, ctx, {
      action: "drawer.count",
      entity: "drawer_count",
      entityId: row.id,
      after: {
        day: input.day,
        starting_cents: starting,
        expected_cents: expected,
        counted_cents: counted,
        over_short_cents: overShort,
        card_cents: s.cardCents,
        note,
        recount: s.counts.length > 0,
      },
    });
    const { depositCents, leaveCents } = depositFor(counted, starting);
    return {
      id: row.id,
      expectedCents: expected,
      countedCents: counted,
      overShortCents: overShort,
      label: overShortLabel(overShort),
      depositCents,
      leaveCents,
    };
  },
});

/** Past counts, newest first. from/to are "YYYY-MM-DD". */
export const listDrawerCounts = defineHandler<{ from: string; to: string }, DrawerCountRow[]>({
  action: "drawer.count",
  async run(trx, _ctx, { from, to }) {
    if (!isIsoDate(from) || !isIsoDate(to)) throw new AppError("invalid", "Pick the days to show.");
    return counts(trx, from, to);
  },
});
