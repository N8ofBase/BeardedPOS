// Sample records for the demo. Every row is is_demo = true and named "(DEMO)",
// so "Remove all demo data" can find exactly these. Runs as the database owner.
import type { Kysely } from "kysely";
import type { Role } from "@pet-pos/core";
import type { DB } from "../src/schema.ts";

const DEMO_STAFF: { name: string; email: string; role: Role }[] = [
  { name: "Sample Owner (DEMO)", email: "owner.demo@example.com", role: "owner" },
  { name: "Sample Manager (DEMO)", email: "manager.demo@example.com", role: "manager" },
  { name: "Sample Cashier (DEMO)", email: "cashier.demo@example.com", role: "cashier" },
  { name: "Sample Groomer (DEMO)", email: "groomer.demo@example.com", role: "groomer" },
];

export async function hasDemoData(db: Kysely<DB>): Promise<boolean> {
  const row = await db.selectFrom("businesses").select("id").where("is_demo", "=", true).executeTakeFirst();
  return row !== undefined;
}

/** Creates the sample store, its location and one staff member per role. Returns the business id. */
export async function seedDemo(db: Kysely<DB>): Promise<string> {
  return db.transaction().execute(async (trx) => {
    const business = await trx
      .insertInto("businesses")
      .values({
        name: "Sample Pet Store (DEMO)",
        slug: "sample-pet-store-demo",
        brand_color: "#0f6e5a",
        modules: JSON.stringify({ astro: true, grooming: true }),
        is_demo: true,
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    await trx
      .insertInto("locations")
      .values({ business_id: business.id, name: "Main store (DEMO)", tax_rate_bp: 700, is_demo: true })
      .execute();

    await trx
      .insertInto("staff")
      .values(DEMO_STAFF.map((s) => ({ ...s, business_id: business.id, is_demo: true })))
      .execute();

    return business.id;
  });
}

export interface DemoStaff {
  id: string;
  businessId: string;
  name: string;
  role: Role;
}

/** Demo staff for the role picker. Owner access: only the demo build may call this. */
export async function listDemoStaff(db: Kysely<DB>): Promise<DemoStaff[]> {
  const rows = await db
    .selectFrom("staff")
    .select(["id", "business_id", "name", "role"])
    .where("is_demo", "=", true)
    .where("active", "=", true)
    .execute();
  const order: Role[] = ["owner", "manager", "cashier", "groomer"];
  return rows
    .map((r) => ({ id: r.id, businessId: r.business_id, name: r.name, role: r.role }))
    .sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role));
}
