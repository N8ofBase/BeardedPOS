import type { QueryClient } from "./client.ts";

export interface Migration {
  name: string;
  sql: string;
}

/** Migrations from name → SQL text, in filename order. */
export function toMigrations(files: Record<string, string>): Migration[] {
  return Object.entries(files)
    .map(([path, sql]) => ({
      name: path
        .split("/")
        .pop()!
        .replace(/\.sql$/, ""),
      sql,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Vite (web build) and Vitest both resolve this at build time. Bundled for Node (the hosted
// register's Lambda) there is no import.meta.glob: that build reads the folder itself.
function bundled(): Record<string, string> {
  try {
    return import.meta.glob<string>("../migrations/*.sql", { query: "?raw", import: "default", eager: true });
  } catch {
    return {};
  }
}

/** Every migration in migrations/, in filename order. Empty outside Vite and Vitest. */
export const MIGRATIONS: Migration[] = toMigrations(bundled());

/**
 * Applies migrations that haven't run yet, each in its own transaction.
 * Run as the database owner before the app uses the database. Returns the names applied.
 */
export async function migrate(client: QueryClient, migrations: Migration[] = MIGRATIONS): Promise<string[]> {
  await client.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const { rows } = await client.query<{ name: string }>("SELECT name FROM schema_migrations");
  const done = new Set(rows.map((r) => r.name));
  const applied: string[] = [];

  for (const m of migrations) {
    if (done.has(m.name)) continue;
    await client.exec("BEGIN");
    try {
      await client.exec(m.sql);
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [m.name]);
      await client.exec("COMMIT");
    } catch (err) {
      await client.exec("ROLLBACK");
      throw new Error(`Migration ${m.name} failed: ${(err as Error).message}`, { cause: err });
    }
    applied.push(m.name);
  }
  return applied;
}
