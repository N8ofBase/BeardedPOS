import type { Kysely } from "kysely";
import { beforeEach, describe, expect, it } from "vitest";
import type { Ctx, ProductInput } from "@bearded/core";
import type { PGlite } from "@electric-sql/pglite";
import { ensureDemo, listDemoStaff, withBusiness, type DB } from "@bearded/db";
import { createTestDb, insertBusiness } from "@bearded/db/test-db";
import { invoke } from "../src/registry.ts";

let pg: PGlite;
let db: Kysely<DB>;
let owner: Ctx;
let manager: Ctx;
let cashier: Ctx;
let gameId: string;
let retailerId: string;
let personId: string;

// $25.00 game, $12.50 to stores, costs us $6.00. Not taxed, so totals stay round.
const fences: ProductInput = {
  sku: "FENCES",
  barcode: null,
  name: "Fences",
  brand: "Bearded Board Games",
  category: "Strategy games",
  priceCents: 2500,
  costCents: 600,
  wholesaleCents: 1250,
  taxClass: "exempt",
  reorderAt: 0,
};

// The designer: 10% of profit at the counter and online, 5% on wholesale.
const designerTerms = {
  newPayeeName: "Ada Designer",
  basis: "profit" as const,
  rates: { retail: 10_000, online: 10_000, wholesale: 5_000 },
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
  gameId = (await invoke(db, owner, "saveProduct", { ...fences, openingOnHand: 50 })).id;
  const people = await withBusiness(db, businessId, (trx) =>
    trx.selectFrom("customers").select(["id", "kind"]).where("is_demo", "=", true).execute(),
  );
  retailerId = people.find((c) => c.kind === "retailer")!.id;
  personId = people.find((c) => c.kind === "person")!.id;
});

async function sell(qty: number, opts: { wholesale?: boolean; customerId?: string | null } = {}) {
  const s = await invoke(db, cashier, "startCheckout", {
    customerId: opts.customerId ?? (opts.wholesale ? retailerId : null),
    lines: [{ key: "0", productId: gameId, qty }],
    discounts: [],
    wholesale: opts.wholesale,
  });
  await invoke(db, cashier, "payCash", {
    saleId: s.saleId,
    amountCents: s.totalCents,
    tenderedCents: s.totalCents,
  });
  const sale = await invoke(db, owner, "getSale", { id: s.saleId });
  return { saleId: s.saleId, lineId: sale.lines[0]!.id, totalCents: s.totalCents };
}

const hourAround = () => ({
  from: new Date(Date.now() - 3_600_000).toISOString(),
  to: new Date(Date.now() + 3_600_000).toISOString(),
});

async function report(ctx: Ctx = owner, range = hourAround()) {
  return invoke(db, ctx, "royaltyReport", range);
}

const fencesCells = async (name = "Ada Designer", range = hourAround()) =>
  (await report(owner, range)).people.find((p) => p.name === name)?.games.find((g) => g.productId === gameId)
    ?.cells;

