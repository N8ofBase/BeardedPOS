// A real store in the hosted register: its business row (the same id the online store uses), a
// location and its owners, created once. Sample data can come along so there's something to sell.
// Runs as the database owner, like the demo seed, but with app.business_id set: on a hosted
// Postgres the owner is not a superuser, and forced row-level security applies to it too. Every
// query also names the business, for PGlite, where the owner is a superuser and skips it.
import { sql, type Kysely, type Transaction } from "kysely";
import type { DB } from "../src/schema.ts";
import { seedDemoParts, type DemoPartsOptions } from "./demo.ts";

export interface StoreSetup {
  businessId: string;
  name: string;
  slug: string;
  locationName: string;
  timezone: string;
  /** Staff who start as owners. More are added in Settings. */
  owners: { name: string; email: string }[];
  /** The (DEMO) sample shop, or false for none. */
  demo: DemoPartsOptions | false;
  /** The store's look, set once while the business has none: hex color and a data:image URL. */
  look?: { brandColor: string; logo: string | null };
  /**
   * What the store sells, added once with this many of each on hand. The (DEMO) sample products are
   * archived then, so the shelf shows the store's own items.
   */
  items?: { products: SetupProduct[]; openingStock: number };
}

export interface SetupProduct {
  sku: string;
  name: string;
  category: string;
  priceCents: number;
}

/** Creates whatever part of the store is missing. Safe to run on every start. */
export async function ensureStore(db: Kysely<DB>, s: StoreSetup): Promise<void> {
  await db.transaction().execute(async (trx) => {
    await sql`SELECT set_config('app.business_id', ${s.businessId}, true)`.execute(trx);
    const business = await trx
      .selectFrom("businesses")
      .select("id")
      .where("id", "=", s.businessId)
      .executeTakeFirst();
    if (!business)
      await trx.insertInto("businesses").values({ id: s.businessId, name: s.name, slug: s.slug }).execute();
    const location = await trx
      .selectFrom("locations")
      .select("id")
      .where("business_id", "=", s.businessId)
      .executeTakeFirst();
    if (!location)
      await trx
        .insertInto("locations")
        .values({ business_id: s.businessId, name: s.locationName, timezone: s.timezone })
        .execute();
    for (const owner of s.owners) {
      const email = owner.email.trim().toLowerCase();
      const found = await trx
        .selectFrom("staff")
        .select("id")
        .where("business_id", "=", s.businessId)
        .where((eb) => eb(eb.fn("lower", ["email"]), "=", email))
        .executeTakeFirst();
      if (!found)
        await trx
          .insertInto("staff")
          .values({ business_id: s.businessId, name: owner.name, email, role: "owner" })
          .execute();
    }
    if (s.demo) await seedDemoParts(trx, s.businessId, s.demo);
    const look = s.look;
    if (look)
      await once(trx, s.businessId, "store-look", () =>
        trx
          .updateTable("businesses")
          .set({ brand_color: look.brandColor, logo_data: look.logo })
          .where("id", "=", s.businessId)
          .where("brand_color", "is", null)
          .where("logo_data", "is", null)
          .execute(),
      );
    const items = s.items;
    if (items?.products.length)
      await once(trx, s.businessId, "store-items", () => seedItems(trx, s.businessId, items));
  });
}

/** Runs a setup step the first time only, recorded beside the demo seed's own parts. */
async function once(trx: Transaction<DB>, businessId: string, part: string, step: () => Promise<unknown>) {
  const done = await trx
    .selectFrom("demo_seed_parts")
    .select("part")
    .where("business_id", "=", businessId)
    .where("part", "=", part)
    .executeTakeFirst();
  if (done) return;
  await step();
  await trx.insertInto("demo_seed_parts").values({ business_id: businessId, part }).execute();
}

async function seedItems(
  trx: Transaction<DB>,
  businessId: string,
  items: NonNullable<StoreSetup["items"]>,
): Promise<void> {
  const location = await trx
    .selectFrom("locations")
    .select("id")
    .where("business_id", "=", businessId)
    .orderBy("created_at")
    .executeTakeFirstOrThrow();
  for (const p of items.products) {
    // Skip anything already on the shelf under that SKU or name.
    const found = await trx
      .selectFrom("products")
      .select("id")
      .where("business_id", "=", businessId)
      .where((eb) =>
        eb.or([
          eb(eb.fn("lower", ["sku"]), "=", p.sku.toLowerCase()),
          eb(eb.fn("lower", ["name"]), "=", p.name.toLowerCase()),
        ]),
      )
      .executeTakeFirst();
    if (found) continue;
    const row = await trx
      .insertInto("products")
      .values({
        business_id: businessId,
        sku: p.sku,
        name: p.name,
        category: p.category,
        price_cents: p.priceCents,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    if (items.openingStock > 0)
      await trx
        .insertInto("inventory_moves")
        .values({
          business_id: businessId,
          product_id: row.id,
          location_id: location.id,
          qty_change: items.openingStock,
          reason: "adjust",
          note: "Opening count (test register)",
        })
        .execute();
  }
  await trx
    .updateTable("products")
    .set({ active: false })
    .where("business_id", "=", businessId)
    .where("is_demo", "=", true)
    .execute();
}
