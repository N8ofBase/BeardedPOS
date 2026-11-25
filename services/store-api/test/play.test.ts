// Games for Beard Buddies: only a signed-in Buddy gets the game; everyone else goes to its sign-in page.
import { gunzipSync } from "node:zlib";
import { beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../src/db.ts";
import { handle } from "../src/router.ts";
import { BIZ_B, freshDb, makeStore, signInStaff, type TestStore } from "./helpers.ts";

let db: Database;
beforeAll(async () => {
  db = await freshDb();
});

async function signInBuddy(store: TestStore, email = "player@example.com") {
  const code = (await store.call("POST", "/api/account/code", { email })).body as { devCode: string };
  const res = await store.call("POST", "/api/account/session", { email, code: code.devCode });
  return { bbg_buddy: /bbg_buddy=([^;]+)/.exec(res.headers!["Set-Cookie"]!)![1]! };
}

const text = (bytes: Uint8Array | undefined) => Buffer.from(bytes!).toString("utf8");

describe("Mine & Find for Beard Buddies", () => {
  it("sends a guest to the sign-in page instead of the game", async () => {
    const res = await makeStore(db).call("GET", "/api/play/mine-and-find");
    expect(res.status).toBe(302);
    expect(res.headers?.Location).toBe("/play/mine-and-find");
    expect(res.bytes).toBeUndefined();
  });

  it("doesn't let a made-up or expired session in", async () => {
    const res = await makeStore(db).call("GET", "/api/play/mine-and-find", undefined, { bbg_buddy: "nope" });
    expect(res.status).toBe(302);
  });

  it("doesn't count a staff session as a Buddy", async () => {
    const store = makeStore(db);
    const staff = await signInStaff(store);
    const res = await store.call("GET", "/api/play/mine-and-find", undefined, { bbg_buddy: staff.bbg_staff });
    expect(res.status).toBe(302);
  });

  it("gives a signed-in Buddy the game, never cached", async () => {
    const store = makeStore(db);
    const res = await store.call("GET", "/api/play/mine-and-find", undefined, await signInBuddy(store));
    expect(res.status).toBe(200);
    expect(res.headers?.["Content-Type"]).toBe("text/html; charset=utf-8");
    expect(res.headers?.["Cache-Control"]).toBe("private, no-store");
    expect(res.headers?.["Content-Encoding"]).toBeUndefined();
    expect(text(res.bytes)).toContain("<title>Mine & Find");
  });

  it("gzips the game when the browser accepts it", async () => {
    const store = makeStore(db);
    const jar = await signInBuddy(store, "zip@example.com");
    const res = await handle(store.ctx, {
      method: "GET",
      path: "/api/play/mine-and-find",
      query: new URLSearchParams(),
      headers: { "accept-encoding": "gzip, deflate, br" },
      cookies: jar,
      body: undefined,
    });
    expect(res.headers?.["Content-Encoding"]).toBe("gzip");
    expect(gunzipSync(res.bytes!).toString("utf8")).toContain("<!DOCTYPE html>");
    expect(res.bytes!.length).toBeLessThan(gunzipSync(res.bytes!).length);
  });

  it("only knows the games it lists", async () => {
    const store = makeStore(db);
    const jar = await signInBuddy(store);
    for (const slug of ["nothing", "..%2Fpackage.json", "constructor", "__proto__"])
      expect((await store.call("GET", `/api/play/${slug}`, undefined, jar)).status).toBe(404);
  });

  it("keeps businesses apart: another business's Buddy session doesn't open it", async () => {
    const a = makeStore(db);
    const jar = await signInBuddy(a, "a-only@example.com");
    const res = await makeStore(db, { businessId: BIZ_B }).call(
      "GET",
      "/api/play/mine-and-find",
      undefined,
      jar,
    );
    expect(res.status).toBe(302);
  });
});
