import { beforeAll, describe, expect, it } from "vitest";
import type { CheckoutResponse, OrderView } from "@bearded/store-core";
import { withBusiness, type Database } from "../src/db.ts";
import { squareFor, LIVE_SQUARE_PLACEHOLDER, SQUARE_PLACEHOLDER } from "../src/lambda.ts";
import { handle } from "../src/router.ts";
import { SnapshotStore } from "../src/square/snapshot.ts";
import type { SquareStore } from "../src/square/types.ts";
import {
  eventOrderId,
  SIGNATURE_HEADER,
  squareSignature,
  validSquareSignature,
} from "../src/square/webhook.ts";
import { BIZ_A, freshDb, makeStore } from "./helpers.ts";

const RANCH = "CODAYIOIDBKGQPILID7GDBIT";
const KEY = "test-signature-key";
const URL_ = "https://store.test/api/square/webhook";

let db: Database;
beforeAll(async () => {
  db = await freshDb();
});

/** A Square that says the given orders are paid. */
function squareWithPaid(paid: Set<string>): SquareStore {
  return Object.assign(new SnapshotStore(), {
    mode: "live" as const,
    orderPaid: async (id: string) => paid.has(id),
  });
}

function paymentEvent(orderId: string) {
  return { type: "payment.updated", data: { type: "payment", object: { payment: { order_id: orderId } } } };
}

async function post(store: ReturnType<typeof makeStore>, event: unknown, signature?: string) {
  const raw = JSON.stringify(event);
  return handle(store.ctx, {
    method: "POST",
    path: "/api/square/webhook",
    query: new URLSearchParams(),
    headers: {
      "content-type": "application/json",
      [SIGNATURE_HEADER]: signature ?? squareSignature(KEY, URL_, raw),
    },
    cookies: {},
    body: event,
    rawBody: raw,
  });
}

/** An open website order tied to a Square order id. */
async function openOrder(squareOrderId: string): Promise<string> {
  const offline = makeStore(db);
  const { orderId } = (await offline.call("POST", "/api/checkout", { lines: [{ productId: RANCH, qty: 1 }] }))
    .body as CheckoutResponse;
  await withBusiness(db, BIZ_A, (sql) =>
    sql.query("UPDATE store_orders SET square_order_id = $1 WHERE id = $2", [squareOrderId, orderId]),
  );
  return orderId;
}

async function status(orderId: string) {
  return withBusiness(db, BIZ_A, async (sql) => {
    const { rows } = await sql.query<OrderView>("SELECT status FROM store_orders WHERE id = $1", [orderId]);
    return rows[0]?.status;
  });
}

describe("Square webhook signature", () => {
  it("matches Square's HMAC of the URL plus the body", () => {
    const sig = squareSignature("asdf1234", "https://example.com", '{"hello":"world"}');
    expect(validSquareSignature("asdf1234", "https://example.com", '{"hello":"world"}', sig)).toBe(true);
    expect(validSquareSignature("asdf1234", "https://example.com", '{"hello":"world!"}', sig)).toBe(false);
    expect(validSquareSignature("other", "https://example.com", '{"hello":"world"}', sig)).toBe(false);
    expect(validSquareSignature("asdf1234", "https://example.com", "{}", undefined)).toBe(false);
  });

  it("finds the order id in payment and order events", () => {
    expect(eventOrderId(paymentEvent("SQ1"))).toBe("SQ1");
    expect(eventOrderId({ data: { object: { order_updated: { order_id: "SQ2" } } } })).toBe("SQ2");
    expect(eventOrderId({ data: { object: { refund: {} } } })).toBeUndefined();
    expect(eventOrderId(null)).toBeUndefined();
  });
});

describe("Square webhook", () => {
  const config = { squareWebhook: { signatureKey: KEY, url: URL_ } };

  it("is off until its key is set", async () => {
    const store = makeStore(db);
    expect((await post(store, paymentEvent("x"))).status).toBe(404);
  });

  it("refuses a bad signature and changes nothing", async () => {
    const orderId = await openOrder("SQ-BAD");
    const store = makeStore(db, { square: squareWithPaid(new Set(["SQ-BAD"])), config });
    expect((await post(store, paymentEvent("SQ-BAD"), "bm9wZQ==")).status).toBe(403);
    expect(await status(orderId)).toBe("open");
  });

  it("marks the order paid once Square says it's paid, and only once", async () => {
    const paid = new Set<string>();
    const orderId = await openOrder("SQ-OK");
    const store = makeStore(db, { square: squareWithPaid(paid), config });
    // The body alone never marks an order: Square must say it's paid.
    expect((await post(store, paymentEvent("SQ-OK"))).status).toBe(200);
    expect(await status(orderId)).toBe("open");
    paid.add("SQ-OK");
    expect((await post(store, paymentEvent("SQ-OK"))).status).toBe(200);
    expect(await status(orderId)).toBe("paid");
    expect((await post(store, paymentEvent("SQ-OK"))).status).toBe(200);
    expect(await status(orderId)).toBe("paid");
  });

  it("answers 200 for orders that aren't ours, so Square stops retrying", async () => {
    const store = makeStore(db, { square: squareWithPaid(new Set(["COUNTER"])), config });
    expect((await post(store, paymentEvent("COUNTER"))).status).toBe(200);
    expect((await post(store, { type: "refund.updated", data: { object: {} } })).status).toBe(200);
  });

  it("keeps each business's orders apart", async () => {
    const orderId = await openOrder("SQ-A");
    const other = makeStore(db, {
      businessId: "bbbbbbbb-0000-4000-8000-000000000002",
      square: squareWithPaid(new Set(["SQ-A"])),
      config,
    });
    expect((await post(other, paymentEvent("SQ-A"))).status).toBe(200);
    expect(await status(orderId)).toBe("open");
  });
});

describe("choosing Square in the hosted store", () => {
  it("runs the demo on the saved catalog until the Sandbox token is pasted", () => {
    expect(squareFor("sandbox", SQUARE_PLACEHOLDER).mode).toBe("offline");
    expect(squareFor("sandbox", "token").mode).toBe("sandbox");
  });

  it("never runs the live store offline", () => {
    expect(() => squareFor("live", LIVE_SQUARE_PLACEHOLDER)).toThrow(/production token/);
    expect(() => squareFor("live", SQUARE_PLACEHOLDER)).toThrow(/production token/);
    expect(() => squareFor("live", '{"token":"x"}')).toThrow(/plain text/);
    expect(squareFor("live", " real-token\n").mode).toBe("live");
  });
});

describe("the Square line on Behind the Beard", () => {
  it("is for staff only and names the shop", async () => {
    const { signInStaff } = await import("./helpers.ts");
    const square = Object.assign(new SnapshotStore(), {
      mode: "live" as const,
      account: async () => ({ merchant: "Bearded Board Games", location: "St. Louis" }),
    });
    const store = makeStore(db, { square });
    expect((await store.call("GET", "/api/staff/square")).status).toBe(401);
    // Codes only come back on screen offline, so sign in there; the session is in the shared database.
    const cookies = await signInStaff(makeStore(db));
    const res = await store.call("GET", "/api/staff/square", undefined, cookies);
    expect(res.body).toEqual({ mode: "live", merchant: "Bearded Board Games", location: "St. Louis" });
  });
});
