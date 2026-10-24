import type { Kysely } from "kysely";
import { beforeEach, describe, expect, it } from "vitest";
import { receiptText, todayIso, type Ctx } from "@bearded/core";
import { ensureDemo, listDemoStaff, withBusiness, type DB } from "@bearded/db";
import { createTestDb, insertBusiness } from "@bearded/db/test-db";
import type { TicketInput } from "../src/handlers/register.ts";
import { invoke } from "../src/registry.ts";

let db: Kysely<DB>;
let owner: Ctx;
let manager: Ctx;
let cashier: Ctx;
let sku: Record<string, { id: string }>;
// Starts with 240 Beard Bucks from the demo seed.
let buddy: string;

beforeEach(async () => {
  ({ db } = await createTestDb());
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
  sku = Object.fromEntries((await invoke(db, owner, "listProducts", {})).map((p) => [p.sku, p]));
  buddy = (await invoke(db, owner, "lookupByPhone", { phone: "2125550100" }))!.id;
});

// 0001 is $64.99, 0003 is $12.99, 0004 is $8.99; tax 7%.
const ticket = (lines: [string, number][], over: Partial<TicketInput> = {}): TicketInput => ({
  customerId: buddy,
  lines: lines.map(([s, qty], i) => ({ key: String(i), productId: sku[s]!.id, qty })),
  discounts: [],
  ...over,
});

async function pay(t: TicketInput) {
  const s = await invoke(db, cashier, "startCheckout", t);
  if (!s.paid)
    await invoke(db, cashier, "payCash", {
      saleId: s.saleId,
      amountCents: s.totalCents,
      tenderedCents: s.totalCents,
    });
  return s;
}

const balance = async (id = buddy) =>
  (await invoke(db, cashier, "registerCustomer", { id })).loyalty?.balance;

const setBirthday = (birthday: string | null) =>
  withBusiness(db, owner.businessId, (trx) =>
    trx.updateTable("customers").set({ birthday }).where("id", "=", buddy).execute(),
  );

describe("earning", () => {
  it("earns 1 Buck per dollar paid before tax, and shows it on the receipt", async () => {
    const s = await pay(
      ticket([
        ["0003", 1],
        ["0004", 1],
      ]),
    );
    expect(await balance()).toBe(240 + 21);
    const r = await invoke(db, cashier, "getSale", { id: s.saleId });
    expect(r.bucks).toEqual({ earned: 21, birthday: 0, redeemed: 0, balance: 261 });
    expect(receiptText(r)).toContain("Earned 21 Beard Bucks");
    expect(receiptText(r)).toContain("Beard Bucks balance: 261");
  });

  it("earns nothing without a customer, or before the sale is paid", async () => {
    await pay(ticket([["0003", 1]], { customerId: null }));
    await invoke(db, cashier, "startCheckout", ticket([["0001", 1]]));
    expect(await balance()).toBe(240);
  });

  it("earns nothing when the store turns Beard Buddy off", async () => {
    const s = await invoke(db, owner, "getSettings", undefined);
    await invoke(db, owner, "updateSettings", {
      name: s.name,
      brandColor: s.brandColor,
      logo: s.logo,
      locationName: s.locationName,
      taxPercent: "7",
      loyaltyEnabled: false,
    });
    await pay(ticket([["0001", 1]]));
    expect(await balance()).toBeUndefined();
    expect((await invoke(db, cashier, "customerBucks", { customerId: buddy })).balance).toBe(240);
    await expect(invoke(db, cashier, "startCheckout", ticket([["0001", 1]], { rewards: 1 }))).rejects.toThrow(
      "Beard Buddy is turned off.",
    );
  });
});

describe("birthday gift", () => {
  it("adds 100 Bucks on the first sale in the birthday month, once a year", async () => {
    await setBirthday(`1990-${todayIso().slice(5, 7)}-01`);
    expect((await invoke(db, cashier, "registerCustomer", { id: buddy })).loyalty).toEqual({
      balance: 240,
      birthdayGiftDue: true,
    });
    const s = await pay(ticket([["0004", 1]]));
    expect(await balance()).toBe(240 + 8 + 100);
    expect(receiptText(await invoke(db, cashier, "getSale", { id: s.saleId }))).toContain(
      "Happy birthday! +100 Beard Bucks",
    );
    await pay(ticket([["0004", 1]]));
    expect(await balance()).toBe(240 + 8 + 100 + 8);
  });

  it("isn't given outside the birthday month", async () => {
    const other = ((Number(todayIso().slice(5, 7)) % 12) + 1).toString().padStart(2, "0");
    await setBirthday(`1990-${other}-15`);
    await pay(ticket([["0004", 1]]));
    expect(await balance()).toBe(248);
  });
});

