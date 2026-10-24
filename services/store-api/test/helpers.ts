import { openPglite, type Database } from "../src/db.ts";
import type { StoreConfig, StoreCtx } from "../src/context.ts";
import type { ApiResponse } from "../src/http.ts";
import { handle } from "../src/router.ts";
import { SnapshotStore } from "../src/square/snapshot.ts";
import type { SquareStore } from "../src/square/types.ts";

export const BIZ_A = "aaaaaaaa-0000-4000-8000-000000000001";
export const BIZ_B = "bbbbbbbb-0000-4000-8000-000000000002";

export interface TestStore {
  ctx: StoreCtx;
  mail: { to: string; subject: string }[];
  call(method: string, path: string, body?: unknown, cookies?: Record<string, string>): Promise<ApiResponse>;
}

export function makeStore(
  db: Database,
  over: { businessId?: string; square?: SquareStore; config?: Partial<StoreConfig>; now?: () => Date } = {},
): TestStore {
  const mail: { to: string; subject: string }[] = [];
  const ctx: StoreCtx = {
    db,
    square: over.square ?? new SnapshotStore(),
    mailer: { send: async (to, subject) => void mail.push({ to, subject }) },
    config: {
      businessId: over.businessId ?? BIZ_A,
      staff: ["adam@beardedboardgames.com", "@prismcortex.net"],
      siteUrl: "https://store.test",
      secureCookies: true,
      ...over.config,
    },
    now: over.now ?? (() => new Date()),
  };
  return {
    ctx,
    mail,
    call: (method, path, body, cookies = {}) => {
      const url = new URL(path, "http://x");
      return handle(ctx, {
        method,
        path: url.pathname,
        query: url.searchParams,
        headers: body === undefined ? {} : { "content-type": "application/json" },
        cookies,
        body,
      });
    },
  };
}

export const freshDb = () => openPglite();

/** Signs in as staff and returns the cookie jar to pass to later calls. */
export async function signInStaff(store: TestStore, email = "adam@beardedboardgames.com") {
  const code = (await store.call("POST", "/api/staff/code", { email })).body as { devCode: string };
  const res = await store.call("POST", "/api/staff/session", { email, code: code.devCode });
  const token = /bbg_staff=([^;]+)/.exec(res.headers!["Set-Cookie"]!)![1]!;
  return { bbg_staff: token };
}
