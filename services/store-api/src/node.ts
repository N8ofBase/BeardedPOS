// Runs the store api inside a Node http server (the Vite dev server for now). Development settings
// only: an offline Square, a database saved under services/store-api/.data, and mail to the console.
import { mkdirSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { StoreCtx } from "./context.ts";
import { openPglite } from "./db.ts";
import { parseCookies, type ApiRequest } from "./http.ts";
import { logMailer } from "./mailer.ts";
import { handle } from "./router.ts";
import { SnapshotStore } from "./square/snapshot.ts";

/** The business id the store uses before it's tied to the POS's businesses table. */
export const DEV_BUSINESS_ID = "b0a7dbbb-0000-4000-8000-000000000001";
const MAX_BODY = 64 * 1024;

export async function devContext(): Promise<StoreCtx> {
  const dir = join(fileURLToPath(import.meta.url), "../../.data/dev");
  mkdirSync(dir, { recursive: true });
  return {
    db: await openPglite(dir),
    square: new SnapshotStore(),
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