describe("rewards", () => {
  it("takes $5 off per 100 Bucks and earns on what's left", async () => {
    const s = await pay(
      ticket(
        [
          ["0003", 1],
          ["0004", 1],
        ],
        { rewards: 2 },
      ),
    );
    // $21.98 − $10.00 = $11.98, tax 84¢.
    expect(s).toMatchObject({ discountCents: 1000, taxCents: 84, totalCents: 1282 });
    expect(await balance()).toBe(240 - 200 + 11);
    const r = await invoke(db, cashier, "getSale", { id: s.saleId });
    expect(r.discounts).toEqual([{ name: "Beard Bucks reward ×2", amountCents: 1000, note: null }]);
    expect(receiptText(r)).toContain("Used 200 Beard Bucks");
  });

  it("refuses more rewards than the balance or the ticket allows", async () => {
    await expect(invoke(db, cashier, "startCheckout", ticket([["0001", 1]], { rewards: 3 }))).rejects.toThrow(
      "They have 240 Beard Bucks, not enough for 300.",
    );
    await expect(invoke(db, cashier, "startCheckout", ticket([["0004", 1]], { rewards: 2 }))).rejects.toThrow(
      /need at least \$10/,
    );
    await expect(
      invoke(db, cashier, "startCheckout", ticket([["0001", 1]], { rewards: 1, customerId: null })),
    ).rejects.toThrow("Add the customer to use their Beard Bucks.");
    expect(await balance()).toBe(240);
  });

  it("gives the Bucks back when the sale is canceled", async () => {
    const s = await invoke(db, cashier, "startCheckout", ticket([["0001", 1]], { rewards: 2 }));
    expect(await balance()).toBe(40);
    await invoke(db, cashier, "cancelSale", { saleId: s.saleId });
    expect(await balance()).toBe(240);
  });
});

describe("refunds", () => {
  const lineIds = async (saleId: string) =>
    (await invoke(db, manager, "refundPreview", { saleId, lines: [], restock: true })).refundable.map(
      (l) => l.saleLineId,
    );

  it("takes back what the refunded items earned, and the reward only on a full refund", async () => {
    // $64.99 + $12.99 − $5.00 = $72.98 → 72 Bucks.
    const s = await pay(
      ticket(
        [
          ["0001", 1],
          ["0003", 1],
        ],
        { rewards: 1 },
      ),
    );
    expect(await balance()).toBe(240 - 100 + 72);
    const [big, small] = await lineIds(s.saleId);

    const preview = await invoke(db, manager, "refundPreview", {
      saleId: s.saleId,
      lines: [{ saleLineId: small!, qty: 1 }],
      restock: true,
    });
    // The card game paid $12.99 − its $0.83 share of the reward = $12.16; $60.82 is left → 60 Bucks.
    expect(preview.bucks).toEqual({ takeBack: 12, giveBack: 0 });
    await invoke(db, manager, "refundSale", {
      saleId: s.saleId,
      lines: [{ saleLineId: small!, qty: 1 }],
      restock: true,
      reason: "changed_mind",
    });
    expect(await balance()).toBe(240 - 100 + 60);

    await invoke(db, owner, "refundSale", {
      saleId: s.saleId,
      lines: [{ saleLineId: big!, qty: 1 }],
      restock: true,
      reason: "changed_mind",
    });
    expect(await balance()).toBe(240);
  });
});

describe("adjusting", () => {
  it("lets managers add or take away Bucks with a note, and audits it", async () => {
    expect(
      await invoke(db, manager, "adjustBucks", { customerId: buddy, bucks: 50, note: " Game night host " }),
    ).toEqual({ balance: 290 });
    await expect(
      invoke(db, manager, "adjustBucks", { customerId: buddy, bucks: -5, note: " " }),
    ).rejects.toThrow("Add a note saying why.");
    await expect(
      invoke(db, cashier, "adjustBucks", { customerId: buddy, bucks: 5, note: "x" }),
    ).rejects.toThrow(/permission/);
    const h = await invoke(db, cashier, "customerBucks", { customerId: buddy });
    expect(h.history.map((e) => [e.kind, e.bucks, e.note])).toEqual([
      ["adjust", 50, "Game night host"],
      ["adjust", 240, "Opening balance (DEMO)"],
    ]);
    const log = await withBusiness(db, owner.businessId, (trx) =>
      trx
        .selectFrom("audit_log")
        .select(["action", "before", "after"])
        .where("action", "=", "loyalty.adjust")
        .execute(),
    );
    expect(log).toEqual([
      {
        action: "loyalty.adjust",
        before: { balance: 240 },
        after: { balance: 290, bucks: 50, note: "Game night host" },
      },
    ]);
  });
});

describe("separation between businesses", () => {
  it("never shows or spends another store's Bucks", async () => {
    const other = await insertBusiness(db, "other-store");
    const staff = await db
      .insertInto("staff")
      .values({ business_id: other, name: "Olga", role: "owner" })
      .returning("id")
      .executeTakeFirstOrThrow();
    const otherCtx: Ctx = { businessId: other, staffId: staff.id, role: "owner" };
    await expect(invoke(db, otherCtx, "customerBucks", { customerId: buddy })).rejects.toThrow(
      /doesn't exist/,
    );
    await expect(
      invoke(db, otherCtx, "adjustBucks", { customerId: buddy, bucks: 500, note: "steal" }),
    ).rejects.toThrow(/doesn't exist/);
    expect(await balance()).toBe(240);
  });
});
