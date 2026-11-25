// Web games just for Beard Buddies. A signed-in Buddy gets the game's page; anyone else is sent to
// the site's /play/<slug> page, which asks them to sign in (signing in is joining). The game files
// live in games/ and ship next to the Lambda bundle, which says where with STORE_GAMES_DIR.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import type { StoreCtx } from "../context.ts";
import { withBusiness } from "../db.ts";
import { HttpError, type ApiRequest, type ApiResponse } from "../http.ts";
import { currentCustomer } from "./account.ts";

/** Each game's slug and its file in games/. */
export const BUDDY_GAMES: Record<string, string> = {
  "mine-and-find": "mine-and-find.html",
};

const GAMES_DIR = process.env.STORE_GAMES_DIR ?? join(fileURLToPath(import.meta.url), "../../../games");

/** Read once per server, with a gzipped copy: the games are big single files. */
const files = new Map<string, Promise<{ plain: Uint8Array; gzip: Uint8Array }>>();
function load(file: string) {
  let got = files.get(file);
  if (!got) {
    got = readFile(join(GAMES_DIR, file)).then((plain) => ({ plain, gzip: gzipSync(plain) }));
    got.catch(() => files.delete(file));
    files.set(file, got);
  }
  return got;
}

export async function playGame(ctx: StoreCtx, req: ApiRequest, slug: string): Promise<ApiResponse> {
  const file = Object.hasOwn(BUDDY_GAMES, slug) ? BUDDY_GAMES[slug] : undefined;
  if (!file) throw new HttpError(404, "Not found.");
  const buddy = await withBusiness(ctx.db, ctx.config.businessId, (sql) => currentCustomer(sql, req));
  if (!buddy) return { status: 302, headers: { Location: `/play/${slug}`, "Cache-Control": "no-store" } };
  const { plain, gzip } = await load(file);
  const zipped = /\bgzip\b/.test(req.headers["accept-encoding"] ?? "");
  return {
    status: 200,
    bytes: zipped ? gzip : plain,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      ...(zipped ? { "Content-Encoding": "gzip" } : {}),
    },
  };
}
