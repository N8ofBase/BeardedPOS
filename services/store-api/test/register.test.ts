// The hosted register under /api/pos: staff sign-in, calls by handler name with the role from the
// session, and the store's business set up beside the online store's tables in one database.
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { createDb, ensureStore, migrate as migrateRegister, PGLITE_OPTIONS } from "@bearded/db";
import type { CheckoutResult, PaymentResult } from "@bearded/api";
import { migrate as migrateStore, withBusiness, type Database } from "../src/db.ts";
import { storeItems, storeSetup } from "../src/register-postgres.ts";
import { loadSnapshot } from "../src/square/snapshot.ts";
import { BIZ_A, BIZ_B, makeStore, signInStaff, type TestStore } from "./helpers.ts";

const N8 = "n8gr8@prismcortex.net";
const ENV = { POS_OWNERS: `N8 <${N8}>, Adam <adam@beardedboardgames.com>`, POS_DEMO_STOCK: "100" };

let pg: PGlite;

beforeAll(async () => {
  pg = new PGlite(PGLITE_OPTIONS);
  // The order the Lambda uses: the register's tables, then the store's, then the store's setup.
  await migrateRegister(pg);
  await migrateStore(pg as unknown as Database);
  const pos = createDb(pg);
  await ensureStore(pos, storeSetup(ENV, BIZ_A, loadSnapshot()));
  await ensureStore(pos, storeSetup(ENV, BIZ_A, loadSnapshot())); // a second cold start changes nothing
  await ensureStore(pos, { ...storeSetup({ POS_OWNERS: "Other <owner@b.example>" }, BIZ_B), slug: "other" });
});

function register(businessId = BIZ_A): TestStore {
  const store = makeStore(pg as unknown as Database, { businessId, square: undefined });
  store.ctx.pos = createDb(pg);
  return store;
}

async function signInPos(store: TestStore, email = N8) {
  const sent = (await store.call("POST", "/api/pos/code", { email })).body as { devCode: string };
  const res = await store.call("POST", "/api/pos/session", { email, code: sent.devCode });
  expect(res.status).toBe(200);
  return { bbg_pos: /bbg_pos=([^;]+)/.exec(res.headers!["Set-Cookie"]!)![1]! };
}

let n = 0;
/** A new owner each time, so no one email runs into the five-codes-an-hour limit. */
async function signInOwner(store: TestStore) {
  const email = `owner${++n}@bearded.example`;
  await pg.query("INSERT INTO staff (business_id, name, email, role) VALUES ($1, $2, $3, 'owner')", [
    store.ctx.config.businessId,
    `Owner ${n}`,
    email,
  ]);
  return signInPos(store, email);
}

const call = (store: TestStore, jar: Record<string, string>, name: string, input?: unknown) =>
  store.call("POST", `/api/pos/call/${name}`, input === undefined ? {} : { input }, jar);

describe("register sign-in", () => {
  it("sends codes only to active staff, and the session cookie stays on /api/pos", async () => {
    const store = register();
    expect((await store.call("POST", "/api/pos/code", { email: "stranger@example.com" })).body).toEqual({
      sent: true,
    });
    expect(store.mail).toEqual([]);
    const jar = await signInPos(store, N8.toUpperCase());
    expect(store.mail[0]).toMatchObject({ to: N8, subject: expect.stringContaining("register code") });
    const res = await store.call("POST", "/api/pos/signout", undefined, jar);
    expect(res.headers!["Set-Cookie"]).toMatch(
      /^bbg_pos=; Path=\/api\/pos; HttpOnly; SameSite=Strict; Max-Age=0; Secure$/,
    );
    expect((await call(store, jar, "me")).status).toBe(401);
  });

  it("refuses a wrong code, and other sites' cookies", async () => {
    const store = register();
    await store.call("POST", "/api/pos/code", { email: N8 });
    expect((await store.call("POST", "/api/pos/session", { email: N8, code: "000000" })).status).toBe(401);
    expect((await call(store, {}, "me")).body).toEqual({ error: "Sign in to use the register." });
    const staff = await signInStaff(store);
    expect((await call(store, { bbg_pos: staff.bbg_staff }, "me")).status).toBe(401);
  });

  it("ends the session when the staff member is made inactive", async () => {
    const store = register();
    const owner = await signInOwner(store);
    const added = (
      await call(store, owner, "addStaff", { name: "Casey", email: "casey@example.com", role: "cashier" })
    ).body as { output: { id: string } };
    const casey = await signInPos(store, "casey@example.com");
    expect((await call(store, casey, "me")).status).toBe(200);
    await call(store, owner, "updateStaff", {
      id: added.output.id,
      name: "Casey",
      email: "casey@example.com",
      role: "cashier",
      active: false,
    });
    expect((await call(store, casey, "me")).status).toBe(401);
  });
});

