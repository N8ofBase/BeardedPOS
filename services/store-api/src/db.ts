// The store's database access. PGlite in development and tests; Postgres when hosted (postgres.ts)
// through the same small interface. Every app query runs in withBusiness().
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export interface Sql {
  query<T>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface Database extends Sql {
  exec(text: string): Promise<unknown>;
  transaction<T>(fn: (tx: Sql & { exec(text: string): Promise<unknown> }) => Promise<T>): Promise<T>;
}

// Paths, not URL objects: under a browser-like test environment the global URL isn't Node's.
// The Lambda bundle ships the folder next to its code and says where with STORE_MIGRATIONS_DIR.
const MIGRATIONS =
  process.env.STORE_MIGRATIONS_DIR ?? join(fileURLToPath(import.meta.url), "../../migrations");

/** Applies migrations/*.sql in name order, once each. */
export async function migrate(db: Database): Promise<void> {
  await db.exec(
    "CREATE TABLE IF NOT EXISTS store_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
  );
  const done = new Set(
    (await db.query<{ name: string }>("SELECT name FROM store_migrations")).rows.map((r) => r.name),
  );
  for (const name of readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    if (done.has(name)) continue;
    await db.transaction(async (tx) => {
      await tx.exec(readFileSync(join(MIGRATIONS, name), "utf8"));
      await tx.query("INSERT INTO store_migrations (name) VALUES ($1)", [name]);
    });
  }
}

/** An in-memory database (tests), or one saved in `dataDir` (development). */
export async function openPglite(dataDir?: string): Promise<Database> {
  // Loaded only here, so the hosted bundle doesn't carry PGlite.
  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PGlite(dataDir);
  await migrate(db);
  return db;
}

/**
 * Runs fn in a transaction scoped to one business: switches to the restricted pos_app role, so
 * row-level security applies, and sets app.business_id. Nothing else queries store tables.
 */
export function withBusiness<T>(db: Database, businessId: string, fn: (sql: Sql) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.exec("SET LOCAL ROLE pos_app");
    await tx.query("SELECT set_config('app.business_id', $1, true)", [businessId]);
    return fn(tx);
  });
}
