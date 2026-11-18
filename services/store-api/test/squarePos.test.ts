// The live register's card check against fake Square answers. Nothing here reaches Square.
import { describe, expect, it } from "vitest";
import { AppError } from "@bearded/core";
import { SquareApiStore } from "../src/square/live.ts";
import { orderProblem, SquarePosTerminal, type PosOrder } from "../src/square/pos.ts";
import { cardReaderFor } from "../src/lambda.ts";
import { SnapshotStore } from "../src/square/snapshot.ts";

const LOC = "LBEARDED";
const since = new Date("2026-11-18T20:00:00Z");

const order = (over: Partial<PosOrder> = {}, tender: object = {}): PosOrder => ({
  id: "T1",
  location_id: LOC,
  state: "COMPLETED",
  created_at: "2026-11-18T20:01:00Z",
  tenders: [
    {
      id: "PAY1",
      type: "CARD",
      amount_money: { amount: 2675, currency: "USD" },
      card_details: { status: "CAPTURED" },
      ...tender,
    },
  ],
  ...over,
});
const expectFor = { amountCents: 2675, locationId: LOC, since };

describe("orderProblem", () => {
  it("accepts a captured card payment of exactly the amount, at our location, after the hand-off", () => {
    expect(orderProblem(order(), expectFor)).toBeNull();
  });
  it("leaves a tip added in the Square app out of the amount", () => {
    expect(
      orderProblem(order({}, { amount_money: { amount: 3075 }, tip_money: { amount: 400 } }), expectFor),
    ).toBeNull();
  });
  it("refuses another location, an older payment, the wrong amount, cash, splits and unfinished cards", () => {
    expect(orderProblem(order({ location_id: "LOTHER" }), expectFor)).toContain("another location");
    expect(orderProblem(order({ created_at: "2026-11-18T19:00:00Z" }), expectFor)).toContain("older");
    expect(orderProblem(order({}, { amount_money: { amount: 100 } }), expectFor)).toContain(
      "took $1.00, not $26.75",
    );
    expect(orderProblem(order({}, { type: "CASH" }), expectFor)).toContain("no card payment");
    expect(orderProblem(order({}, { card_details: { status: "AUTHORIZED" } }), expectFor)).toContain(
      "hasn't finished",
    );
    const split = order();
    split.tenders!.push({ id: "PAY2", type: "CASH", amount_money: { amount: 100 } });
    expect(orderProblem(split, expectFor)).toContain("split");
  });
});

function fakeSquare(routes: Record<string, (body: unknown) => unknown>) {
  const calls: { key: string; body: unknown }[] = [];
  const fetch = async (url: string, init: RequestInit) => {
    const key = `${init.method} ${new URL(url).pathname}`;
    const body = typeof init.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
    calls.push({ key, body });
    const route = routes[key];
    if (!route) return new Response(JSON.stringify({ errors: [{ code: "NOT_FOUND" }] }), { status: 404 });
    return new Response(JSON.stringify(route(body)), { status: 200 });
  };
  return { fetch, calls };
}

const terminal = (routes: Record<string, (body: unknown) => unknown>) => {
  const square = fakeSquare(routes);
  const api = new SquareApiStore({ mode: "live", token: "t", locationId: LOC, fetch: square.fetch });
  return {
    calls: square.calls,
    t: new SquarePosTerminal({
      api,
      applicationId: "sq0idp-abc",
      callbackUrl: "https://x/register/square-return",
      retryMs: 0,
    }),
  };
};

describe("SquarePosTerminal", () => {
  it("hands the screen the app id, return page and a fresh reference each time", async () => {
    const { t } = terminal({});
    const a = await t.charge(2675, "sale1", "Receipt #1");
    const b = await t.charge(2675, "sale1", "Receipt #1");
    expect(a.handoff).toMatchObject({ applicationId: "sq0idp-abc", amountCents: 2675, note: "Receipt #1" });
    expect(a.providerRef).toMatch(/^pos_[0-9a-f]{32}$/);
    expect(a.providerRef).not.toBe(b.providerRef);
  });

  it("confirms with Square's Orders API and returns the card payment id", async () => {
    const { t, calls } = terminal({ "GET /v2/orders/T1": () => ({ order: order() }) });
    await expect(t.confirm("T1", 2675, since)).resolves.toEqual({ paymentRef: "PAY1" });
    expect(calls.map((c) => c.key)).toEqual(["GET /v2/orders/T1"]);
  });

  it("waits a little for a brand-new transaction, then says Square doesn't know it", async () => {
    const { t, calls } = terminal({});
    await expect(t.confirm("T1", 2675, since)).rejects.toThrow("doesn't know");
    expect(calls).toHaveLength(3);
  });

  it("refuses odd transaction ids before asking Square", async () => {
    const { t, calls } = terminal({});
    await expect(t.confirm("../payments", 2675, since)).rejects.toBeInstanceOf(AppError);
    expect(calls).toHaveLength(0);
  });

  it("finds matching card payments since the hand-off started", async () => {
    const { t, calls } = terminal({
      "POST /v2/orders/search": () => ({
        orders: [order({ id: "T2" }, { amount_money: { amount: 999 } }), order({ id: "T3" })],
      }),
    });
    expect(await t.find(2675, since)).toEqual(["T3"]);
    expect(calls[0]!.body).toMatchObject({
      location_ids: [LOC],
      query: { filter: { date_time_filter: { created_at: { start_at: since.toISOString() } } } },
    });
  });

  it("refunds with Square's Refunds API, and says so plainly when Square refuses", async () => {
    const ok = terminal({ "POST /v2/refunds": () => ({ refund: { id: "R1" } }) });
    await expect(ok.t.refund("PAY1", 500)).resolves.toEqual({ refundRef: "R1" });
    expect(ok.calls[0]!.body).toMatchObject({
      payment_id: "PAY1",
      amount_money: { amount: 500, currency: "USD" },
    });
    const no = terminal({});
    await expect(no.t.refund("PAY1", 500)).rejects.toThrow("refund it in the Square app");
  });
});

describe("cardReaderFor", () => {
  const api = new SquareApiStore({ mode: "live", token: "t", locationId: LOC });
  it("uses the Square app only on the live store with an app id", () => {
    expect(cardReaderFor("live", api, "sq0idp-abc", "https://bbg-live.prismcortex.net")?.kind).toBe(
      "square-pos",
    );
    expect(cardReaderFor("live", api, "", "https://x")).toBeUndefined();
    expect(cardReaderFor("sandbox", api, "sq0idp-abc", "https://x")).toBeUndefined();
    expect(cardReaderFor("live", new SnapshotStore(), "sq0idp-abc", "https://x")).toBeUndefined();
  });
});
