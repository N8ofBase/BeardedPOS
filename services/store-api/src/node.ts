// Runs the store api inside a Node http server (the Vite dev server for now). Development settings:
// a database saved under services/store-api/.data, mail to the console, and Square offline unless
// SQUARE_ENV=sandbox and SQUARE_SANDBOX_ACCESS_TOKEN are set (services/store-api/.env).
import { mkdirSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { StoreCtx } from "./context.ts";
import { openPglite } from "./db.ts";
import { parseCookies, type ApiRequest } from "./http.ts";
import { logMailer } from "./mailer.ts";
import { handle } from "./router.ts";
import { SquareApiStore } from "./square/live.ts";
import { SnapshotStore } from "./square/snapshot.ts";
import type { SquareStore } from "./square/types.ts";

/** The business id the store uses before it's tied to the POS's businesses table. */
export const DEV_BUSINESS_ID = "b0a7dbbb-0000-4000-8000-000000000001";
const MAX_BODY = 64 * 1024;

/**
 * Offline by default. The Sandbox needs SQUARE_ENV=sandbox plus its token. Development never talks
 * to the real Square account: that is a hosting decision (step 5), made only when N8 says so.
 */
export function squareFromEnv(env: NodeJS.ProcessEnv): SquareStore {
  const mode = env.SQUARE_ENV ?? "offline";
  if (mode === "offline") return new SnapshotStore();
  if (mode !== "sandbox") throw new Error(`SQUARE_ENV must be "offline" or "sandbox" here, not "${mode}".`);
  const token = env.SQUARE_SANDBOX_ACCESS_TOKEN;
  if (!token) throw new Error("SQUARE_ENV=sandbox needs SQUARE_SANDBOX_ACCESS_TOKEN.");
  return new SquareApiStore({ mode: "sandbox", token, locationId: env.SQUARE_LOCATION_ID || undefined });
}

export async function devContext(): Promise<StoreCtx> {
  const dir = join(fileURLToPath(import.meta.url), "../../.data/dev");
  mkdirSync(dir, { recursive: true });
  return {
    db: await openPglite(dir),
    square: squareFromEnv(process.env),
    mailer: logMailer(),
    config: {
      businessId: DEV_BUSINESS_ID,
      staff: (process.env.BBG_STAFF ?? "@beardedboardgames.com,@prismcortex.net")
        .split(",")
        .map((s) => s.trim()),
      siteUrl: process.env.BBG_SITE_URL ?? "http://localhost:5174",
      secureCookies: false,
    },
    now: () => new Date(),
  };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("too big"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** Connect-style middleware: answers /api/*, passes everything else on. */
export function apiMiddleware(ready: Promise<StoreCtx>) {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!url.pathname.startsWith("/api/")) return next();
    const send = (status: number, body?: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, {
        "Cache-Control": "no-store",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...headers,
      });
      res.end(body === undefined ? undefined : JSON.stringify(body));
    };
    let body: unknown;
    try {
      const text = await readBody(req);
      body = text ? JSON.parse(text) : undefined;
    } catch {
      return send(400, { error: "That request didn’t make sense. Refresh the page and try again." });
    }
    const headers = Object.fromEntries(
      Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") : v]),
    );
    const apiReq: ApiRequest = {
      method: req.method ?? "GET",
      path: url.pathname,
      query: url.searchParams,
      headers,
      cookies: parseCookies(headers.cookie),
      body,
    };
    const out = await handle(await ready, apiReq);
    send(out.status, out.body, out.headers);
  };
}