describe("register calls", () => {
  it("knows who is signed in, from the session", async () => {
    const store = register();
    const jar = await signInPos(store);
    const me = (await call(store, jar, "me")).body as {
      output: { staff: { name: string; role: string }; business: { name: string } };
    };
    expect(me.output.staff).toMatchObject({ name: "N8", role: "owner" });
    expect(me.output.business.name).toBe("Bearded Board Games");
  });

  it("checks the role, and answers with the sentence to show", async () => {
    const store = register();
    const owner = await signInOwner(store);
    await call(store, owner, "addStaff", { name: "Robin", email: "robin@example.com", role: "cashier" });
    const robin = await signInPos(store, "robin@example.com");
    const res = await call(store, robin, "updateSettings", {});
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: "forbidden", error: expect.any(String) });
    const bad = await call(store, owner, "addStaff", { name: "", email: "x@example.com", role: "cashier" });
    expect(bad).toMatchObject({
      status: 400,
      body: { code: "invalid", fields: { name: "Name is required." } },
    });
  });

  it("only calls the register's own handlers", async () => {
    const store = register();
    const jar = await signInOwner(store);
    for (const name of ["constructor", "toString", "hasOwnProperty", "__proto__", "me/../x"])
      expect((await call(store, jar, name)).status).toBe(404);
    expect((await store.call("GET", "/api/pos/call/me", undefined, jar)).status).toBe(405);
  });

  it("is off when the register isn't hosted here", async () => {
    const store = makeStore(pg as unknown as Database);
    expect((await store.call("POST", "/api/pos/code", { email: N8 })).status).toBe(404);
  });

  it("shelves the online store's items at 100 each in its colors, and a cash sale takes one off", async () => {
    const store = register();
    const jar = await signInOwner(store);
    type Row = { id: string; onHand: number; name: string; sku: string; active: boolean };
    const products = ((await call(store, jar, "listProducts", {})).body as { output: Row[] }).output;
    const shelf = storeItems(loadSnapshot());
    expect(shelf.map((p) => p.name)).toContain("Fences");
    expect(products.map((p) => p.name).sort()).toEqual(shelf.map((p) => p.name).sort());
    for (const p of products) expect(p.onHand).toBe(100);
    // The (DEMO) samples are archived, not deleted.
    const all = (
      (await call(store, jar, "listProducts", { includeArchived: true })).body as { output: Row[] }
    ).output;
    const samples = all.filter((p) => p.name.includes("(DEMO)"));
    expect(samples.length).toBeGreaterThan(0);
    for (const p of samples) expect(p.active).toBe(false);
    const me = (
      (await call(store, jar, "me")).body as { output: { business: { brandColor: string; logo: string } } }
    ).output;
    expect(me.business.brandColor).toBe("#14614f");
    expect(me.business.logo).toMatch(/^data:image\/webp;base64,/);
    const game = products[0]!;
    const sale = (
      (
        await call(store, jar, "startCheckout", {
          customerId: null,
          lines: [{ key: "a", productId: game.id, qty: 1 }],
          discounts: [],
        })
      ).body as { output: CheckoutResult }
    ).output;
    const paid = (
      (
        await call(store, jar, "payCash", {
          saleId: sale.saleId,
          amountCents: sale.totalCents,
          tenderedCents: sale.totalCents,
        })
      ).body as { output: PaymentResult }
    ).output;
    expect(paid).toMatchObject({ paid: true, changeCents: 0 });
    const after = (
      (await call(store, jar, "getProduct", { id: game.id })).body as {
        output: { product: { onHand: number } };
      }
    ).output;
    expect(after.product.onHand).toBe(99);
  });

  it("keeps each business to its own rows", async () => {
    const a = register();
    const b = register(BIZ_B);
    const jarB = await signInPos(b, "owner@b.example");
    expect((await call(b, jarB, "me")).status).toBe(200);
    // A's owner has no staff row in B, and B's session means nothing in A.
    expect((await b.call("POST", "/api/pos/code", { email: N8 })).body).toEqual({ sent: true });
    expect((await call(a, jarB, "me")).status).toBe(401);
    await withBusiness(pg as unknown as Database, BIZ_B, async (sql) => {
      const { rows } = await sql.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM staff WHERE lower(email) = $1",
        [N8],
      );
      expect(rows[0]!.n).toBe(0);
    });
  });
});

describe("the store's setup", () => {
  it("reads the owners and the sample stock from the Lambda's settings", () => {
    expect(storeSetup(ENV, BIZ_A)).toMatchObject({
      owners: [
        { name: "N8", email: N8 },
        { name: "Adam", email: "adam@beardedboardgames.com" },
      ],
      demo: { openingStock: 100 },
      timezone: "America/Chicago",
    });
    expect(storeSetup({ POS_OWNERS: "N8 <n8@x.example>" }, BIZ_A).demo).toBe(false);
    expect(() => storeSetup({}, BIZ_A)).toThrow(/POS_OWNERS/);
  });
});
