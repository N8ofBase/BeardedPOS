// The hosted register's side of the shared RDS Postgres: its own small pool, with the same type
// parsers as PGlite (dates stay "YYYY-MM-DD"), its migrations from the folder the Lambda ships,
// and the store's business, owners and sample data created on first start.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import {
  migrate,
  PGLITE_PARSERS,
  toMigrations,
  type DB,
  type Migration,
  type SetupProduct,
  type StoreSetup,
} from "@bearded/db";
import { storeProducts, type Product, type SquareCatalog } from "@bearded/store-core";
import type { PostgresOptions } from "./postgres.ts";
import { STORE_LOGO } from "./registerLogo.ts";

// Any fixed number other than the store's: two cold starts can't run the same migrations at once.
const REGISTER_LOCK = 4_810_043;

const INT8_OID = 20;

/** PGlite's choices: dates stay strings, numeric and bigint (counts, sums) become numbers. */
const PARSERS: Record<number, (v: string) => unknown> = {
  ...(PGLITE_PARSERS as Record<number, (v: string) => unknown>),
  [INT8_OID]: (v) => {
    const n = BigInt(v);
    return n < Number.MIN_SAFE_INTEGER || n > Number.MAX_SAFE_INTEGER ? n : Number(n);
  },
};

/** Every packages/db migration in a folder, in name order. */
export function readMigrations(dir: string): Migration[] {
  return toMigrations(
    Object.fromEntries(
      readdirSync(dir)
        .filter((f) => f.endsWith(".sql"))
        .map((f) => [f, readFileSync(join(dir, f), "utf8")]),
    ),
  );
}

const CATEGORY: Record<Product["kind"], string> = {
  game: "Family games",
  expansion: "Other",
  preorder: "Other",
  digital: "Other",
  merch: "Accessories",
};

/** What the online store sells, in shelf order, as register products (SKUs BBG-001 and on). */
export function storeItems(catalog: SquareCatalog): SetupProduct[] {
  return storeProducts(catalog).map((p, i) => ({
    sku: `BBG-${String(i + 1).padStart(3, "0")}`,
    name: p.name,
    category: p.kind === "game" && /\bcard\b/i.test(p.name) ? "Card games" : CATEGORY[p.kind],
    priceCents: p.priceCents,
  }));
}

/**
 * The store as the register first meets it. POS_OWNERS lists the first owners as
 * "Name <email>, Name <email>"; POS_DEMO_STOCK, when set, loads the (DEMO) sample customers and
 * puts that many of each item on the shelf: the online store's items when a catalog is given.
 */
export function storeSetup(
  env: Record<string, string | undefined>,
  businessId: string,
  catalog?: SquareCatalog,
): StoreSetup {
  const owners = (env.POS_OWNERS ?? "")
    .split(",")
    .map((s) => /^\s*(.+?)\s*<([^>]+)>\s*$/.exec(s))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ name: m[1]!, email: m[2]! }));
  if (!owners.length) throw new Error('POS_OWNERS needs at least one "Name <email>".');
  const stock = env.POS_DEMO_STOCK ? Number(env.POS_DEMO_STOCK) : NaN;
  const demo = Number.isInteger(stock) && stock >= 0;
  return {
    businessId,
    name: "Bearded Board Games",
    slug: "bearded-board-games",
    locationName: "St. Louis",
    timezone: "America/Chicago",
    owners,
    demo: demo ? { openingStock: stock } : false,
    look: { brandColor: "#14614f", logo: STORE_LOGO },
    ...(demo && catalog ? { items: { products: storeItems(catalog), openingStock: stock } } : {}),
  };
}

/** Applies the register's migrations on one connection while holding a lock. */
export async function migrateRegister(
  pool: Pick<pg.Pool, "connect">,
  migrations: Migration[],
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [REGISTER_LOCK]);
    try {
      await migrate(
        {
          query: async (text, params) => {
            const r = await client.query(text, params);
            return { rows: r.rows, affectedRows: r.rowCount ?? undefined };
          },
          exec: (text) => client.query(text),
        },
        migrations,
      );
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [REGISTER_LOCK]);
    }
  } finally {
    client.release();
  }
}

/** PGlite's parsers on a node-postgres pool, so handlers see the same values hosted as in the demo. */
export const REGISTER_TYPES = {
  getTypeParser: ((oid: number, format?: string) =>
    PARSERS[oid] ?? pg.types.getTypeParser(oid, format as "text")) as typeof pg.types.getTypeParser,
};

/** Opens the register's pool and brings its tables up to date. */
export async function openRegister(o: PostgresOptions, migrations: Migration[]): Promise<Kysely<DB>> {
  const pool = new pg.Pool({
    host: o.host,
    port: o.port,
    database: o.database,
    user: o.user,
    password: o.password,
    ssl: { ca: o.ca, rejectUnauthorized: true },
    max: 2,
    idleTimeoutMillis: 60_000,
    types: REGISTER_TYPES,
  });
  await migrateRegister(pool, migrations);
  return new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
}
