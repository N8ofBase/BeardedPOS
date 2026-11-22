import { beforeAll, describe, expect, it } from "vitest";
import type { PublishedSite, StaffSite } from "@bearded/store-core";
import type { Database } from "../src/db.ts";
import { serve } from "../src/lambda.ts";
import { sniffImage } from "../src/handlers/site.ts";
import { BIZ_B, freshDb, makeStore, signInStaff } from "./helpers.ts";

let db: Database;
beforeAll(async () => {
  db = await freshDb();
});

// A 1×1 PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

describe("Site content", () => {
  it("is edited by staff only, and anyone can read what's published", async () => {
    const store = makeStore(db);
    expect((await store.call("GET", "/api/staff/site")).status).toBe(401);
    expect((await store.call("POST", "/api/staff/site/draft", { content: {} })).status).toBe(401);
    expect((await store.call("POST", "/api/staff/site/publish", {})).status).toBe(401);
    expect((await store.call("POST", "/api/staff/site/images", { data: "" })).status).toBe(401);
    const site = await store.call("GET", "/api/site");
    expect(site.status).toBe(200);
  });

  it("keeps a draft away from shoppers until it's published, then keeps every publish", async () => {
    const store = makeStore(db);
    const jar = await signInStaff(store);
    const before = (await store.call("GET", "/api/site")).body as PublishedSite;

    const saved = await store.call(
      "POST",
      "/api/staff/site/draft",
      { content: { "hero.title": "  Games build bridges.  ", "game.fences.badge": "" } },
      jar,
    );
    expect(saved.status).toBe(200);
    const draft = saved.body as StaffSite;
    expect(draft.draft).toEqual({ "hero.title": "Games build bridges.", "game.fences.badge": "" });
    expect(draft.draftBy).toBe("adam@beardedboardgames.com");
    expect((await store.call("GET", "/api/site")).body).toEqual(before);

    const published = await store.call("POST", "/api/staff/site/publish", {}, jar);
    expect(published.status).toBe(200);
    const after = published.body as StaffSite;
    expect(after.published).toEqual(draft.draft);
    expect(after.history[0]).toMatchObject({ by: "adam@beardedboardgames.com", changes: 2 });
    const live = (await store.call("GET", "/api/site")).body as PublishedSite;
    expect(live.content["hero.title"]).toBe("Games build bridges.");

    // Nothing new: nothing to publish.
    expect((await store.call("POST", "/api/staff/site/publish", {}, jar)).status).toBe(400);

    // Change it again, publish, then bring the first version back into the draft.
    await store.call("POST", "/api/staff/site/draft", { content: { "hero.title": "Roll for it." } }, jar);
    await store.call("POST", "/api/staff/site/publish", {}, jar);
    const list = (await store.call("GET", "/api/staff/site", undefined, jar)).body as StaffSite;
    expect(list.history).toHaveLength(2);
    const first = list.history[1]!;
    const restored = (await store.call("POST", `/api/staff/site/restore/${first.id}`, {}, jar))
      .body as StaffSite;
    expect(restored.draft["hero.title"]).toBe("Games build bridges.");
    expect(restored.published["hero.title"]).toBe("Roll for it.");
  });

  it("refuses fields that aren't on the site, empty required fields and unsafe links", async () => {
    const store = makeStore(db);
    const jar = await signInStaff(store);
    const draft = (content: unknown) => store.call("POST", "/api/staff/site/draft", { content }, jar);
    expect((await draft({ "game.monopoly.tagline": "Nope" })).status).toBe(400);
    expect((await draft({ "hero.title": "   " })).body).toEqual({ error: "Big headline can’t be empty." });
    expect((await draft({ "hero.title": "Two\nlines" })).status).toBe(400);
    expect((await draft({ "brand.socials.tiktok": "javascript:alert(1)" })).status).toBe(400);
    expect((await draft({ "notice.link": "//evil.example" })).status).toBe(400);
    expect((await draft({ "game.fences.status": "sold" })).status).toBe(400);
    expect((await draft({ "notice.align": "middle" })).status).toBe(400);
    expect((await draft({ "notice.spacing": "huge" })).status).toBe(400);
    expect((await draft({ "notice.align": "right", "notice.spacing": "roomy" })).status).toBe(200);
    expect((await draft({ "hero.lede": 5 })).status).toBe(400);
    expect((await draft({ "notice.link": "/shop", "notice.text": "Closed Thanksgiving." })).status).toBe(200);
  });

  it("keeps uploaded pictures, serves them, and won't point at one that wasn't uploaded", async () => {
    const store = makeStore(db);
    const jar = await signInStaff(store);
    const missing = "11111111-1111-4111-8111-111111111111";
    expect(
      (await store.call("POST", "/api/staff/site/draft", { content: { "game.fences.art": missing } }, jar))
        .status,
    ).toBe(400);

    const notImage = Buffer.from("<svg onload=alert(1)>").toString("base64");
    expect((await store.call("POST", "/api/staff/site/images", { data: notImage }, jar)).status).toBe(400);

    const up = await store.call("POST", "/api/staff/site/images", { data: PNG.toString("base64") }, jar);
    expect(up.status).toBe(201);
    const { id } = up.body as { id: string };
    const img = await store.call("GET", `/api/site/images/${id}`);
    expect(img.headers?.["Content-Type"]).toBe("image/png");
    expect(Buffer.from(img.bytes!).equals(PNG)).toBe(true);
    expect(
      (await store.call("POST", "/api/staff/site/draft", { content: { "game.fences.art": id } }, jar)).status,
    ).toBe(200);
    expect((await store.call("GET", "/api/site/images/not-an-id")).status).toBe(404);
  });

  it("sends pictures through Lambda as binary", async () => {
    const store = makeStore(db);
    const jar = await signInStaff(store);
    const { id } = (await store.call("POST", "/api/staff/site/images", { data: PNG.toString("base64") }, jar))
      .body as { id: string };
    const out = await serve(store.ctx, {
      rawPath: `/api/site/images/${id}`,
      requestContext: { http: { method: "GET" } },
    });
    expect(out.isBase64Encoded).toBe(true);
    expect(out.headers["Cache-Control"]).toContain("immutable");
    expect(Buffer.from(out.body!, "base64").equals(PNG)).toBe(true);
  });

  it("keeps each business's site to itself", async () => {
    const a = makeStore(db);
    const b = makeStore(db, { businessId: BIZ_B });
    const jarA = await signInStaff(a);
    const { id } = (await a.call("POST", "/api/staff/site/images", { data: PNG.toString("base64") }, jarA))
      .body as { id: string };
    expect((await b.call("GET", `/api/site/images/${id}`)).status).toBe(404);
    const jarB = await signInStaff(b);
    expect(
      (await b.call("POST", "/api/staff/site/draft", { content: { "game.fences.art": id } }, jarB)).status,
    ).toBe(400);
    expect(((await b.call("GET", "/api/site")).body as PublishedSite).content).toEqual({});
  });
});

describe("sniffImage", () => {
  it("knows PNG, JPEG and WebP by their first bytes", () => {
    expect(sniffImage(PNG)).toBe("image/png");
    expect(sniffImage(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImage(Buffer.from("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
    expect(sniffImage(Buffer.from("GIF89a"))).toBeNull();
  });
});
