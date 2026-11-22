// One Beard Buddy balance across the website and the counter, when the register shares the store's
// database: shoppers are joined to register customers by email, their website Bucks move over once,
// and sales rung only in the Square app earn by phone or email.
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { createDb, ensureStore, migrate as migrateRegister, PGLITE_OPTIONS } from "@bearded/db";
import type { CustomerBucks } from "@bearded/api";
import type { Account, OrderView, StaffBuddy } from "@bearded/store-core";
import { migrate as migrateStore, withBusiness, type Database } from "../src/db.ts";
import { joinAllBuddies } from "../src/loyalty.ts";
import { storeSetup } from "../src/register-postgres.ts";
import { creditSquareAppSale } from "../src/squareAppBucks.ts";
import { loadSnapshot } from "../src/square/snapshot.ts";
import type { SquareAppSale } from "../src/square/types.ts";
import { BIZ_A, BIZ_B, makeStore, signInStaff, type TestStore } from "./helpers.ts";

const RANCH = "CODAYIOIDBKGQPILID7GDBIT"; // $25
const ENV = { POS_OWNERS: "N8 <n8gr8@prismcortex.net>" };

let pg: PGlite;
let db: Database;
let n = 0;
const email = () => `joined${++n}@example.com`;

beforeAll(async () => {
  pg = new PGlite(PGLITE_OPTIONS);
  await migrateRegister(pg);
  db = pg as unknown as Database;
  await migrateStore(db);
  await ensureStore(createDb(pg), storeSetup(ENV, BIZ_A, loadSnapshot()));
  await ensureStore(createDb(pg), {
    ...storeSetup({ POS_OWNERS: "Other <owner@b.example>" }, BIZ_B),
    slug: "other",
  });
});

function store(businessId = BIZ_A): TestStore {
  const s = makeStore(db, { businessId });
  s.ctx.pos = createDb(pg);
  return s;
}

async function signInBuddy(s: TestStore, address = email()) {
  const code = (await s.call("POST", "/api/account/code", { email: address })).body as { devCode: string };
  const res = await s.call("POST", "/api/account/session", { email: address, code: code.devCode });
  expect(res.status).toBe(200);
  return { bbg_buddy: /bbg_buddy=([^;]+)/.exec(res.headers!["Set-Cookie"]!)![1]! };
}

let owners = 0;
async function signInOwner(s: TestStore) {
  const address = `joined-owner${++owners}@bearded.example`;
  await pg.query("INSERT INTO staff (business_id, name, email, role) VALUES ($1, $2, $3, 'owner')", [
    s.ctx.config.businessId,
    `Owner ${owners}`,
    address,
  ]);
  const sent = (await s.call("POST", "/api/pos/code", { email: address })).body as { devCode: string };
  const res = await s.call("POST", "/api/pos/session", { email: address, code: sent.devCode });
  return { bbg_pos: /bbg_pos=([^;]+)/.exec(res.headers!["Set-Cookie"]!)![1]! };
}

async function pos<T>(s: TestStore, jar: Record<string, string>, name: string, input: unknown): Promise<T> {
  const res = await s.call("POST", `/api/pos/call/${name}`, { input }, jar);
  expect(res.status).toBe(200);
  return (res.body as { output: T }).output;
}

async function registerCustomer(address: string, businessId = BIZ_A) {
  const { rows } = await pg.query<{ id: string; name: string; birthday: string | null }>(
    "SELECT id, name, birthday FROM customers WHERE business_id = $1 AND lower(email) = $2",
    [businessId, address],
  );
  return rows[0];
}

/** A customer added at the counter. */
async function addCustomer(c: { name: string; phone?: string; email?: string; birthday?: string }) {
  const { rows } = await pg.query<{ id: string }>(
    "INSERT INTO customers (business_id, name, phone, email, birthday) VALUES ($1, $2, $3, $4, $5) RETURNING id",
    [BIZ_A, c.name, c.phone ?? null, c.email ?? null, c.birthday ?? null],
  );
  return rows[0]!;
}

