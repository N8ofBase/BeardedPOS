import type { Kysely } from "kysely";
import { beforeEach, describe, expect, it } from "vitest";
import type { DB } from "../src/schema.ts";
import { withBusiness } from "../src/tx.ts";
import { createTestDb, insertBusiness } from "../src/test-db.ts";

let db: Kysely<DB>;
let a: string;
let b: string;

beforeEach(async () => {
  ({ db } = await createTestDb());
  a = await insertBusiness(db, "store-a");
  b = await insertBusiness(db, "store-b");
});

const customer = (
  business_id: string,
  extra: Partial<{ name: string; phone: string | null; email: string | null }> = {},
) =>
  db
    .insertInto("customers")
    .values({ business_id, name: "Pat", phone: "2125550100", ...extra })
    .returning("id")
    .executeTakeFirstOrThrow();

describe("customers", () => {
  it("keeps phone unique in a business, but allows it in another", async () => {
    await customer(a);
    await expect(customer(a, { name: "Other" })).rejects.toThrow(/customers_phone_per_business/);
    await customer(b);
  });

  it("keeps email unique ignoring case", async () => {
    await customer(a, { phone: null, email: "pat@example.com" });
    await expect(customer(a, { phone: null, email: "PAT@example.com" })).rejects.toThrow(
      /customers_email_per_business/,
    );
  });

  it("only stores 10-digit phones, and needs a phone or email", async () => {
    await expect(customer(a, { phone: "555-0100" })).rejects.toThrow(/check constraint/);
    await expect(customer(a, { phone: null, email: null })).rejects.toThrow(/customers_contact/);
  });

  it("returns dates as YYYY-MM-DD text", async () => {
    const { id } = await customer(a);
    await db.updateTable("customers").set({ birthday: "1990-02-28" }).where("id", "=", id).execute();
    const row = await db.selectFrom("customers").select("birthday").executeTakeFirstOrThrow();
    expect(row.birthday).toBe("1990-02-28");
  });
});

describe("deleting a customer", () => {
  it("removes their punches with them", async () => {
    const pat = await customer(a);
    const program = await db
      .insertInto("astro_programs")
      .values({ business_id: a, name: "Club", buy_count: 12 })
      .returning("id")
      .executeTakeFirstOrThrow();
    await db
      .insertInto("astro_punches")
      .values({ business_id: a, customer_id: pat.id, program_id: program.id, qty: 3, kind: "earn" })
      .execute();

    await withBusiness(db, a, (trx) => trx.deleteFrom("customers").where("id", "=", pat.id).execute());

    expect(await db.selectFrom("astro_punches").select("id").execute()).toEqual([]);
  });
});

describe("Astro punches", () => {
  it("adds up earned, opening and redeemed punches per program", async () => {
    const pat = await customer(a);
    const club = await db
      .insertInto("astro_programs")
      .values({ business_id: a, name: "Club", buy_count: 12 })
      .returning("id")
      .executeTakeFirstOrThrow();
    const punch = (qty: number, kind: "earn" | "redeem" | "opening_balance") =>
      db
        .insertInto("astro_punches")
        .values({ business_id: a, customer_id: pat.id, program_id: club.id, qty, kind })
        .execute();
    await punch(8, "opening_balance");
    await punch(4, "earn");
    await punch(12, "redeem");
    await punch(2, "earn");
    const rows = await withBusiness(db, a, (trx) =>
      trx.selectFrom("astro_balances").select("balance").execute(),
    );
    expect(rows).toEqual([{ balance: 2 }]);
    expect(
      await withBusiness(db, b, (trx) => trx.selectFrom("astro_balances").selectAll().execute()),
    ).toEqual([]);
  });

  it("can't use another business's program", async () => {
    const pat = await customer(a);
    const clubB = await db
      .insertInto("astro_programs")
      .values({ business_id: b, name: "B club", buy_count: 12 })
      .returning("id")
      .executeTakeFirstOrThrow();
    await expect(
      db
        .insertInto("astro_punches")
        .values({ business_id: a, customer_id: pat.id, program_id: clubB.id, qty: 1, kind: "earn" })
        .execute(),
    ).rejects.toThrow(/foreign key/);
  });
});
