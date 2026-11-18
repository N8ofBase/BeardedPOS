// The store api in AWS Lambda behind API Gateway (HTTP API, payload v2). Settings come from the
// environment; the database password and the Square token come from Secrets Manager, read once per
// instance. SQUARE_ENV picks the Square Sandbox (the demo) or the real account (the live store).
import { readFileSync } from "node:fs";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { SendEmailCommand, SESv2Client } from "@aws-sdk/client-sesv2";
import type { StoreCtx } from "./context.ts";
import { parseCookies, type ApiRequest, type ApiResponse } from "./http.ts";
import { sesMailer } from "./mailer.ts";
import { ensureStore } from "@bearded/db";
import { withBusiness } from "./db.ts";
import { openPostgres, type PostgresOptions } from "./postgres.ts";
import { openRegister, readMigrations, storeSetup } from "./register-postgres.ts";
import { catchUpRegisterStock } from "./registerStock.ts";
import { handle } from "./router.ts";
import { SquareApiStore } from "./square/live.ts";
import { SnapshotStore } from "./square/snapshot.ts";
import type { SquareStore } from "./square/types.ts";

const MAX_BODY = 64 * 1024;
/** The register sends bigger bodies: an import goes up 500 rows at a time. */
const MAX_REGISTER_BODY = 5 * 1024 * 1024;
/** What the CDK stack puts in the Square secret. Until N8 pastes the Sandbox token, Square is offline. */
export const SQUARE_PLACEHOLDER = "paste-the-square-sandbox-token-here";
/** The live store's placeholders. A live store never runs offline: it waits for the real token. */
export const LIVE_SQUARE_PLACEHOLDER = "paste-the-square-production-token-here";
export const WEBHOOK_PLACEHOLDER = "paste-the-square-webhook-signature-key-here";

/** The parts of an API Gateway v2 event the store reads. */
export interface HttpEvent {
  rawPath: string;
  rawQueryString?: string;
  headers?: Record<string, string | undefined>;
  cookies?: string[];
  body?: string;
  isBase64Encoded?: boolean;
  requestContext: { http: { method: string } };
}

export interface HttpResult {
  statusCode: number;
  headers: Record<string, string>;
  cookies?: string[];
  body?: string;
}

const result = (r: ApiResponse): HttpResult => {
  const { "Set-Cookie": cookie, ...headers } = r.headers ?? {};
  return {
    statusCode: r.status,
    headers: {
      "Cache-Control": "no-store",
      ...(r.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...headers,
    },
    ...(cookie ? { cookies: [cookie] } : {}),
    ...(r.body === undefined ? {} : { body: JSON.stringify(r.body) }),
  };
};

/** Turns an API Gateway event into the store's request, runs it, and turns the answer back. */
export async function serve(ctx: StoreCtx, event: HttpEvent): Promise<HttpResult> {
  const text = event.body
    ? event.isBase64Encoded
      ? Buffer.from(event.body, "base64").toString("utf8")
      : event.body
    : "";
  let body: unknown;
  try {
    if (text.length > (event.rawPath.startsWith("/api/pos/") ? MAX_REGISTER_BODY : MAX_BODY))
      throw new Error("too big");
    body = text ? JSON.parse(text) : undefined;
  } catch {
    return result({
      status: 400,
      body: { error: "That request didn’t make sense. Refresh the page and try again." },
    });
  }
  const headers = event.headers ?? {};
  const req: ApiRequest = {
    method: event.requestContext.http.method,
    path: event.rawPath,
    query: new URLSearchParams(event.rawQueryString ?? ""),
    headers,
    cookies: parseCookies((event.cookies ?? []).join("; ") || headers.cookie),
    body,
    rawBody: text,
  };
  return result(await handle(ctx, req));
}

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`The store Lambda needs ${name}.`);
  return v;
}

async function secret(client: SecretsManagerClient, id: string): Promise<string> {
  const r = await client.send(new GetSecretValueCommand({ SecretId: id }));
  if (!r.SecretString) throw new Error(`Secret ${id} is empty.`);
  return r.SecretString;
}