const account = async (s: TestStore, jar: Record<string, string>) =>
  (await s.call("GET", "/api/account", undefined, jar)).body as Account;

describe("one Beard Buddy balance", () => {
  it("makes a register customer for a new website Buddy, with the welcome gift on the register's ledger", async () => {
    const s = store();
    const address = email();
    const jar = await signInBuddy(s, address);
    expect((await account(s, jar)).balance).toBe(100);

    const customer = (await registerCustomer(address))!;
    expect(customer.name).toBe(address);
    const owner = await signInOwner(s);
    const bucks = await pos<CustomerBucks>(s, owner, "customerBucks", { customerId: customer.id });
    expect(bucks.balance).toBe(100);
    expect(bucks.history).toMatchObject([{ kind: "welcome", bucks: 100, note: "On the website" }]);

    // A name and birthday given online fill in the register's customer.
    await s.call("POST", "/api/account", { name: "Pat Buddy", birthday: "1990-03-04" }, jar);
    expect(await registerCustomer(address)).toMatchObject({ name: "Pat Buddy", birthday: "1990-03-04" });
  });

  it("shares Bucks both ways: the counter's show online, and a website order shows at the counter", async () => {
    const s = store();
    const address = email();
    const jar = await signInBuddy(s, address);
    const customer = (await registerCustomer(address))!;
    const owner = await signInOwner(s);
    await pos(s, owner, "adjustBucks", {
      customerId: customer.id,
      bucks: 150,
      note: "Bought at the counter",
    });

    const online = await account(s, jar);
    expect(online.balance).toBe(250);
    expect(online.history[0]).toMatchObject({ kind: "adjust", bucks: 150 });

    // Two rewards online ($10 off a $50 order) come out of the same balance the counter sees.
    const res = await s.call(
      "POST",
      "/api/checkout",
      { lines: [{ productId: RANCH, qty: 2 }], rewards: 2 },
      jar,
    );
    expect(res.status).toBe(200);
    const { orderId } = res.body as { orderId: string };
    expect((await account(s, jar)).balance).toBe(50); // held while the order is open
    const paid = (await s.call("POST", `/api/checkout-preview/${orderId}/pay`, {})).body as OrderView;
    expect(paid.status).toBe("paid");

    const counter = await pos<CustomerBucks>(s, owner, "customerBucks", { customerId: customer.id });
    expect(counter.balance).toBe(250 - 200 + 40);
    const note = `Website order #${orderId.slice(0, 8).toUpperCase()}`;
    expect(counter.history.filter((e) => e.note === note).map((e) => [e.kind, e.bucks])).toEqual(
      expect.arrayContaining([
        ["redeem", -200],
        ["earn", 40],
      ]),
    );
    expect((await account(s, jar)).balance).toBe(90);
    const status = (await s.call("GET", `/api/orders/${orderId}`, undefined, jar)).body as {
      bucks?: { earned: number; used: number };
    };
    expect(status.bucks).toMatchObject({ earned: 40, used: 200 });
  });

  it("joins a Buddy from before to the counter customer with the same email, adding both balances once", async () => {
    const s = store();
    const address = email();
    // A counter customer with 70 Bucks, and a website Buddy (same email, different case) with 130,
    // both from before the two were joined.
    const owner = await signInOwner(s);
    const counter = await addCustomer({ name: "Sam Counter", email: address.toUpperCase() });
    await pos(s, owner, "adjustBucks", { customerId: counter.id, bucks: 70, note: "Counter Bucks" });
    await withBusiness(db, BIZ_A, async (sql) => {
      const { rows } = await sql.query<{ id: string }>(
        "INSERT INTO store_customers (business_id, email) VALUES ($1, $2) RETURNING id",
        [BIZ_A, address],
      );
      await sql.query(
        `INSERT INTO store_loyalty_ledger (business_id, customer_id, kind, bucks) VALUES
           ($1, $2, 'welcome', 100), ($1, $2, 'adjust', 30)`,
        [BIZ_A, rows[0]!.id],
      );
    });

    const join = () => withBusiness(db, BIZ_A, joinAllBuddies);
    expect(await join()).toBeGreaterThanOrEqual(1);
    expect(await join()).toBe(0);
    const bucks = await pos<CustomerBucks>(s, owner, "customerBucks", { customerId: counter.id });
    expect(bucks.balance).toBe(200);
    expect(bucks.history.map((e) => e.kind).sort()).toEqual(["adjust", "adjust", "welcome"]);

    // Signing in later neither copies again nor gives a second welcome gift.
    const jar = await signInBuddy(s, address);
    expect((await account(s, jar)).balance).toBe(200);
    expect((await pos<CustomerBucks>(s, owner, "customerBucks", { customerId: counter.id })).balance).toBe(
      200,
    );
    expect((await registerCustomer(address))!.name).toBe("Sam Counter");

    const staff = await signInStaff(s);
    const buddies = (await s.call("GET", "/api/staff/buddies", undefined, staff)).body as StaffBuddy[];
    expect(buddies.find((b) => b.email === address)?.balance).toBe(200);
  });

  it("keeps each business's Buddies to its own customers", async () => {
    const address = email();
    await signInBuddy(store(BIZ_B), address);
    expect(await registerCustomer(address, BIZ_B)).toBeDefined();
    expect(await registerCustomer(address, BIZ_A)).toBeUndefined();
  });
});

