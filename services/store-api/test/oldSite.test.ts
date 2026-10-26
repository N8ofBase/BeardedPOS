import { beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../src/db.ts";
import { BIZ_B, freshDb, makeStore, signInStaff } from "./helpers.ts";

let db: Database;
beforeAll(async () => {
  db = await freshDb();
});

describe("Old site choices", () => {
  it("is for staff only", async () => {
    const store = makeStore(db);
    expect((await store.call("GET", "/api/staff/old-site")).status).toBe(401);
    expect((await store.call("POST", "/api/staff/old-site/adam-bio", { decision: "keep" })).status).toBe(401);
  });

  it("saves a call with a note and who made it, and a later call replaces it", async () => {
    const store = makeStore(db);
    const jar = await signInStaff(store);
    const first = await store.call(
      "POST",
      "/api/staff/old-site/fences-press",
      { decision: "update", note: "  Fix the typo in “easily”.  " },
      jar,
    );
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({
      itemId: "fences-press",
      decision: "update",
      note: "Fix the typo in “easily”.",
      by: "adam@beardedboardgames.com",
    });
    const n8 = await signInStaff(store, "n8@prismcortex.net");
    await store.call("POST", "/api/staff/old-site/fences-press", { decision: "keep", note: "" }, n8);
    const list = (await store.call("GET", "/api/staff/old-site", undefined, jar)).body as unknown[];
    expect(list).toEqual([
      expect.objectContaining({
        itemId: "fences-press",
        decision: "keep",
        note: "",
        by: "n8@prismcortex.net",
      }),
    ]);
  });

  it("refuses unknown items, unknown choices and long notes", async () => {
    const store = makeStore(db);
    const jar = await signInStaff(store);
    const post = (id: string, body: unknown) => store.call("POST", `/api/staff/old-site/${id}`, body, jar);
    expect((await post("not-an-item", { decision: "keep" })).status).toBe(404);
    expect((await post("adam-bio", { decision: "maybe" })).status).toBe(400);
    expect((await post("adam-bio", { decision: "keep", note: "x".repeat(1001) })).status).toBe(400);
  });

  it("keeps each business's calls to itself", async () => {
    const a = makeStore(db);
    await a.call("POST", "/api/staff/old-site/tim-bio", { decision: "drop" }, await signInStaff(a));
    const b = makeStore(db, { businessId: BIZ_B });
    const list = (await b.call("GET", "/api/staff/old-site", undefined, await signInStaff(b))).body as {
      itemId: string;
    }[];
    expect(list.map((c) => c.itemId)).not.toContain("tim-bio");
  });
});
