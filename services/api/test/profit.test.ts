import type { Kysely } from "kysely";
import { beforeEach, describe, expect, it } from "vitest";
import type { Ctx, ProductInput } from "@pet-pos/core";
import type { PGlite } from "@electric-sql/pglite";
import { ensureDemo, listDemoStaff, type DB } from "@pet-pos/db";
import { createTestDb, insertBusiness } from "@pet-pos/db/test-db";
import { invoke } from "../src/registry.ts";

let pg: PGlite;
let db: Kysely<DB>;
let owner: Ctx;
let manager: Ctx;
let cashier: Ctx;
let gameId: string;

// $25.00 game that costs us $19.00, 10% royalty to its designer. Not taxed, so totals stay round.
const fences: ProductInput = {
  sku: "FENCES",
  barcode: null,
  name: "Fences",
  brand: "Bearded Board Games",
  category: "Supplies",
  priceCents: 2500,
  costCents: 1900,
  wholesaleCents: 1250,
  royaltyMpct: 10_000,
  royaltyPayee: "Ada Designer",
  taxClass: "exempt",
  reorderAt: 0,
};

beforeEach(async () => {
  ({ pg, db } = await createTestDb());
  const businessId = await ensureDemo(db);
  const staff = await listDemoStaff(db);
  const ctx = (role: Ctx["role"]): Ctx => ({
    businessId,
    role,
    staffId: staff.find((s) => s.role === role)!.id,
  });
  owner = ctx("owner");
  manager = ctx("manager");
  cashier = ctx("cashier");
  gameId = (await invoke(db, owner, "saveProduct", { ...fences, openingOnHand: 20 })).id;
});

async function sell(qty: number, ctx: Ctx = cashier, productId = gameId) {
  const s = await invoke(db, ctx, "startCheckout", {
    customerId: null,
    lines: [{ key: "0", productId, qty }],
    discounts: [],
  });
  await invoke(db, ctx, "payCash", {
    saleId: s.saleId,
    amountCents: s.totalCents,
    tenderedCents: s.totalCents,
  });
  const sale = await invoke(db, owner, "getSale", { id: s.saleId });
  return { saleId: s.saleId, lineId: sale.lines[0]!.id };
}

const range = () => ({
  from: new Date(Date.now() - 3_600_000).toISOString(),
  to: new Date(Date.now() + 3_600_000).toISOString(),
});

async function fencesRow(ctx: Ctx = owner) {
  const r = await invoke(db, ctx, "profitByGame", range());
  return r.games.find((g) => g.productId === gameId);
}

describe("profit by game", () => {
  it("is revenue less our cost, with the royalty on net profit", async () => {
    await sell(3);
    expect(await fencesRow()).toMatchObject({
      name: "Fences",
      units: 3,
      revenueCents: 7500,
      costCents: 5700,
      profitCents: 1800,
      royaltyMpct: 10_000,
      royaltyPayee: "Ada Designer",
      royaltyCents: 180,
      estimatedCostLines: 0,
    });
  });

  it("keeps the cost a sale was rung at when our cost changes later", async () => {
    await sell(1);
    await invoke(db, owner, "saveProduct", { ...fences, id: gameId, costCents: 2200 });
    await sell(1);
    // $6.00 profit on the first, $3.00 on the second.
    expect(await fencesRow()).toMatchObject({
      units: 2,
      costCents: 4100,
      profitCents: 900,
      royaltyCents: 90,
    });
  });

  it("takes refunds off, and keeps the cost of units that couldn't go back on the shelf", async () => {
    const back = await sell(2);
    await invoke(db, owner, "refundSale", {
      saleId: back.saleId,
      lines: [{ saleLineId: back.lineId, qty: 1 }],
      restock: true,
      reason: "changed_mind",
    });
    expect(await fencesRow()).toMatchObject({
      units: 1,
      revenueCents: 2500,
      costCents: 1900,
      profitCents: 600,
    });

    const broken = await sell(1);
    await invoke(db, owner, "refundSale", {
      saleId: broken.saleId,
      lines: [{ saleLineId: broken.lineId, qty: 1 }],
      restock: false,
      reason: "damaged",
    });
    // The damaged copy brings in nothing and still cost $19: profit drops to −$13, so no royalty.
    expect(await fencesRow()).toMatchObject({
      units: 1,
      revenueCents: 2500,
      costCents: 3800,
      profitCents: -1300,
      royaltyCents: 0,
    });
  });

  it("uses today's cost for lines rung before costs were saved, and says so", async () => {
    const { lineId } = await sell(1);
    // As if the line had been rung before migration 030. Sale lines are append-only for
    // the app, so this goes straight to the database as its owner.
    await pg.query("UPDATE sale_lines SET unit_cost_cents = NULL WHERE id = $1", [lineId]);
    expect(await fencesRow()).toMatchObject({ costCents: 1900, estimatedCostLines: 1 });
  });

  it("leaves out sales outside the dates and canceled sales", async () => {
    await sell(1);
    const s = await invoke(db, cashier, "startCheckout", {
      customerId: null,
      lines: [{ key: "0", productId: gameId, qty: 5 }],
      discounts: [],
    });
    await invoke(db, cashier, "cancelSale", { saleId: s.saleId });
    expect(await fencesRow()).toMatchObject({ units: 1 });

    const past = await invoke(db, owner, "profitByGame", {
      from: new Date(Date.now() - 2 * 86_400_000).toISOString(),
      to: new Date(Date.now() - 86_400_000).toISOString(),
    });
    expect(past.games.find((g) => g.productId === gameId)).toBeUndefined();
    await expect(invoke(db, owner, "profitByGame", { from: range().to, to: range().from })).rejects.toThrow(
      /start date before the end date/,
    );
  });

  it("adds every game into the totals", async () => {
    await sell(3);
    const r = await invoke(db, owner, "profitByGame", range());
    const sum = (k: "units" | "revenueCents" | "costCents" | "profitCents" | "royaltyCents") =>
      r.games.reduce((n, g) => n + g[k], 0);
    expect(r.totals).toEqual({
      units: sum("units"),
      revenueCents: sum("revenueCents"),
      costCents: sum("costCents"),
      profitCents: sum("profitCents"),
      royaltyCents: sum("royaltyCents"),
    });
  });

  it("is for owners and managers only", async () => {
    await sell(1);
    expect(await fencesRow(manager)).toBeDefined();
    await expect(invoke(db, cashier, "profitByGame", range())).rejects.toThrow(/permission/);
  });

  it("never shows another business's sales", async () => {
    await sell(2);
    const other = await insertBusiness(db, "other-store");
    const r = await invoke(db, { ...owner, businessId: other }, "profitByGame", range());
    expect(r.games).toEqual([]);
  });
});
