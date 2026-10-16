import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { migrate, MIGRATIONS } from "../src/migrate.ts";

describe("migrate", () => {
  it("finds the migration files in order", () => {
    expect(MIGRATIONS.map((m) => m.name)).toEqual(["001_businesses", "002_staff"]);
  });

  it("applies every migration once; a rerun does nothing", async () => {
    const pg = new PGlite();
    expect(await migrate(pg)).toEqual(["001_businesses", "002_staff"]);
    expect(await migrate(pg)).toEqual([]);
    const { rows } = await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM schema_migrations");
    expect(rows[0]!.n).toBe(2);
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
