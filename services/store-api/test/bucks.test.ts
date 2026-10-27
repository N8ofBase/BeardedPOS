// Beard Bucks on web orders: sign-in and the welcome gift, the reward at checkout, the hold, and the
// ledger once paid.
import { beforeAll, describe, expect, it } from "vitest";
import type { Account, CheckoutResponse, OrderStatus, OrderView, StaffBuddy } from "@bearded/store-core";
import { withBusiness, type Database } from "../src/db.ts";
import { storeToday } from "../src/loyalty.ts";
import { SnapshotStore } from "../src/square/snapshot.ts";
import type { SquareStore } from "../src/square/types.ts";
import { BIZ_B, freshDb, makeStore, signInStaff, type TestStore } from "./helpers.ts";

const LOCKED_OUT = "NJ65T37BVFHTAAFBCEXI7KNX"; // $20
const RANCH = "CODAYIOIDBKGQPILID7GDBIT"; // $25

let db: Database;
let n = 0;
const email = () => `buddy${++n}@example.com`;

beforeAll(async () => {
  db = await freshDb();
});

async function signInBuddy(store: TestStore, address = email()) {
  const code = (await store.call("POST", "/api/account/code", { email: address })).body as {
    devCode: string;
  };
  const res = await store.call("POST", "/api/account/session", { email: address, code: code.devCode });
  expect(res.status).toBe(200);
  const token = /bbg_buddy=([^;]+)/.exec(res.headers!["Set-Cookie"]!)![1]!;
  return { jar: { bbg_buddy: token }, email: address };
}

/** Gives a shopper Bucks the way staff would: an adjust entry in the ledger. */
async function give(address: string, bucks: number, businessId = "aaaaaaaa-0000-4000-8000-000000000001") {
  await withBusiness(db, businessId, async (sql) => {
    const { rows } = await sql.query<{ id: string }>("SELECT id FROM store_customers WHERE email = $1", [
      address,
    ]);
    await sql.query(
      "INSERT INTO store_loyalty_ledger (business_id, customer_id, kind, bucks) VALUES ($1, $2, 'adjust', $3)",
      [businessId, rows[0]!.id, bucks],
    );
  });
}

const account = async (store: TestStore, jar: Record<string, string>) =>
  (await store.call("GET", "/api/account", undefined, jar)).body as Account;

async function checkout(store: TestStore, jar: Record<string, string>, lines: object[], rewards?: number) {
  return store.call("POST", "/api/checkout", { lines, ...(rewards === undefined ? {} : { rewards }) }, jar);
}

async function payOffline(store: TestStore, orderId: string) {
  return (await store.call("POST", `/api/checkout-preview/${orderId}/pay`, {})).body as OrderView;
}

