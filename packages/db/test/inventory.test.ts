import { sql, type Kysely } from "kysely";
import { beforeEach, describe, expect, it } from "vitest";
import type { DB } from "../src/schema.ts";
import { withBusiness } from "../src/tx.ts";
import { createTestDb, insertBusiness } from "../src/test-db.ts";

let db: Kysely<DB>;
let a: string;
let b: string;
let locA: string;
let productA: string;

beforeEach(async () => {
  ({ db } = await createTestDb());
  a = await insertBusiness(db, "store-a");
  b = await insertBusiness(db, "store-b");
  locA = (
    await db
      .insertInto("locations")
      .values({ business_id: a, name: "A" })
      .returning("id")
      .executeTakeFirstOrThrow()
  ).id;
  await db.insertInto("locations").values({ business_id: b, name: "B" }).execute();
  productA = (
    await db
      .insertInto("products")
      .values({ business_id: a, sku: "0001", name: "Food", price_cents: 1000 })
      .returning("id")
      .executeTakeFirstOrThrow()
  ).id;
});

function move(qty: number, reason: "receive" | "adjust" | "return" | "sale" = "adjust") {
  return withBusiness(db, a, (trx) =>
    trx
      .insertInto("inventory_moves")
      .values({ business_id: a, product_id: productA, location_id: locA, qty_change: qty, reason })
      .execute(),
  );
}

async function onHand(): Promise<number> {
  return withBusiness(db, a, async (trx) => {
    const r = await trx.selectFrom("inventory_levels").select("on_hand").executeTakeFirst();
    return r?.on_hand ?? 0;
  });
}

describe("inventory moves", () => {
  it("keeps on hand equal to the sum of moves", async () => {
    await move(12, "receive");
    await move(-3, "sale");
    await move(1, "return");
    await move(-2, "adjust");
    expect(await onHand()).toBe(8);
    const sum = await withBusiness(db, a, (trx) =>
      trx
        .selectFrom("inventory_moves")
        .select(sql<number>`sum(qty_change)::int`.as("s"))
        .executeTakeFirstOrThrow(),
    );
    expect(sum.s).toBe(8);
  });

  it("can't be changed or deleted by the app", async () => {
    await move(5);
    await expect(
      withBusiness(db, a, (trx) => trx.updateTable("inventory_moves").set({ qty_change: 500 }).execute()),
    ).rejects.toThrow(/permission denied/);
    await expect(withBusiness(db, a, (trx) => trx.deleteFrom("inventory_moves").execute())).rejects.toThrow(
      /permission denied/,
    );
  });

  it("doesn't let the app write stock levels directly", async () => {
    await move(5);
    await expect(
      withBusiness(db, a, (trx) => trx.updateTable("inventory_levels").set({ on_hand: 999 }).execute()),
    ).rejects.toThrow(/permission denied/);
    expect(await onHand()).toBe(5);
  });

  it("refuses a zero move", async () => {
    await expect(move(0)).rejects.toThrow(/check constraint/);
  });
});

describe("products", () => {
  it("keeps SKUs unique within a business, ignoring case, but not across businesses", async () => {
    await expect(
      db
        .insertInto("products")
        .values({ business_id: a, sku: "0001", name: "Dup", price_cents: 1 })
        .execute(),
    ).rejects.toThrow(/products_sku_per_business/);
    await db
      .insertInto("products")
      .values({ business_id: a, sku: "abc", name: "X", price_cents: 1 })
      .execute();
    await expect(
      db.insertInto("products").values({ business_id: a, sku: "ABC", name: "Y", price_cents: 1 }).execute(),
    ).rejects.toThrow(/products_sku_per_business/);
    await db
      .insertInto("products")
      .values({ business_id: b, sku: "0001", name: "B food", price_cents: 1 })
      .execute();
  });

  it("can't link to another business's Astro program", async () => {
    const programB = await db
      .insertInto("astro_programs")
      .values({ business_id: b, name: "B club", buy_count: 10 })
      .returning("id")
      .executeTakeFirstOrThrow();
    await expect(
      db.updateTable("products").set({ astro_program_id: programB.id }).where("id", "=", productA).execute(),
    ).rejects.toThrow(/products_astro_program/);
  });

  it("clears the link, not the product, when a program is deleted", async () => {
    const program = await db
      .insertInto("astro_programs")
      .values({ business_id: a, name: "A club", buy_count: 10 })
      .returning("id")
      .executeTakeFirstOrThrow();
    await db
      .updateTable("products")
      .set({ astro_program_id: program.id })
      .where("id", "=", productA)
      .execute();
    await db.deleteFrom("astro_programs").where("id", "=", program.id).execute();
    const p = await db
      .selectFrom("products")
      .select(["business_id", "astro_program_id"])
      .executeTakeFirstOrThrow();
    expect(p).toEqual({ business_id: a, astro_program_id: null });
  });

  it("needs both halves of an Astro offer", async () => {
    await expect(
      db.updateTable("products").set({ astro_offer_label: "$5 off" }).where("id", "=", productA).execute(),
    ).rejects.toThrow(/products_offer_complete/);
  });
});

describe("audit log", () => {
  it("can't be changed or deleted by the app", async () => {
    await withBusiness(db, a, (trx) =>
      trx.insertInto("audit_log").values({ business_id: a, action: "test", entity: "product" }).execute(),
    );
    await expect(
      withBusiness(db, a, (trx) => trx.updateTable("audit_log").set({ action: "edited" }).execute()),
    ).rejects.toThrow(/permission denied/);
    await expect(withBusiness(db, a, (trx) => trx.deleteFrom("audit_log").execute())).rejects.toThrow(
      /permission denied/,
    );
  });
});
