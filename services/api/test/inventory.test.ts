import type { Kysely } from "kysely";
import { beforeEach, describe, expect, it } from "vitest";
import type { Ctx, ProductInput } from "@pet-pos/core";
import { ensureDemo, listDemoStaff, withBusiness, type DB } from "@pet-pos/db";
import { createTestDb, insertBusiness } from "@pet-pos/db/test-db";
import { invoke } from "../src/registry.ts";

let db: Kysely<DB>;
let owner: Ctx;
let manager: Ctx;
let cashier: Ctx;
let groomer: Ctx;

const product: ProductInput = {
  sku: "B-100",
  barcode: "012345678905",
  name: "Test Kibble 5 lb",
  brand: "Test Brand",
  category: "Dog food",
  priceCents: 1999,
  costCents: 1200,
  taxClass: "standard",
  reorderAt: 3,
  astroProgramId: null,
  offerLabel: null,
  offerCents: null,
};

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
  groomer = ctx("groomer");
});

async function auditRows() {
  return withBusiness(db, owner.businessId, (trx) =>
    trx.selectFrom("audit_log").select(["action", "entity_id", "before", "after", "staff_id"]).execute(),
  );
}

describe("demo seed", () => {
  it("adds the prototype's sample products, with stock from opening moves", async () => {
    const rows = await invoke(db, owner, "listProducts", {});
    expect(rows.map((r) => [r.sku, r.onHand])).toEqual([
      ["0002", 4],
      ["0004", 0],
      ["0001", 14],
      ["0003", 30],
    ]);
    expect(rows.find((r) => r.sku === "0001")).toMatchObject({
      astroProgramName: "Sample dry food club (DEMO)",
      offerLabel: "$5 off 24 lb bag",
      offerCents: 500,
    });
  });

  it("is safe to run again", async () => {
    await ensureDemo(db);
    expect(await invoke(db, owner, "listProducts", {})).toHaveLength(4);
  });
});

describe("saveProduct", () => {
  it("creates a product with an opening count", async () => {
    const { id } = await invoke(db, manager, "saveProduct", { ...product, openingOnHand: 7 });
    const { product: p, moves } = await invoke(db, cashier, "getProduct", { id });
    expect(p).toMatchObject({ sku: "B-100", priceCents: 1999, onHand: 7 });
    expect(moves).toMatchObject([{ qtyChange: 7, reason: "adjust", note: "Opening count" }]);
  });

  it("audits a price change with before and after", async () => {
    const { id } = await invoke(db, owner, "saveProduct", product);
    await invoke(db, manager, "saveProduct", { ...product, id, priceCents: 2199 });
    expect(await auditRows()).toEqual([
      {
        action: "product.price_change",
        entity_id: id,
        before: { price_cents: 1999, cost_cents: 1200 },
        after: { price_cents: 2199, cost_cents: 1200 },
        staff_id: manager.staffId,
      },
    ]);
  });

  it("doesn't audit an edit that leaves price and cost alone", async () => {
    const { id } = await invoke(db, owner, "saveProduct", product);
    await invoke(db, owner, "saveProduct", { ...product, id, name: "Renamed" });
    expect(await auditRows()).toEqual([]);
  });

  it("explains a duplicate SKU or barcode", async () => {
    await invoke(db, owner, "saveProduct", product);
    await expect(
      invoke(db, owner, "saveProduct", { ...product, barcode: null, sku: "b-100" }),
    ).rejects.toThrow("That SKU already exists.");
    await expect(invoke(db, owner, "saveProduct", { ...product, sku: "OTHER" })).rejects.toThrow(
      "Another product already has that barcode.",
    );
  });

  it("refuses invalid input with the field's message", async () => {
    await expect(invoke(db, owner, "saveProduct", { ...product, name: " " })).rejects.toMatchObject({
      code: "invalid",
      fields: { name: "Name is required." },
    });
  });

  it("isn't allowed for cashiers or groomers", async () => {
    await expect(invoke(db, cashier, "saveProduct", product)).rejects.toThrow(/permission/);
    await expect(invoke(db, groomer, "listProducts", {})).rejects.toThrow(/permission/);
  });
});