describe("Beard Buddy sign-in", () => {
  it("lets any email join with a code, into its own cookie", async () => {
    const store = makeStore(db);
    const address = email();
    const sent = await store.call("POST", "/api/account/code", { email: address });
    expect(sent.body).toMatchObject({ sent: true, devCode: expect.stringMatching(/^\d{6}$/) });
    expect(store.mail[0]).toMatchObject({
      to: address,
      subject: expect.stringContaining("Beard Buddy code"),
    });
    const res = await store.call("POST", "/api/account/session", {
      email: address.toUpperCase(),
      code: (sent.body as { devCode: string }).devCode,
    });
    expect(res.headers!["Set-Cookie"]).toMatch(
      /^bbg_buddy=[\w-]{40,}; Path=\/api; HttpOnly; SameSite=Strict; Max-Age=2592000; Secure$/,
    );
    expect(res.body).toMatchObject({
      email: address,
      balance: 100,
      held: 0,
      history: [{ kind: "welcome", bucks: 100, orderId: null }],
      birthday: null,
      welcomeBucks: 100,
    });
  });

  it("gives the 100-Buck welcome gift once, on the first sign-in", async () => {
    const store = makeStore(db);
    const shopper = await signInBuddy(store);
    const again = await store.call("POST", "/api/account/session", {
      email: shopper.email,
      code: (
        (await store.call("POST", "/api/account/code", { email: shopper.email })).body as { devCode: string }
      ).devCode,
    });
    expect(again.body).toMatchObject({ balance: 100 });
    expect(again.body).not.toHaveProperty("welcomeBucks");
    expect((await account(store, shopper.jar)).history).toMatchObject([{ kind: "welcome", bucks: 100 }]);
    // Even written by hand, a second welcome gift is refused.
    await expect(
      withBusiness(db, store.ctx.config.businessId, async (sql) => {
        await sql.query(
          `INSERT INTO store_loyalty_ledger (business_id, customer_id, kind, bucks)
           SELECT business_id, id, 'welcome', 100 FROM store_customers WHERE email = $1`,
          [shopper.email],
        );
      }),
    ).rejects.toThrow(/store_loyalty_ledger_welcome_once/);
  });

  it("lets the welcome Bucks take $5 off right away, on orders of $25 or more", async () => {
    const store = makeStore(db);
    const { jar } = await signInBuddy(store);
    expect(await checkout(store, jar, [{ productId: LOCKED_OUT, qty: 1 }], 1)).toMatchObject({
      status: 409,
      body: { error: "Beard Bucks work on orders of $25 or more. Check out without the reward." },
    });
    const { orderId } = (await checkout(store, jar, [{ productId: RANCH, qty: 1 }], 1))
      .body as CheckoutResponse;
    expect((await store.call("GET", `/api/checkout-preview/${orderId}`)).body).toMatchObject({
      subtotalCents: 2500,
      discountCents: 500,
    });
    await payOffline(store, orderId);
    expect((await store.call("GET", `/api/orders/${orderId}`, undefined, jar)).body).toEqual({
      status: "paid",
      bucks: { earned: 20, used: 100, birthday: 0, balance: 20 },
    });
  });

  it("never lets a shopper's session open Behind the Beard, or a staff session act as a shopper", async () => {
    const store = makeStore(db);
    const shopper = await signInBuddy(store, "n8@prismcortex.net");
    expect((await store.call("GET", "/api/staff/me", undefined, shopper.jar)).status).toBe(401);
    expect(
      (await store.call("GET", "/api/staff/me", undefined, { bbg_staff: shopper.jar.bbg_buddy })).status,
    ).toBe(401);
    const staff = await signInStaff(store);
    expect((await store.call("GET", "/api/account", undefined, { bbg_buddy: staff.bbg_staff })).status).toBe(
      401,
    );
  });

  it("keeps one business's shoppers out of another's store", async () => {
    const a = makeStore(db);
    const b = makeStore(db, { businessId: BIZ_B });
    const { jar } = await signInBuddy(a);
    expect((await b.call("GET", "/api/account", undefined, jar)).status).toBe(401);
    expect(
      (await b.call("POST", "/api/checkout", { lines: [{ productId: RANCH, qty: 1 }], rewards: 1 }, jar))
        .status,
    ).toBe(401);
  });

  it("signs out", async () => {
    const store = makeStore(db);
    const { jar } = await signInBuddy(store);
    expect((await store.call("POST", "/api/account/signout", {}, jar)).status).toBe(204);
    expect((await store.call("GET", "/api/account", undefined, jar)).status).toBe(401);
  });
});

