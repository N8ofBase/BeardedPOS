import { Kysely } from "kysely";
import type { QueryClient } from "./client.ts";
import { PGliteDialect } from "./pglite-dialect.ts";
import type { DB } from "./schema.ts";

export type { QueryClient } from "./client.ts";
export { PGliteDialect } from "./pglite-dialect.ts";
export { migrate, MIGRATIONS, type Migration } from "./migrate.ts";
export { withBusiness } from "./tx.ts";
export * from "./schema.ts";
export { seedDemo, listDemoStaff, hasDemoData, type DemoStaff } from "../seed/demo.ts";

export function createDb(client: QueryClient): Kysely<DB> {
  return new Kysely<DB>({ dialect: new PGliteDialect(client) });
}