describe("Square app sales", () => {
  let n = 0;
  const sale = (over: Partial<SquareAppSale> = {}): SquareAppSale => ({
    orderId: `SQ-ORDER-${++n}`,
    paymentIds: [`SQ-PAY-${n}`],
    notes: [],
    netCents: 4_250,
    customer: null,
    ...over,
  });
  const credit = (s: SquareAppSale, today = "2026-11-22") =>
    withBusiness(db, BIZ_A, (sql) => creditSquareAppSale(sql, BIZ_A, s, today));
  const balance = async (id: string) =>
    (
      await withBusiness(db, BIZ_A, (sql) =>
        sql.query<{ n: number }>(
          "SELECT coalesce(sum(bucks), 0)::int AS n FROM loyalty_ledger WHERE customer_id = $1",
          [id],
        ),
      )
    ).rows[0]!.n;

  const counterCustomer = (over: { phone?: string; email?: string; birthday?: string } = {}) =>
    addCustomer({ name: "Square Shopper", ...over });

  it("earns Bucks once for the customer matched by phone, with the birthday gift when due", async () => {
    const c = await counterCustomer({ phone: "3145550111", birthday: "1988-11-02" });
    const s = sale({ customer: { phone: "+1 314-555-0111", email: null } });
    expect(await credit(s)).toBe("credited");
    expect(await credit(s)).toBe("already");
    expect(await balance(c.id)).toBe(42 + 100);
  });

  it("matches by email when the phone doesn't match", async () => {
    const address = email();
    const c = await counterCustomer({ email: address });
    expect(await credit(sale({ customer: { phone: "6365550199", email: address.toUpperCase() } }))).toBe(
      "credited",
    );
    expect(await balance(c.id)).toBe(42);
  });

  it("leaves register sales, sales with no customer and strangers alone", async () => {
    const address = email();
    const c = await counterCustomer({ email: address });
    const customer = { phone: null, email: address };
    expect(await credit(sale({ customer, notes: ["Receipt #12"] }))).toBe("register_sale");
    expect(await credit(sale())).toBe("no_customer");
    expect(await credit(sale({ customer: { phone: null, email: "nobody@example.com" } }))).toBe("no_match");
    expect(await balance(c.id)).toBe(0);
  });
});