describe("earning and spending Beard Bucks", () => {
  it("lets guests check out as before, with no Bucks and no rewards", async () => {
    const store = makeStore(db);
    const res = await checkout(store, {}, [{ productId: RANCH, qty: 1 }]);
    expect(res.status).toBe(200);
    const { orderId } = res.body as CheckoutResponse;
    await payOffline(store, orderId);
    expect((await store.call("GET", `/api/orders/${orderId}`)).body).toEqual({ status: "paid" });
    expect(await checkout(store, {}, [{ productId: RANCH, qty: 1 }], 1)).toMatchObject({
      status: 401,
      body: { error: "Sign in to use your Beard Bucks." },
    });
  });

  it("earns 1 Buck per whole dollar once paid, and shows the balance only to the shopper", async () => {
    const store = makeStore(db);
    const { jar } = await signInBuddy(store);
    const { orderId } = (
      await checkout(store, jar, [
        { productId: LOCKED_OUT, qty: 3 },
        { productId: RANCH, qty: 1 },
      ])
    ).body as CheckoutResponse;
    expect((await account(store, jar)).balance).toBe(100);
    await payOffline(store, orderId);
    expect((await store.call("GET", `/api/orders/${orderId}`, undefined, jar)).body).toEqual({
      status: "paid",
      bucks: { earned: 85, used: 0, birthday: 0, balance: 185 },
    });
    expect((await store.call("GET", `/api/orders/${orderId}`)).body).toEqual({
      status: "paid",
      bucks: { earned: 85, used: 0, birthday: 0 },
    });
    const acct = await account(store, jar);
    expect(acct.balance).toBe(185);
    expect(acct.history).toMatchObject([
      { kind: "earn", bucks: 85, orderId },
      { kind: "welcome", bucks: 100 },
    ]);
  });

  it("takes $5 off per 100 Bucks, holds them while open, and earns on what's left", async () => {
    const store = makeStore(db);
    const shopper = await signInBuddy(store);
    await give(shopper.email, 150); // 250 with the welcome gift
    const res = await checkout(
      store,
      shopper.jar,
      [
        { productId: LOCKED_OUT, qty: 3 },
        { productId: RANCH, qty: 1 },
      ],
      2,
    );
    const { orderId } = res.body as CheckoutResponse;
    const order = (await store.call("GET", `/api/checkout-preview/${orderId}`)).body as OrderView;
    expect(order).toMatchObject({ subtotalCents: 8500, discountCents: 1000 });
    expect(await account(store, shopper.jar)).toMatchObject({ balance: 50, held: 200 });
    // The held Bucks can't go into a second checkout.
    expect((await checkout(store, shopper.jar, [{ productId: RANCH, qty: 1 }], 1)).status).toBe(409);

    await payOffline(store, orderId);
    await payOffline(store, orderId); // a second report of the same payment changes nothing
    await store.call("GET", `/api/orders/${orderId}`, undefined, shopper.jar);
    const acct = await account(store, shopper.jar);
    expect(acct).toMatchObject({ balance: 125, held: 0 });
    expect(acct.history.map((e) => [e.kind, e.bucks]).sort()).toEqual([
      ["adjust", 150],
      ["earn", 75],
      ["redeem", -200],
      ["welcome", 100],
    ]);
  });

  it("needs $5 left on the order for each reward", async () => {
    const store = makeStore(db);
    const shopper = await signInBuddy(store);
    await give(shopper.email, 500);
    expect(await checkout(store, shopper.jar, [{ productId: RANCH, qty: 1 }], 6)).toMatchObject({
      status: 409,
      body: { error: "You can use 5 rewards on this order. Change it and check out again." },
    });
    expect((await checkout(store, shopper.jar, [{ productId: RANCH, qty: 1 }], 5)).status).toBe(200);
    expect((await checkout(store, shopper.jar, [{ productId: RANCH, qty: 1 }], -1)).status).toBe(400);
    expect((await checkout(store, shopper.jar, [{ productId: RANCH, qty: 1 }], 1.5)).status).toBe(400);
  });

  it("lets go of held Bucks after 24 hours, or when Square's page can't be made", async () => {
    const store = makeStore(db);
    const shopper = await signInBuddy(store); // the welcome gift's 100 Bucks
    const { orderId } = (await checkout(store, shopper.jar, [{ productId: RANCH, qty: 1 }], 1))
      .body as CheckoutResponse;
    expect((await account(store, shopper.jar)).balance).toBe(0);
    await withBusiness(db, store.ctx.config.businessId, (sql) =>
      sql.query("UPDATE store_orders SET created_at = now() - interval '25 hours' WHERE id = $1", [orderId]),
    );
    expect(await account(store, shopper.jar)).toMatchObject({ balance: 100, held: 0 });

    const broken: SquareStore = Object.assign(new SnapshotStore(), {
      createPaymentLink: async () => {
        throw new Error("Square is down");
      },
    });
    const down = makeStore(db, { square: broken });
    expect((await checkout(down, shopper.jar, [{ productId: RANCH, qty: 1 }], 1)).status).toBe(500);
    expect(await account(store, shopper.jar)).toMatchObject({ balance: 100, held: 0 });
  });

  it("puts the reward and the shopper's email on Square's payment page", async () => {
    const seen: Parameters<SquareStore["createPaymentLink"]>[0][] = [];
    const square: SquareStore = Object.assign(new SnapshotStore(), {
      createPaymentLink: async (order: Parameters<SquareStore["createPaymentLink"]>[0]) => {
        seen.push(order);
        return { url: "https://square.test/pay", squareOrderId: null, paymentLinkId: null };
      },
    });
    const store = makeStore(db, { square });
    const shopper = await signInBuddy(store);
    await checkout(store, shopper.jar, [{ productId: RANCH, qty: 1 }], 1);
    await checkout(store, {}, [{ productId: RANCH, qty: 1 }]);
    expect(seen[0]).toMatchObject({ discountCents: 500, buyerEmail: shopper.email, currency: "USD" });
    expect(seen[1]).toMatchObject({ discountCents: 0, buyerEmail: undefined });
  });
});

