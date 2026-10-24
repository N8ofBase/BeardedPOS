/// <reference lib="webworker" />
// Runs PGlite (Postgres in WebAssembly) off the main thread so the register stays responsive.
// The page sends queries; this worker runs them one at a time against the IndexedDB-backed database.
import { PGlite } from "@electric-sql/pglite";
import { PGLITE_OPTIONS } from "@bearded/db/parsers";
import type { DbRequest, DbResponse } from "./protocol.ts";

declare const self: DedicatedWorkerGlobalScope;

let pg: PGlite | null = null;

async function handle(req: DbRequest): Promise<unknown> {
  switch (req.op) {
    case "open":
      pg = await PGlite.create(req.dataDir, PGLITE_OPTIONS);
      return null;
    case "query": {
      const res = await db().query(req.sql, req.params);
      return { rows: res.rows, affectedRows: res.affectedRows };
    }
    case "exec":
      await db().exec(req.sql);
      return null;
    case "wipe":
      await pg?.close();
      pg = null;
      await deleteDatabases(req.dataDir.replace(/^idb:\/\//, ""));
      return null;
  }
}

function db(): PGlite {
  if (!pg) throw new Error("The demo database isn't open yet.");
  return pg;
}

async function deleteDatabases(name: string): Promise<void> {
  const all = await indexedDB.databases();
  await Promise.all(
    all
      .map((d) => d.name)
      .filter((n): n is string => !!n && n.endsWith(name))
      .map(
        (n) =>
          new Promise<void>((resolve, reject) => {
            const r = indexedDB.deleteDatabase(n);
            r.onsuccess = () => resolve();
            r.onerror = () => reject(r.error);
            r.onblocked = () => resolve();
          }),
      ),
  );
}

self.onmessage = async (e: MessageEvent<DbRequest>) => {
  const req = e.data;
  let res: DbResponse;
  try {
    res = { id: req.id, ok: true, result: await handle(req) };
  } catch (err) {
    const e2 = err as { message?: string; code?: string };
    res = { id: req.id, ok: false, error: { message: e2.message ?? String(err), code: e2.code } };
  }
  self.postMessage(res);
};