describe("stock", () => {
  it("receives stock", async () => {
    const { id } = await invoke(db, owner, "saveProduct", { ...product, openingOnHand: 2 });
    expect(await invoke(db, manager, "receiveStock", { productId: id, qty: 12 })).toEqual({ onHand: 14 });
    await expect(invoke(db, manager, "receiveStock", { productId: id, qty: 0 })).rejects.toThrow(
      /whole number/,
    );
    await expect(invoke(db, cashier, "receiveStock", { productId: id, qty: 1 })).rejects.toThrow(
      /permission/,
    );
  });

  it("writes only the differences from a count", async () => {
    const all = await invoke(db, owner, "listProducts", {});
    const bySku = Object.fromEntries(all.map((p) => [p.sku, p]));
    const res = await invoke(db, manager, "saveCounts", {
      lines: [
        { productId: bySku["0001"]!.id, counted: 14 },
        { productId: bySku["0002"]!.id, counted: 6 },
        { productId: bySku["0003"]!.id, counted: 27 },
      ],
    });
    expect(res.counted).toBe(3);
    expect(res.changed).toEqual([
      { productId: bySku["0002"]!.id, before: 4, after: 6 },
      { productId: bySku["0003"]!.id, before: 30, after: 27 },
    ]);
    const after = await invoke(db, owner, "listProducts", {});
    expect(after.find((p) => p.sku === "0003")!.onHand).toBe(27);
    const { moves } = await invoke(db, owner, "getProduct", { id: bySku["0001"]!.id });
    expect(moves).toHaveLength(1);
  });

  it("refuses a count with the same item twice", async () => {
    const [p] = await invoke(db, owner, "listProducts", {});
    await expect(
      invoke(db, owner, "saveCounts", {
        lines: [
          { productId: p!.id, counted: 1 },
          { productId: p!.id, counted: 2 },
        ],
      }),
    ).rejects.toThrow(/twice/);
  });
});

describe("finding products", () => {
  it("finds by SKU in any case or by barcode", async () => {
    await invoke(db, owner, "saveProduct", product);
    expect((await invoke(db, cashier, "findByCode", { code: "b-100" }))?.name).toBe("Test Kibble 5 lb");
    expect((await invoke(db, cashier, "findByCode", { code: " 012345678905 " }))?.sku).toBe("B-100");
    expect(await invoke(db, cashier, "findByCode", { code: "nope" })).toBeNull();
  });

  it("filters by text, category and low stock", async () => {
    expect((await invoke(db, owner, "listProducts", { q: "treat" })).map((p) => p.sku)).toEqual(["0003"]);
    expect((await invoke(db, owner, "listProducts", { category: "Cat food" })).map((p) => p.sku)).toEqual([
      "0002",
    ]);
    expect((await invoke(db, owner, "listProducts", { lowOnly: true })).map((p) => p.sku)).toEqual([
      "0002",
      "0004",
    ]);
    expect(await invoke(db, owner, "listProducts", { q: "%" })).toEqual([]);
  });

  it("hides archived products unless asked", async () => {
    const [p] = await invoke(db, owner, "listProducts", { q: "rope" });
    await invoke(db, owner, "archiveProduct", { id: p!.id, archived: true });
    expect(await invoke(db, owner, "listProducts", { q: "rope" })).toEqual([]);
    expect(await invoke(db, owner, "listProducts", { q: "rope", includeArchived: true })).toHaveLength(1);
    expect(await invoke(db, owner, "findByCode", { code: "0004" })).toBeNull();
  });
});

describe("Astro programs", () => {
  it("lists programs with their product counts", async () => {
    expect(await invoke(db, cashier, "listPrograms", undefined)).toMatchObject([
      { name: "Sample dry food club (DEMO)", buyCount: 12, rewardText: "Next bag free", productCount: 2 },
    ]);
  });

  it("adds a program and refuses a duplicate name", async () => {
    await invoke(db, manager, "saveProgram", { name: "Cat club", brand: null, buyCount: 10, rewardText: "" });
    await expect(
      invoke(db, manager, "saveProgram", { name: "cat CLUB", brand: null, buyCount: 10, rewardText: "" }),
    ).rejects.toThrow(/already a program/);
    await expect(
      invoke(db, cashier, "saveProgram", { name: "X", brand: null, buyCount: 10, rewardText: "" }),
    ).rejects.toThrow(/permission/);
    await expect(
      invoke(db, owner, "saveProgram", { name: "Y", brand: null, buyCount: 1, rewardText: "" }),
    ).rejects.toThrow(/2 to 1000/);
  });
});

describe("separation between businesses", () => {
  it("never shows or changes another business's products", async () => {
    const other = await insertBusiness(db, "other-store");
    await db.insertInto("locations").values({ business_id: other, name: "Other" }).execute();
    const otherStaff = await db
      .insertInto("staff")
      .values({ business_id: other, name: "Olga", role: "owner" })
      .returning("id")
      .executeTakeFirstOrThrow();
    const otherCtx: Ctx = { businessId: other, staffId: otherStaff.id, role: "owner" };

    expect(await invoke(db, otherCtx, "listProducts", {})).toEqual([]);
    const [demoProduct] = await invoke(db, owner, "listProducts", {});
    await expect(invoke(db, otherCtx, "getProduct", { id: demoProduct!.id })).rejects.toThrow(
      /doesn't exist/,
    );
    await expect(
      invoke(db, otherCtx, "receiveStock", { productId: demoProduct!.id, qty: 5 }),
    ).rejects.toThrow(/doesn't exist/);
    await expect(invoke(db, otherCtx, "saveProduct", { ...product, id: demoProduct!.id })).rejects.toThrow(
      /doesn't exist/,
    );
  });
});