/** Builds the hosted context from the environment the CDK stack sets. */
export async function hostedContext(env = process.env): Promise<StoreCtx> {
  const mode = env.SQUARE_ENV;
  if (mode !== "sandbox" && mode !== "live") throw new Error('SQUARE_ENV must be "sandbox" or "live".');
  // Short network timeouts and a log line per step: when the store can't start, the log says where.
  const step = (s: string) => console.log(`store start: ${s}`);
  const secrets = new SecretsManagerClient({
    requestHandler: { connectionTimeout: 3_000, requestTimeout: 5_000 },
  });
  step("reading secrets");
  const db = JSON.parse(await secret(secrets, need("DB_SECRET_ARN"))) as {
    host: string;
    port: number;
    dbname?: string;
    username: string;
    password: string;
  };
  const token = (await secret(secrets, need("SQUARE_SECRET_ARN"))).trim();
  step("secrets read; checking Square");
  const square = squareFor(mode, token, env.SQUARE_LOCATION_ID);
  if (square.account)
    await square.account().then(
      (a) => console.log(`square ${mode}: ${a.merchant}, location ${a.location}`),
      (e: unknown) => console.error(`square ${mode}: account check failed`, e),
    );
  const webhookKey = env.SQUARE_WEBHOOK_SECRET_ARN
    ? (await secret(secrets, env.SQUARE_WEBHOOK_SECRET_ARN)).trim()
    : "";
  step("opening the database");
  const ses = new SESv2Client({ requestHandler: { connectionTimeout: 3_000, requestTimeout: 5_000 } });
  const options: PostgresOptions = {
    host: db.host,
    port: db.port,
    database: db.dbname ?? "store",
    user: db.username,
    password: db.password,
    ca: readFileSync(need("RDS_CA_FILE"), "utf8"),
  };
  const businessId = need("BBG_BUSINESS_ID");
  // The register's tables first, then the store's (which let the app's user act as pos_app),
  // then the store's business, owners and sample data for the register. A register that can't
  // start is left off until the next cold start; the store keeps working either way.
  let pos = env.POS_MIGRATIONS_DIR
    ? await openRegister(options, readMigrations(env.POS_MIGRATIONS_DIR)).catch(registerOff)
    : undefined;
  step(pos ? "register ready; opening the store's tables" : "opening the store's tables");
  const storeDb = await openPostgres(options);
  step("store tables ready");
  // The register's shelf starts with what the online store sells (Square's catalog, or the saved
  // copy when Square can't be reached).
  const catalog = pos ? await square.catalog().catch(() => new SnapshotStore().catalog()) : undefined;
  if (pos) pos = await ensureStore(pos, storeSetup(env, businessId, catalog)).then(() => pos, registerOff);
  // Website orders paid while the register was off (or before it shared this database) come off its
  // shelf now. A failure here is logged and never stops the store.
  if (pos)
    await withBusiness(storeDb, businessId, catchUpRegisterStock).catch((e: unknown) =>
      console.error("register stock catch-up failed", e),
    );
  step("ready");
  return {
    db: storeDb,
    ...(pos ? { pos } : {}),
    square,
    mailer: sesMailer(need("MAIL_FROM"), (input) => ses.send(new SendEmailCommand(input))),
    config: {
      businessId,
      staff: need("BBG_STAFF")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      siteUrl: need("BBG_SITE_URL"),
      secureCookies: true,
      ...(webhookKey && webhookKey !== WEBHOOK_PLACEHOLDER
        ? { squareWebhook: { signatureKey: webhookKey, url: need("SQUARE_WEBHOOK_URL") } }
        : {}),
    },
    now: () => new Date(),
  };
}

/**
 * The Sandbox demo runs on the saved catalog until its token is pasted. The live store refuses to
 * start without the real token: an offline store would let anyone "pay" on the preview page.
 */
export function squareFor(mode: "sandbox" | "live", raw: string, locationId?: string): SquareStore {
  const token = raw.trim();
  if (!token || token.startsWith("{")) throw new Error("Put the Square token in its secret as plain text.");
  if (mode === "sandbox" && token === SQUARE_PLACEHOLDER) return new SnapshotStore();
  if (mode === "live" && (token === LIVE_SQUARE_PLACEHOLDER || token === SQUARE_PLACEHOLDER))
    throw new Error("The live store needs the Square production token in its secret.");
  return new SquareApiStore({ mode, token, locationId: locationId || undefined });
}

function registerOff(e: unknown): undefined {
  console.error("register setup failed; /api/pos is off until the next cold start", e);
  return undefined;
}

let ready: Promise<StoreCtx> | undefined;

export async function handler(event: HttpEvent): Promise<HttpResult> {
  ready ??= hostedContext().catch((e: unknown) => {
    ready = undefined; // try again on the next request
    throw e;
  });
  try {
    return await serve(await ready, event);
  } catch (e) {
    console.error("store lambda error", e);
    return result({
      status: 503,
      body: { error: "The store is waking up. Try again in a minute." },
    });
  }
}
