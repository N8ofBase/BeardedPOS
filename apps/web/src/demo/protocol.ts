// Messages between the page and the database worker.

export type DbRequest =
  | { id: number; op: "open"; dataDir: string }
  | { id: number; op: "query"; sql: string; params: unknown[] }
  | { id: number; op: "exec"; sql: string }
  | { id: number; op: "wipe"; dataDir: string };

export type DbResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: { message: string; code?: string } };

/** Where the demo database lives in this browser (IndexedDB). */
export const DEMO_DATA_DIR = "idb://bearded-demo";
