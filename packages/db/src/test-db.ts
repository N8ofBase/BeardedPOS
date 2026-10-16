import { PGlite } from "@electric-sql/pglite";
import type { Kysely } from "kysely";
import { createDb } from "./index.ts";
import { migrate } from "./migrate.ts";
import type { DB } from "./schema.ts";

/** A fresh in-memory Postgres with every migration applied. */
export async function createTestDb(): Promise<{ pg: PGlite; db: Kysely<DB> }> {
  const pg = new PGlite();
  await migrate(pg);
  return { pg, db: createDb(pg) };
}

/** Inserts a business as the owner (bypassing row-level security), for test setup. */
export async function insertBusiness(db: Kysely<DB>, slug: string): Promise<string> {
  const row = await db
    .insertInto("businesses")
    .values({ name: `Test ${slug}`, slug })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}
