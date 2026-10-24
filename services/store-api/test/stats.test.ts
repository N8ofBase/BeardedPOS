import { beforeAll, describe, expect, it } from "vitest";
import type { StoreStats } from "@bearded/store-core";
import type { Database } from "../src/db.ts";
import { withBusiness } from "../src/db.ts";
import { leftCarts } from "../src/handlers/stats.ts";
import { BIZ_A, freshDb, makeStore, signInStaff } from "./helpers.ts";

const RANCH = "CODAYIOIDBKGQPILID7GDBIT";
const LOCKED_OUT = "NJ65T37BVFHTAAFBCEXI7KNX";

let db: Database;
beforeAll(async () => {
  db = await freshDb();
});

const h = (hours: number) => new Date(Date.UTC(2026, 9, 24, 12) + hours * 3600_000);
const names = new Map([[RANCH, "Fences: The Ranch"]]);

describe("left carts", () => {
  const add = (visitor_id: string, at: Date, qty = 1, product_id = RANCH) => ({
    visitor_id,
    type: "cart_add" as const,
    product_id,
    qty,
    at,
  });

  it("counts a cart left more than a day with no paid order", () => {
    const out = leftCarts([add("v1", h(0), 2)], [], h(30), names);
    expect(out).toEqual([
      {
        visitorId: "v1",
        lastActivity: h(0).toISOString(),
        items: [{ name: "Fences: The Ranch", qty: 2 }],
        stoppedAt: "cart",
      },
    ]);
  });

  it("waits a day before calling it left", () => {
    expect(leftCarts([add("v1", h(0))], [], h(20), names)).toEqual([]);
  });

  it("skips carts that were paid or emptied", () => {
    const paid = [{ visitor_id: "v1", status: "paid", created_at: h(1), paid_at: h(1) }];
    expect(leftCarts([add("v1", h(0))], paid, h(40), names)).toEqual([]);
    const emptied = [
      add("v2", h(0)),
      { visitor_id: "v2", type: "cart_remove" as const, product_id: RANCH, qty: null, at: h(1) },
    ];
    expect(leftCarts(emptied, [], h(40), names)).toEqual([]);
  });

  it("says when they got as far as Square's page", () => {
    const open = [{ visitor_id: "v1", status: "open", created_at: h(1), paid_at: null }];
    expect(leftCarts([add("v1", h(0))], open, h(40), names)[0]!.stoppedAt).toBe("checkout");
  });

  it("counts a new cart after an earlier paid order", () => {
    const paid = [{ visitor_id: "v1", status: "paid", created_at: h(0), paid_at: h(0) }];
    expect(leftCarts([add("v1", h(2))], paid, h(40), names)).toHaveLength(1);
  });

  it("follows quantity changes", () => {
    const events = [
      add("v1", h(0), 1),
      { visitor_id: "v1", type: "cart_qty" as const, product_id: RANCH, qty: 4, at: h(1) },
    ];
    expect(leftCarts(events, [], h(40), names)[0]!.items).toEqual([{ name: "Fences: The Ranch", qty: 4 }]);
  });
});

describe("stats", () => {
  it("logs clean events and reports them to staff", async () => {
    const store = makeStore(db);
    const res = await store.call("POST", "/api/events", {
      visitorId: "v-aaa",
      events: [
        { type: "page_view", path: "/", source: "instagram.com" },
        { type: "page_view", path: "/games/fences" },
        { type: "click", path: "/games/fences", label: "Rules (PDF)" },
        { type: "cart_add", path: "/games/fences", productId: RANCH, qty: 2 },
        { type: "popup_shown", path: "/" },
        { type: "roll", path: "/", label: "17" },
        { type: "evil", path: "/" },
        { type: "click", path: "javascript:alert(1)" },
      ],
    });
    expect(res.status).toBe(204);
    await store.call("POST", "/api/events", {
      visitorId: "v-bbb",
      events: [
        { type: "page_view", path: "/games/fences" },
        { type: "cart_add", path: "/shop", productId: LOCKED_OUT },
      ],
    });
    await store.call("POST", "/api/checkout", {
      lines: [{ productId: LOCKED_OUT, qty: 1 }],
      visitorId: "v-bbb",
    });

    const jar = await signInStaff(store);
    const stats = (await store.call("GET", "/api/staff/stats?days=7", undefined, jar)).body as StoreStats;
    expect(stats).toMatchObject({
      days: 7,
      visitors: 2,
      pageViews: 3,
      cartAdds: 3,
      checkoutsStarted: 1,
      ordersPaid: 0,
      rolls: 1,
      popup: { shown: 1, closed: 0, joined: 0 },
    });
    expect(stats.topGames).toEqual([{ label: "fences", count: 2 }]);
    expect(stats.topClicks).toEqual([{ label: "Rules (PDF)", count: 1 }]);
    expect(stats.sources).toEqual([
      { label: "Direct or unknown", count: 1 },
      { label: "instagram.com", count: 1 },
    ]);
    expect(stats.addsByProduct).toEqual([
      { label: "Fences: The Ranch", count: 2 },
      { label: "Locked Out", count: 1 },
    ]);
  });

  it("refuses junk batches", async () => {
    const store = makeStore(db);
    expect((await store.call("POST", "/api/events", { visitorId: "bad id!", events: [] })).status).toBe(400);
    expect((await store.call("POST", "/api/events", { events: [] })).status).toBe(400);
  });

  it("keeps events append-only for the app", async () => {
    await expect(withBusiness(db, BIZ_A, (sql) => sql.query("DELETE FROM store_events"))).rejects.toThrow();
    await expect(
      withBusiness(db, BIZ_A, (sql) => sql.query("UPDATE store_events SET label = 'x'")),
    ).rejects.toThrow();
  });
});
