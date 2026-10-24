import { beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../src/db.ts";
import { isStaffEmail } from "../src/handlers/staff.ts";
import { SnapshotStore } from "../src/square/snapshot.ts";
import { freshDb, makeStore, signInStaff } from "./helpers.ts";

let db: Database;
beforeAll(async () => {
  db = await freshDb();
});

describe("Behind the Beard sign-in", () => {
  it("knows who is staff", () => {
    const config = {
      businessId: "",
      siteUrl: "",
      secureCookies: true,
      staff: ["adam@beardedboardgames.com", "@prismcortex.net"],
    };
    expect(isStaffEmail(config, "Adam@BeardedBoardGames.com")).toBe(true);
    expect(isStaffEmail(config, "n8@prismcortex.net")).toBe(true);
    expect(isStaffEmail(config, "n8@notprismcortex.net.evil.com")).toBe(false);
    expect(isStaffEmail(config, "eve@example.com")).toBe(false);
  });

  it("answers the same for strangers, without a code", async () => {
    const store = makeStore(db);
    const res = await store.call("POST", "/api/staff/code", { email: "eve@example.com" });
    expect(res.body).toEqual({ sent: true });
    expect(store.mail).toEqual([]);
  });

  it("emails a code, and shows it on screen only offline", async () => {
    const store = makeStore(db);
    const res = await store.call("POST", "/api/staff/code", { email: "n8@prismcortex.net" });
    expect(res.body).toMatchObject({ sent: true, devCode: expect.stringMatching(/^\d{6}$/) });
    expect(store.mail[0]!.subject).toContain((res.body as { devCode: string }).devCode);
    const live = makeStore(db, { square: Object.assign(new SnapshotStore(), { mode: "live" as const }) });
    expect((await live.call("POST", "/api/staff/code", { email: "n8@prismcortex.net" })).body).toEqual({
      sent: true,
    });
  });

  it("signs in with the code once, into a secure cookie", async () => {
    const store = makeStore(db);
    const { devCode } = (await store.call("POST", "/api/staff/code", { email: "adam@beardedboardgames.com" }))
      .body as { devCode: string };
    const res = await store.call("POST", "/api/staff/session", {
      email: "adam@beardedboardgames.com",
      code: devCode,
    });
    expect(res.status).toBe(200);
    expect(res.headers!["Set-Cookie"]).toMatch(
      /^bbg_staff=[\w-]{40,}; Path=\/api\/staff; HttpOnly; SameSite=Strict; Max-Age=43200; Secure$/,
    );
    const again = await store.call("POST", "/api/staff/session", {
      email: "adam@beardedboardgames.com",
      code: devCode,
    });
    expect(again.status).toBe(401);
  });

  it("locks a code after five wrong tries", async () => {
    const store = makeStore(db);
    const email = "lock@prismcortex.net";
    const { devCode } = (await store.call("POST", "/api/staff/code", { email })).body as { devCode: string };
    const wrong = devCode === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++)
      expect((await store.call("POST", "/api/staff/session", { email, code: wrong })).status).toBe(401);
    expect((await store.call("POST", "/api/staff/session", { email, code: devCode })).status).toBe(401);
  });

  it("keeps staff pages behind sign-in, and signs out", async () => {
    const store = makeStore(db);
    expect((await store.call("GET", "/api/staff/stats")).status).toBe(401);
    expect((await store.call("GET", "/api/staff/reviews")).status).toBe(401);
    expect((await store.call("GET", "/api/staff/me", undefined, { bbg_staff: "forged" })).status).toBe(401);
    const jar = await signInStaff(store);
    expect((await store.call("GET", "/api/staff/me", undefined, jar)).body).toEqual({
      email: "adam@beardedboardgames.com",
    });
    await store.call("POST", "/api/staff/signout", {}, jar);
    expect((await store.call("GET", "/api/staff/me", undefined, jar)).status).toBe(401);
  });

  it("drops access as soon as someone leaves the staff list", async () => {
    const store = makeStore(db);
    const jar = await signInStaff(store, "temp@prismcortex.net");
    const later = makeStore(db, { config: { staff: ["adam@beardedboardgames.com"] } });
    expect((await later.call("GET", "/api/staff/me", undefined, jar)).status).toBe(401);
  });
});
