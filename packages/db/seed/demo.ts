// Sample records for the demo. Every row is is_demo = true and named "(DEMO)",
// so "Remove all demo data" can find exactly these. Runs as the database owner.
//
// ensureDemo() fills in whatever part is missing, so a browser seeded by an
// earlier version picks up new sample data after an update without a reset.
import type { Kysely, Transaction } from "kysely";
import { addDays, isIsoDate, todayIso, type Role } from "@pet-pos/core";
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

/** Creates any missing part of the sample store. Returns the demo business id. */
export async function ensureDemo(db: Kysely<DB>): Promise<string> {
  return db.transaction().execute(async (trx) => {
    const existing = await trx
      .selectFrom("businesses")
      .select("id")
      .where("is_demo", "=", true)
      .executeTakeFirst();
    const businessId = existing?.id ?? (await seedBusiness(trx));
    await once(trx, businessId, "inventory", "products", seedInventory);
    await once(trx, businessId, "customers", "customers", seedCustomers);
    return businessId;
  });
}

/**
 * Loads a set of sample data the first time only. A browser seeded before parts were
 * recorded already has the data, so that just gets recorded.
 */
async function once(
  trx: Transaction<DB>,
  businessId: string,
  part: string,
  table: "products" | "customers",
  seed: (trx: Transaction<DB>, businessId: string) => Promise<void>,
): Promise<void> {
  const done = await trx
    .selectFrom("demo_seed_parts")
    .select("part")
    .where("business_id", "=", businessId)
    .where("part", "=", part)
    .executeTakeFirst();
  if (done) return;
  const legacy = await trx
    .selectFrom(table)
    .select("id")
    .where("business_id", "=", businessId)
    .where("is_demo", "=", true)
    .executeTakeFirst();
  if (!legacy) await seed(trx, businessId);
  await trx.insertInto("demo_seed_parts").values({ business_id: businessId, part }).execute();
}

/** Kept for callers from 1a: same as ensureDemo. */
export const seedDemo = ensureDemo;

async function seedBusiness(trx: Transaction<DB>): Promise<string> {
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
}

// The prototype's sample products and program.
const DEMO_PRODUCTS = [
  {
    sku: "0001",
    name: "Sample Adult Dog Food 24 lb (DEMO)",
    brand: "Sample Brand",
    category: "Dog food",
    price_cents: 6499,
    cost_cents: 4300,
    reorder_at: 6,
    on_hand: 14,
    program: true,
    offer: { label: "$5 off 24 lb bag", cents: 500 },
  },
  {
    sku: "0002",
    name: "Sample Cat Food 12 lb (DEMO)",
    brand: "Sample Brand",
    category: "Cat food",
    price_cents: 3899,
    cost_cents: 2500,
    reorder_at: 5,
    on_hand: 4,
    program: true,
    offer: null,
  },
  {
    sku: "0003",
    name: "Sample Freeze-Dried Treats (DEMO)",
    brand: "Sample Treat Co",
    category: "Treats",
    price_cents: 1299,
    cost_cents: 700,
    reorder_at: 10,
    on_hand: 30,
    program: false,
    offer: null,
  },
  {
    sku: "0004",
    name: "Sample Rope Toy (DEMO)",
    brand: null,
    category: "Supplies",
    price_cents: 899,
    cost_cents: 350,
    reorder_at: 4,
    on_hand: 0,
    program: false,
    offer: null,
  },
];

