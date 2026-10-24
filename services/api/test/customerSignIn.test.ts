import type { Kysely } from "kysely";
import { beforeEach, describe, expect, it } from "vitest";
import type { Ctx } from "@bearded/core";
import { ensureDemo, listDemoStaff, withBusiness, type DB } from "@bearded/db";
import { createTestDb, insertBusiness } from "@bearded/db/test-db";
import { invoke } from "../src/registry.ts";
import {
  invokePublic,
  type PublicInput,
  type PublicName,
  type PublicOutput,
} from "../src/public/registry.ts";

let db: Kysely<DB>;
let businessId: string;
let owner: Ctx;

beforeEach(async () => {
  ({ db } = await createTestDb());
  businessId = await ensureDemo(db);
  const staff = await listDemoStaff(db);
  owner = { businessId, role: "owner", staffId: staff.find((s) => s.role === "owner")!.id };
});

function pub<N extends PublicName>(name: N, input: PublicInput<N>, token: string | null = null, demo = true) {
  return invokePublic(db, { businessId, token, demo }, name, input) as Promise<PublicOutput<N>>;
}

async function signIn(contact: string, name?: string): Promise<string> {
  const sent = await pub("requestCode", { contact });
  const r = await pub("verifyCode", { contact, code: sent.demoCode!, name });
  if (r.status !== "signed_in") throw new Error("not signed in");
  return r.token;
}

describe("the store", () => {
  it("shows the store's name to anyone", async () => {
    expect(await pub("storeInfo", undefined)).toMatchObject({ storeName: "Sample Game Shop (DEMO)" });
  });
});

describe("signing in with a one-time code", () => {
  it("signs in a known customer by phone; the code is only shown in the demo", async () => {
    const sent = await pub("requestCode", { contact: "(212) 555-0100" });
    expect(sent.sentTo).toBe("a text to (212) 555-0100");
    expect(sent.demoCode).toMatch(/^\d{6}$/);
    const r = await pub("verifyCode", { contact: "2125550100", code: sent.demoCode! });
    expect(r).toMatchObject({ status: "signed_in", name: "Sample Customer (DEMO)" });
    const hosted = await invokePublic(db, { businessId, token: null, demo: false }, "requestCode", {
      contact: "family.demo@example.com",
    });
    expect(hosted).toEqual({ sentTo: "an email to family.demo@example.com" });
    // Only hashes are stored.
    const rows = await withBusiness(db, businessId, (trx) =>
      trx.selectFrom("customer_login_codes").select("code_hash").execute(),
    );
    expect(rows.every((x) => x.code_hash.length === 64 && x.code_hash !== sent.demoCode)).toBe(true);
  });

  it("signs up a new customer by email after asking their name", async () => {
    const sent = await pub("requestCode", { contact: "Pat@Example.com" });
    expect(await pub("verifyCode", { contact: "pat@example.com", code: sent.demoCode! })).toEqual({
      status: "needs_name",
    });
    const r = await pub("verifyCode", {
      contact: "pat@example.com",
      code: sent.demoCode!,
      name: " Pat Lee ",
    });
    expect(r).toMatchObject({ status: "signed_in", name: "Pat Lee" });
    const c = await invoke(db, owner, "searchCustomers", { q: "Pat Lee" });
    expect(c[0]).toMatchObject({ email: "pat@example.com", phone: null });
  });

  it("refuses wrong, used and expired codes, too many tries, and too many requests", async () => {
    await expect(pub("requestCode", { contact: "555-0100" })).rejects.toThrow(/10-digit/);
    const sent = await pub("requestCode", { contact: "2125550100" });
    await expect(pub("requestCode", { contact: "2125550100" })).rejects.toThrow(/Wait a minute/);
    const wrong = sent.demoCode === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++)
      expect(await pub("verifyCode", { contact: "2125550100", code: wrong })).toMatchObject({
        status: "wrong",
      });
    await expect(pub("verifyCode", { contact: "2125550100", code: sent.demoCode! })).rejects.toThrow(
      /Too many tries/,
    );

    const other = await pub("requestCode", { contact: "2125550101" });
    await db
      .updateTable("customer_login_codes")
      .set({ expires_at: new Date(Date.now() - 1000) })
      .where("contact", "=", "2125550101")
      .execute();
    await expect(pub("verifyCode", { contact: "2125550101", code: other.demoCode! })).rejects.toThrow(
      /expired/,
    );

    await db
      .updateTable("customer_login_codes")
      .set({ created_at: new Date(Date.now() - 5 * 60_000) })
      .execute();
    const t = await pub("requestCode", { contact: "2125550102" });
    await pub("verifyCode", { contact: "2125550102", code: t.demoCode! });
    await expect(pub("verifyCode", { contact: "2125550102", code: t.demoCode! })).rejects.toThrow(
      /isn't right/,
    );
  });

  it("needs a valid session for the customer's own data, and signs out", async () => {
    await expect(pub("myAccount", undefined)).rejects.toThrow(/sign in again/);
    await expect(pub("myAccount", undefined, "made-up-token")).rejects.toThrow(/sign in again/);
    const token = await signIn("2125550100");
    expect((await pub("myAccount", undefined, token)).name).toBe("Sample Customer (DEMO)");
    await pub("signOut", { token });
    await expect(pub("myAccount", undefined, token)).rejects.toThrow(/sign in again/);
  });
});

describe("separation", () => {
  it("keeps stores apart and the staff handlers out of reach", async () => {
    const token = await signIn("2125550100");
    expect(await pub("myAccount", undefined, token)).toEqual({
      name: "Sample Customer (DEMO)",
      phone: "2125550100",
      email: expect.anything(),
    });
    await expect(
      invokePublic(
        db,
        { businessId, token, demo: true },
        "deleteCustomer" as PublicName,
        {
          id: "x",
        } as never,
      ),
    ).rejects.toThrow(/Unknown action/);
    const other = await insertBusiness(db, "other-store");
    await expect(
      invokePublic(db, { businessId: other, token, demo: true }, "myAccount", undefined),
    ).rejects.toThrow(/sign in again/);
  });
});
