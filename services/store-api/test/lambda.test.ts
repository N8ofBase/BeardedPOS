import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../src/db.ts";
import { serve, type HttpEvent } from "../src/lambda.ts";
import { sesMailer, type SesEmail } from "../src/mailer.ts";
import { freshDb, makeStore } from "./helpers.ts";

let db: Database;
beforeAll(async () => {
  db = await freshDb();
});

const event = (method: string, path: string, over: Partial<HttpEvent> = {}): HttpEvent => ({
  rawPath: path,
  requestContext: { http: { method } },
  headers: { "content-type": "application/json" },
  ...over,
});

describe("Lambda adapter", () => {
  it("answers a request with JSON and no caching", async () => {
    const { ctx } = makeStore(db);
    const res = await serve(ctx, event("GET", "/api/reviews"));
    expect(res.statusCode).toBe(200);
    expect(res.headers).toMatchObject({ "Cache-Control": "no-store", "Content-Type": "application/json" });
    expect(JSON.parse(res.body!)).toEqual([]);
  });

  it("signs staff in through API Gateway's cookie lists, base64 bodies included", async () => {
    const { ctx } = makeStore(db);
    const email = "adam@beardedboardgames.com";
    const code = JSON.parse(
      (await serve(ctx, event("POST", "/api/staff/code", { body: JSON.stringify({ email }) }))).body!,
    ) as { devCode: string };
    const signIn = await serve(
      ctx,
      event("POST", "/api/staff/session", {
        body: Buffer.from(JSON.stringify({ email, code: code.devCode })).toString("base64"),
        isBase64Encoded: true,
      }),
    );
    expect(signIn.cookies).toHaveLength(1);
    const token = signIn.cookies![0]!.split(";")[0]!;
    const me = await serve(ctx, event("GET", "/api/staff/me", { cookies: [token, "other=1"] }));
    expect(JSON.parse(me.body!)).toEqual({ email });
  });

  it("turns a broken body into a plain 400", async () => {
    const { ctx } = makeStore(db);
    const res = await serve(ctx, event("POST", "/api/vip", { body: "{nope" }));
    expect(res.statusCode).toBe(400);
  });

  it("sends mail through SES as plain text", async () => {
    const sent: SesEmail[] = [];
    await sesMailer("Bearded Board Games <no-reply@bbg.prismcortex.net>", async (m) => sent.push(m)).send(
      "adam@beardedboardgames.com",
      "Your code",
      "It works for 10 minutes.",
    );
    expect(sent).toEqual([
      {
        FromEmailAddress: "Bearded Board Games <no-reply@bbg.prismcortex.net>",
        Destination: { ToAddresses: ["adam@beardedboardgames.com"] },
        Content: {
          Simple: { Subject: { Data: "Your code" }, Body: { Text: { Data: "It works for 10 minutes." } } },
        },
      },
    ]);
  });
});

describe("files the Lambda bundle copies", () => {
  it("has the RDS certificate bundle in the repo", () => {
    // *.pem is ignored for keys; this public bundle must still be committed or deploys fail.
    const pem = readFileSync(new URL("../certs/rds-global-bundle.pem", import.meta.url), "utf8");
    expect(pem.match(/BEGIN CERTIFICATE/g)?.length).toBeGreaterThan(10);
    expect(pem).not.toMatch(/PRIVATE KEY/);
  });
});