describe("the birthday gift", () => {
  const today = storeToday(new Date());
  const thisMonth = `1990-${today.slice(5, 7)}-01`;
  const otherMonth = `1990-${today.slice(5, 7) === "06" ? "07" : "06"}-01`;

  it("gives 100 Bucks on the first paid order in the birthday month, once a year", async () => {
    const store = makeStore(db);
    const { jar } = await signInBuddy(store);
    expect(
      (await store.call("POST", "/api/account", { name: " Rae ", birthday: thisMonth }, jar)).body,
    ).toMatchObject({
      name: "Rae",
      birthday: thisMonth,
      birthdayLocked: true,
    });
    const first = (await checkout(store, jar, [{ productId: RANCH, qty: 1 }])).body as CheckoutResponse;
    await payOffline(store, first.orderId);
    expect((await store.call("GET", `/api/orders/${first.orderId}`, undefined, jar)).body).toMatchObject({
      bucks: { earned: 25, birthday: 100, balance: 225 },
    });
    const second = (await checkout(store, jar, [{ productId: RANCH, qty: 1 }])).body as CheckoutResponse;
    await payOffline(store, second.orderId);
    expect((await store.call("GET", `/api/orders/${second.orderId}`, undefined, jar)).body).toMatchObject({
      bucks: { earned: 25, birthday: 0, balance: 250 },
    });
  });

  it("gives nothing outside the birthday month", async () => {
    const store = makeStore(db);
    const { jar } = await signInBuddy(store);
    await store.call("POST", "/api/account", { birthday: otherMonth }, jar);
    const { orderId } = (await checkout(store, jar, [{ productId: RANCH, qty: 1 }])).body as CheckoutResponse;
    await payOffline(store, orderId);
    expect(
      ((await store.call("GET", `/api/orders/${orderId}`, undefined, jar)).body as OrderStatus).bucks,
    ).toMatchObject({ birthday: 0 });
  });

  it("won't move a birthday again within a year, and refuses dates that haven't happened", async () => {
    const store = makeStore(db);
    const { jar } = await signInBuddy(store);
    await store.call("POST", "/api/account", { birthday: otherMonth }, jar);
    expect(await store.call("POST", "/api/account", { birthday: thisMonth }, jar)).toMatchObject({
      status: 409,
    });
    expect(await store.call("POST", "/api/account", { birthday: null }, jar)).toMatchObject({ status: 409 });
    // Saving the same date again, or just a name, is fine.
    expect(
      (await store.call("POST", "/api/account", { birthday: otherMonth, name: "Sam" }, jar)).status,
    ).toBe(200);
    const fresh = await signInBuddy(store);
    expect((await store.call("POST", "/api/account", { birthday: "2999-01-01" }, fresh.jar)).status).toBe(
      400,
    );
    expect((await store.call("POST", "/api/account", { birthday: "1990-02-30" }, fresh.jar)).status).toBe(
      400,
    );
  });
});

describe("Beard Buddies in Behind the Beard", () => {
  it("lists shoppers and their history for staff only", async () => {
    const store = makeStore(db);
    const shopper = await signInBuddy(store);
    await give(shopper.email, 40);
    expect((await store.call("GET", "/api/staff/buddies", undefined, shopper.jar)).status).toBe(401);
    const staff = await signInStaff(store);
    const list = (await store.call("GET", "/api/staff/buddies", undefined, staff)).body as StaffBuddy[];
    const row = list.find((b) => b.email === shopper.email)!;
    expect(row).toMatchObject({ balance: 140, paidOrders: 0, lastOrderAt: null });
    const history = await store.call("GET", `/api/staff/buddies/${row.id}`, undefined, staff);
    expect(history.body).toMatchObject([
      { kind: "adjust", bucks: 40 },
      { kind: "welcome", bucks: 100 },
    ]);
  });
});
