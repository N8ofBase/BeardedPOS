import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { migrate, MIGRATIONS } from "../src/migrate.ts";

describe("migrate", () => {
  it("finds the migration files in order", () => {
    const names = MIGRATIONS.map((m) => m.name);
    expect(names.slice(0, 2)).toEqual(["001_businesses", "002_staff"]);
    expect(names).toEqual([...names].sort());
    expect(names.every((n) => /^\d{3}_[a-z0-9_]+$/.test(n))).toBe(true);
  });

  it("applies every migration once; a rerun does nothing", async () => {
    const pg = new PGlite();
    expect(await migrate(pg)).toEqual(MIGRATIONS.map((m) => m.name));
    expect(await migrate(pg)).toEqual([]);
    const { rows } = await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM schema_migrations");
    expect(rows[0]!.n).toBe(MIGRATIONS.length);
  });

  it("turns on and forces row-level security on every table with business_id", async () => {
    const pg = new PGlite();
    await migrate(pg);
    const { rows } = await pg.query<{ t: string; rls: boolean; forced: boolean }>(`
      SELECT c.relname AS t, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
        AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'business_id')
      ORDER BY 1`);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const r of rows)
      expect({ table: r.t, rls: r.rls, forced: r.forced }).toEqual({ table: r.t, rls: true, forced: true });
  });

  it("rolls back a failing migration and reports it", async () => {
    const pg = new PGlite();
    await expect(
      migrate(pg, [
        { name: "001_ok", sql: "CREATE TABLE ok (id int)" },
        { name: "002_bad", sql: "CREATE TABLE half (id int); SELECT nope FROM missing" },
      ]),
    ).rejects.toThrow(/002_bad failed/);
    const tables = await pg.query<{ t: string }>(
      "SELECT tablename AS t FROM pg_tables WHERE schemaname = 'public' ORDER BY 1",
    );
    expect(tables.rows.map((r) => r.t)).toEqual(["ok", "schema_migrations"]);
  });
});