async function seedInventory(trx: Transaction<DB>, businessId: string): Promise<void> {
  const location = await trx
    .selectFrom("locations")
    .select("id")
    .where("business_id", "=", businessId)
    .orderBy("created_at")
    .executeTakeFirstOrThrow();

  const program = await trx
    .insertInto("astro_programs")
    .values({
      business_id: businessId,
      name: "Sample dry food club (DEMO)",
      brand: "Sample Brand",
      buy_count: 12,
      reward_text: "Next bag free",
      is_demo: true,
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  for (const p of DEMO_PRODUCTS) {
    const row = await trx
      .insertInto("products")
      .values({
        business_id: businessId,
        sku: p.sku,
        name: p.name,
        brand: p.brand,
        category: p.category,
        price_cents: p.price_cents,
        cost_cents: p.cost_cents,
        reorder_at: p.reorder_at,
        astro_program_id: p.program ? program.id : null,
        astro_offer_label: p.offer?.label ?? null,
        astro_offer_cents: p.offer?.cents ?? null,
        is_demo: true,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    if (p.on_hand !== 0) {
      await trx
        .insertInto("inventory_moves")
        .values({
          business_id: businessId,
          product_id: row.id,
          location_id: location.id,
          qty_change: p.on_hand,
          reason: "adjust",
          note: "Opening count",
          is_demo: true,
        })
        .execute();
    }
  }
}

// Phone numbers are in the fictional 555-01xx range. Dates are relative to the
// day the demo is set up, so the birthday tag and the expired-rabies warning always show.
async function seedCustomers(trx: Transaction<DB>, businessId: string): Promise<void> {
  const today = todayIso();
  // The same calendar day n years back (Feb 29 becomes Feb 28 in a non-leap year).
  const yearsAgo = (n: number, days = 0) => {
    const d = addDays(today, days);
    const back = `${Number(d.slice(0, 4)) - n}${d.slice(4)}`;
    return isIsoDate(back) ? back : back.replace(/-02-29$/, "-02-28");
  };
  const program = await trx
    .selectFrom("astro_programs")
    .select("id")
    .where("business_id", "=", businessId)
    .where("is_demo", "=", true)
    .executeTakeFirst();

  const customers = [
    {
      name: "Sample Customer (DEMO)",
      phone: "2125550100",
      email: "customer.demo@example.com",
      street: "12 Sample St",
      city: "Springfield",
      state: "IL",
      zip: "62701",
      birthday: null,
      sms_opt_in: true,
      punches: 11,
      pets: [
        {
          name: "Biscuit",
          species: "dog" as const,
          breed: "Beagle",
          size: "M" as const,
          birthday: yearsAgo(4, 40),
          weight_lb: 24.5,
          temperament: "Friendly; nervous with dryers",
          vaccines: [
            { vaccine: "Rabies", expires_on: addDays(today, 300) },
            { vaccine: "DHPP", expires_on: addDays(today, 20) },
          ],
        },
      ],
    },
    {
      name: "Sample Cat Parent (DEMO)",
      phone: "2125550101",
      email: null,
      street: null,
      city: null,
      state: null,
      zip: null,
      birthday: yearsAgo(38, 3),
      sms_opt_in: false,
      punches: 0,
      pets: [
        {
          name: "Mo",
          species: "cat" as const,
          breed: "Domestic shorthair",
          size: "S" as const,
          birthday: yearsAgo(9, 120),
          weight_lb: 11,
          temperament: null,
          vaccines: [{ vaccine: "Rabies", expires_on: addDays(today, -30) }],
        },
      ],
    },
    {
      name: "Sample Family (DEMO)",
      phone: "2125550102",
      email: "family.demo@example.com",
      street: null,
      city: "Springfield",
      state: "IL",
      zip: null,
      birthday: null,
      sms_opt_in: true,
      punches: 4,
      pets: [
        {
          name: "Rex",
          species: "dog" as const,
          breed: "Labrador",
          size: "L" as const,
          birthday: yearsAgo(2, 200),
          weight_lb: 68,
          temperament: null,
          vaccines: [],
        },
        {
          name: "Juno",
          species: "dog" as const,
          breed: "Shih tzu",
          size: "S" as const,
          birthday: null,
          weight_lb: null,
          temperament: null,
          vaccines: [],
        },
        {
          name: "Clover",
          species: "other" as const,
          breed: "Rabbit",
          size: null,
          birthday: yearsAgo(1, 5),
          weight_lb: null,
          temperament: null,
          vaccines: [],
        },
      ],
    },
  ];

  for (const { pets, punches, ...c } of customers) {
    const row = await trx
      .insertInto("customers")
      .values({ ...c, business_id: businessId, is_demo: true })
      .returning("id")
      .executeTakeFirstOrThrow();
    for (const { vaccines, ...p } of pets) {
      const pet = await trx
        .insertInto("pets")
        .values({ ...p, business_id: businessId, customer_id: row.id, is_demo: true })
        .returning("id")
        .executeTakeFirstOrThrow();
      if (vaccines.length)
        await trx
          .insertInto("vaccinations")
          .values(vaccines.map((v) => ({ ...v, business_id: businessId, pet_id: pet.id, is_demo: true })))
          .execute();
    }
    if (program && punches > 0)
      await trx
        .insertInto("astro_punches")
        .values({
          business_id: businessId,
          customer_id: row.id,
          program_id: program.id,
          qty: punches,
          kind: "opening_balance",
          is_demo: true,
        })
        .execute();
  }
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
