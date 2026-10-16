import type { QueryClient } from "@pet-pos/db";
import type { DbRequest, DbResponse } from "./protocol.ts";

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };
type Body = DbRequest extends infer R ? (R extends DbRequest ? Omit<R, "id"> : never) : never;

/** Page-side proxy to the database worker. Implements the QueryClient the data layer expects. */
export class WorkerDbClient implements QueryClient {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();

  constructor(private readonly worker: Worker) {
    worker.onmessage = (e: MessageEvent<DbResponse>) => {
      const p = this.pending.get(e.data.id);
      if (!p) return;
      this.pending.delete(e.data.id);
      if (e.data.ok) p.resolve(e.data.result);
      else p.reject(Object.assign(new Error(e.data.error.message), { code: e.data.error.code }));
    };
    worker.onerror = (e) => {
      const err = new Error(e.message || "The demo database stopped.");
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
    };
  }

  private send<T>(body: Body): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.worker.postMessage({ ...body, id });
    });
  }

  open(dataDir: string): Promise<void> {
    return this.send({ op: "open", dataDir });
  }

  query<T>(sql: string, params: unknown[] = []): Promise<{ rows: T[]; affectedRows?: number }> {
    return this.send({ op: "query", sql, params });
  }

  exec(sql: string): Promise<unknown> {
    return this.send({ op: "exec", sql });
  }

  /** Closes and deletes the demo database in this browser. */
  wipe(dataDir: string): Promise<void> {
    return this.send({ op: "wipe", dataDir });
  }
}
