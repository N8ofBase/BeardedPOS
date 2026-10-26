// The store's database when hosted: Postgres (Amazon RDS) through node-postgres, behind the same
// Database interface as PGlite. One small pool per Lambda instance.
import pg from "pg";
import { migrate, type Database, type Sql } from "./db.ts";

export interface PostgresOptions {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  /** CA certificates to trust for TLS (the RDS bundle). Connections are always encrypted. */
  ca: string;
}

/** Any node-postgres client: a pooled connection or a plain one. */
type Client = Pick<pg.PoolClient, "query">;

const sql = (c: Client): Sql & { exec(text: string): Promise<unknown> } => ({
  query: async <T>(text: string, params?: unknown[]) => {
    const r = await c.query(text, params);
    return { rows: r.rows as T[] };
  },
  exec: (text) => c.query(text),
});

/** Wraps one client in BEGIN/COMMIT, rolling back if fn throws. */
async function inTransaction<T>(c: Client, fn: (tx: ReturnType<typeof sql>) => Promise<T>): Promise<T> {
  await c.query("BEGIN");
  try {
    const out = await fn(sql(c));
    await c.query("COMMIT");
    return out;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  }
}

export function postgresDatabase(pool: Pick<pg.Pool, "query" | "connect">): Database {
  return {
    ...sql(pool),
    async transaction(fn) {
      const client = await pool.connect();
      try {
        return await inTransaction(client, fn);
      } finally {
        client.release();
      }
    },
  };
}

// Any fixed number: only store migrations take this lock.
const MIGRATION_LOCK = 4_810_042;

/** Runs migrations on one connection while holding a lock, so two cold starts can't run them at once. */
export async function migrateLocked(pool: Pick<pg.Pool, "connect">): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK]);
    try {
      await migrate({ ...sql(client), transaction: (fn) => inTransaction(client, fn) });
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK]);
    }
  } finally {
    client.release();
  }
}

export async function openPostgres(o: PostgresOptions): Promise<Database> {
  const pool = new pg.Pool({
    host: o.host,
    port: o.port,
    database: o.database,
    user: o.user,
    password: o.password,
    ssl: { ca: o.ca, rejectUnauthorized: true },
    // A Lambda instance serves one request at a time; two leaves room for the migration lock.
    max: 2,
    idleTimeoutMillis: 60_000,
  });
  await migrateLocked(pool);
  return postgresDatabase(pool);
}
