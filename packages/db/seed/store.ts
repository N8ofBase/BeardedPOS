// A real store in the hosted register: its business row (the same id the online store uses), a
// location and its owners, created once. Sample data can come along so there's something to sell.
// Runs as the database owner, like the demo seed, but with app.business_id set: on a hosted
// Postgres the owner is not a superuser, and forced row-level security applies to it too. Every
// query also names the business, for PGlite, where the owner is a superuser and skips it.
import { sql, type Kysely } from "kysely";
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
  });
}
