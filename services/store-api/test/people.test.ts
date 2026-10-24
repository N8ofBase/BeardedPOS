import { beforeAll, describe, expect, it } from "vitest";
import type { Review, StaffReview } from "@bearded/store-core";
import type { Database } from "../src/db.ts";
import { withBusiness } from "../src/db.ts";
import { REVIEWS_PER_HOUR } from "../src/handlers/people.ts";
import { BIZ_A, BIZ_B, freshDb, makeStore, signInStaff } from "./helpers.ts";

let db: Database;
beforeAll(async () => {
  db = await freshDb();
});

const review = (over: Record<string, unknown> = {}) => ({
  game: "fences",
  stars: 5,
  headline: "Sheep drama",
  body: "We fought over the cows all night.",
  name: "Sam R.",
  email: "sam@example.com",
  joinVip: false,
  website: "",
  ...over,
});

describe("VIP signup", () => {
  it("saves each email once", async () => {
    const store = makeStore(db);
    expect((await store.call("POST", "/api/vip", { email: "Pat@Example.com", source: "popup" })).status).toBe(
      200,
    );
    expect((await store.call("POST", "/api/vip", { email: "pat@example.com" })).status).toBe(200);
    const rows = await withBusiness(db, BIZ_A, (sql) =>
      sql.query<{ source: string }>(
        "SELECT source FROM store_vip_signups WHERE lower(email) = 'pat@example.com'",
      ),
    );
    expect(rows.rows).toEqual([{ source: "popup" }]);
  });

  it("refuses a mistyped email", async () => {
    const res = await makeStore(db).call("POST", "/api/vip", { email: "pat@example" });
    expect(res).toMatchObject({ status: 400, body: { error: expect.stringContaining("Check the email") } });
  });
});

describe("reviews", () => {
  it("holds new reviews for approval and never shows emails", async () => {
    const store = makeStore(db);
    expect((await store.call("POST", "/api/reviews", review({ email: "hold@example.com" }))).status).toBe(
      202,
    );
    expect(store.mail[0]).toEqual({
      to: "adam@beardedboardgames.com",
      subject: "A new review is waiting in Behind the Beard",
    });
    expect((await store.call("GET", "/api/reviews")).body).toEqual([]);

    const jar = await signInStaff(store);
    const pending = (await store.call("GET", "/api/staff/reviews?status=pending", undefined, jar))
      .body as StaffReview[];
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ email: "hold@example.com", status: "pending", boughtFromUs: false });

    expect(
      (await store.call("POST", `/api/staff/reviews/${pending[0]!.id}`, { action: "feature" }, jar)).status,
    ).toBe(204);
    const shown = (await store.call("GET", "/api/reviews")).body as Review[];
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({ headline: "Sheep drama", featured: true, name: "Sam R." });
    expect(JSON.stringify(shown)).not.toContain("hold@example.com");

    await store.call("POST", `/api/staff/reviews/${pending[0]!.id}`, { action: "hide" }, jar);
    expect((await store.call("GET", "/api/reviews")).body).toEqual([]);
  });

  it("thanks bots and keeps nothing", async () => {
    const store = makeStore(db);
    const res = await store.call(
      "POST",
      "/api/reviews",
      review({ email: "bot@example.com", website: "http://spam.example" }),
    );
    expect(res.status).toBe(202);
    const n = await withBusiness(db, BIZ_A, (sql) =>
      sql.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM store_reviews WHERE email = 'bot@example.com'",
      ),
    );
    expect(n.rows[0]!.n).toBe(0);
  });

  it("repeats the site's checks", async () => {
    const res = await makeStore(db).call("POST", "/api/reviews", review({ stars: 9 }));
    expect(res).toEqual({ status: 400, body: { error: "Pick 1 to 5 stars." } });
    const game = await makeStore(db).call("POST", "/api/reviews", review({ game: "monopoly" }));
    expect(game.status).toBe(400);
  });

  it(`takes ${REVIEWS_PER_HOUR} reviews an hour from one email`, async () => {
    const store = makeStore(db);
    for (let i = 0; i < REVIEWS_PER_HOUR; i++)
      expect((await store.call("POST", "/api/reviews", review({ email: "busy@example.com" }))).status).toBe(
        202,
      );
    const res = await store.call("POST", "/api/reviews", review({ email: "BUSY@example.com" }));
    expect(res.status).toBe(429);
  });

  it("can add the reviewer to the VIP list", async () => {
    await makeStore(db).call("POST", "/api/reviews", review({ email: "fan@example.com", joinVip: true }));
    const rows = await withBusiness(db, BIZ_A, (sql) =>
      sql.query<{ source: string }>("SELECT source FROM store_vip_signups WHERE email = 'fan@example.com'"),
    );
    expect(rows.rows).toEqual([{ source: "review" }]);
  });
});

describe("separation between businesses", () => {
  it("never shows one business's reviews or signups to another", async () => {
    const a = makeStore(db, { businessId: BIZ_A });
    const b = makeStore(db, { businessId: BIZ_B });
    await a.call("POST", "/api/reviews", review({ email: "a-only@example.com" }));
    const jarB = await signInStaff(b);
    const seenByB = (await b.call("GET", "/api/staff/reviews?status=pending", undefined, jarB))
      .body as StaffReview[];
    expect(seenByB.find((r) => r.email === "a-only@example.com")).toBeUndefined();
    // A staff session from business A doesn't open business B.
    const jarA = await signInStaff(a);
    expect((await b.call("GET", "/api/staff/me", undefined, jarA)).status).toBe(401);
  });

  it("row-level security hides every row when no business is set", async () => {
    const rows = await db.transaction(async (tx) => {
      await tx.exec("SET LOCAL ROLE pos_app");
      return (await tx.query<{ n: number }>("SELECT count(*)::int AS n FROM store_reviews")).rows[0]!.n;
    });
    expect(rows).toBe(0);
  });

  it("refuses rows written for another business", async () => {
    await expect(
      withBusiness(db, BIZ_A, (sql) =>
        sql.query(
          "INSERT INTO store_vip_signups (business_id, email, source) VALUES ($1, 'x@example.com', 'band')",
          [BIZ_B],
        ),
      ),
    ).rejects.toThrow();
  });
});