describe("wholesale sales on the register", () => {
  it("ring at the wholesale price for a retailer, and earn no Beard Bucks", async () => {
    const { saleId, totalCents } = await sell(6, { wholesale: true });
    expect(totalCents).toBe(6 * 1250);
    const sale = await withBusiness(db, owner.businessId, (trx) =>
      trx.selectFrom("sales").select("sale_type").where("id", "=", saleId).executeTakeFirstOrThrow(),
    );
    expect(sale.sale_type).toBe("wholesale");
    const bucks = await withBusiness(db, owner.businessId, (trx) =>
      trx.selectFrom("loyalty_ledger").select("id").where("sale_id", "=", saleId).execute(),
    );
    expect(bucks).toEqual([]);
  });

  it("are for retailers only, with no rewards, and every game needs a wholesale price", async () => {
    const ticket = { lines: [{ key: "0", productId: gameId, qty: 1 }], discounts: [], wholesale: true };
    await expect(invoke(db, cashier, "startCheckout", { ...ticket, customerId: null })).rejects.toThrow(
      /Wholesale sales are for retailers/,
    );
    await expect(invoke(db, cashier, "startCheckout", { ...ticket, customerId: personId })).rejects.toThrow(
      /Wholesale sales are for retailers/,
    );
    await expect(
      invoke(db, cashier, "startCheckout", { ...ticket, customerId: retailerId, rewards: 1 }),
    ).rejects.toThrow(/rewards can't be used on a wholesale sale/);
    await invoke(db, owner, "saveProduct", { ...fences, id: gameId, wholesaleCents: null });
    await expect(invoke(db, cashier, "startCheckout", { ...ticket, customerId: retailerId })).rejects.toThrow(
      /Fences has no wholesale price yet/,
    );
  });

  it("a retailer can still buy at the regular price", async () => {
    const { totalCents } = await sell(1, { customerId: retailerId });
    expect(totalCents).toBe(2500);
  });
});

describe("who earns royalties on a game", () => {
  it("adds a new person, saves rates by sale type, and audits the change", async () => {
    const saved = await invoke(db, manager, "saveGameRoyalties", {
      productId: gameId,
      terms: [designerTerms],
    });
    expect(saved).toEqual([
      {
        payeeId: expect.any(String),
        payeeName: "Ada Designer",
        basis: "profit",
        rates: { retail: 10_000, online: 10_000, wholesale: 5_000 },
      },
    ]);
    // Typing the same name again finds the same person.
    const again = await invoke(db, manager, "saveGameRoyalties", {
      productId: gameId,
      terms: [
        {
          ...designerTerms,
          newPayeeName: "ada designer",
          rates: { ...designerTerms.rates, wholesale: 4_000 },
        },
      ],
    });
    expect(again[0]!.payeeId).toBe(saved[0]!.payeeId);

    const log = await withBusiness(db, owner.businessId, (trx) =>
      trx
        .selectFrom("audit_log")
        .select(["action", "before", "after"])
        .where("action", "=", "royalty.change")
        .orderBy("created_at")
        .execute(),
    );
    expect(log).toHaveLength(2);
    expect(log[1]).toMatchObject({
      before: { royalties: [{ payee: "Ada Designer", wholesale: 5_000 }] },
      after: { royalties: [{ payee: "Ada Designer", wholesale: 4_000 }] },
    });
  });

  it("refuses bad rates, the same person twice, and cashiers", async () => {
    await expect(
      invoke(db, owner, "saveGameRoyalties", {
        productId: gameId,
        terms: [{ ...designerTerms, rates: { ...designerTerms.rates, online: 100_001 } }],
      }),
    ).rejects.toThrow("Website rate must be 0 to 100%.");
    await expect(
      invoke(db, owner, "saveGameRoyalties", { productId: gameId, terms: [designerTerms, designerTerms] }),
    ).rejects.toThrow(/same person is on this game twice/);
    await expect(
      invoke(db, cashier, "saveGameRoyalties", { productId: gameId, terms: [designerTerms] }),
    ).rejects.toThrow();
    await expect(invoke(db, cashier, "royaltyReport", hourAround())).rejects.toThrow();
  });

  it("keeps people's names unique and lists how many games each earns on", async () => {
    await invoke(db, owner, "saveGameRoyalties", { productId: gameId, terms: [designerTerms] });
    await expect(invoke(db, owner, "saveRoyaltyPayee", { name: "ADA DESIGNER" })).rejects.toThrow(
      /already on the royalties list/,
    );
    await expect(
      invoke(db, owner, "saveRoyaltyPayee", { name: "Bo", email: "not an email" }),
    ).rejects.toThrow(/Enter an email/);
    const list = await invoke(db, owner, "listRoyaltyPayees", undefined);
    expect(list.find((p) => p.name === "Ada Designer")).toMatchObject({ games: 1, active: true });
  });
});

describe("the monthly royalties report", () => {
  beforeEach(async () => {
    await invoke(db, owner, "saveGameRoyalties", { productId: gameId, terms: [designerTerms] });
  });

  it("pays counter, website and wholesale sales at their own rates", async () => {
    await sell(2); // $38.00 profit
    await sell(6, { wholesale: true }); // $39.00 profit
    // A website order for one copy, paid now: what the store copies over when an order is paid.
    await pg.query(
      `INSERT INTO web_sale_lines (business_id, order_id, position, product_id, qty, line_total_cents, unit_cost_cents, sold_at)
       VALUES ($1, gen_random_uuid(), 1, $2, 1, 2000, 600, now())`,
      [owner.businessId, gameId],
    );
    expect(await fencesCells()).toEqual([
      expect.objectContaining({ saleType: "retail", units: 2, profitCents: 3800, royaltyCents: 380 }),
      expect.objectContaining({ saleType: "online", units: 1, profitCents: 1400, royaltyCents: 140 }),
      expect.objectContaining({ saleType: "wholesale", units: 6, profitCents: 3900, royaltyCents: 195 }),
    ]);
    const r = await report();
    expect(r.byType).toMatchObject({ retail: 380, online: 140, wholesale: 195 });
    expect(r.people.find((p) => p.name === "Ada Designer")?.royaltyCents).toBe(715);
  });

  it("counts a refund in the month it's given, so a paid month never changes", async () => {
    const { saleId, lineId } = await sell(2);
    // As if the sale was paid 40 days ago. Straight to the database as its owner.
    await pg.query("UPDATE sales SET paid_at = now() - interval '40 days' WHERE id = $1", [saleId]);
    await invoke(db, owner, "refundSale", {
      saleId,
      lines: [{ saleLineId: lineId, qty: 1 }],
      restock: true,
      reason: "changed_mind",
    });
    const then = {
      from: new Date(Date.now() - 41 * 86_400_000).toISOString(),
      to: new Date(Date.now() - 39 * 86_400_000).toISOString(),
    };
    expect(await fencesCells("Ada Designer", then)).toEqual([
      expect.objectContaining({ units: 2, profitCents: 3800, royaltyCents: 380 }),
    ]);
    // This month: a copy came back and went on the shelf. A loss for the month, so nothing owed.
    expect(await fencesCells()).toEqual([
      expect.objectContaining({ units: -1, revenueCents: -2500, costCents: -600, royaltyCents: 0 }),
    ]);
  });

  it("leaves out canceled sales and other businesses", async () => {
    const s = await invoke(db, cashier, "startCheckout", {
      customerId: null,
      lines: [{ key: "0", productId: gameId, qty: 5 }],
      discounts: [],
    });
    await invoke(db, cashier, "cancelSale", { saleId: s.saleId });
    expect(await fencesCells()).toBeUndefined();

    await sell(1);
    const other = await insertBusiness(db, "other-store");
    const r = await report({ ...owner, businessId: other });
    expect(r).toEqual({ people: [], byType: { retail: 0, online: 0, wholesale: 0 }, totalCents: 0 });
  });

  it("refuses an end date before the start", async () => {
    const r = hourAround();
    await expect(report(owner, { from: r.to, to: r.from })).rejects.toThrow(/start date before the end date/);
  });
});

describe("sample data", () => {
  it("has two people with royalties, removed with the rest of the demo data", async () => {
    const before = await invoke(db, owner, "listRoyaltyPayees", undefined);
    expect(before.map((p) => p.name)).toEqual(["Ada Designer (DEMO)", "Sam Artist (DEMO)"]);
    await invoke(db, owner, "removeDemoData", undefined);
    expect(await invoke(db, owner, "listRoyaltyPayees", undefined)).toEqual([]);
  });
});
