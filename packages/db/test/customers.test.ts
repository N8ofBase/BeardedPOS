import type { Kysely } from "kysely";
import { beforeEach, describe, expect, it } from "vitest";
import type { DB } from "../src/schema.ts";
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
