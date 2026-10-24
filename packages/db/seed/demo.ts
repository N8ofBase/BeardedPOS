// Sample records for the demo. Every row is is_demo = true and named "(DEMO)",
// so "Remove all demo data" can find exactly these. Runs as the database owner.
//
// ensureDemo() fills in whatever part is missing, so a browser seeded by an
// earlier version picks up new sample data after an update without a reset.
import type { Kysely, Transaction } from "kysely";
import { addDays, isIsoDate, todayIso, type Role } from "@bearded/core";
import type { DB } from "../src/schema.ts";

const DEMO_STAFF: { name: string; email: string; role: Role }[] = [
  { name: "Sample Owner (DEMO)", email: "owner.demo@example.com", role: "owner" },
  { name: "Sample Manager (DEMO)", email: "manager.demo@example.com", role: "manager" },
  { name: "Sample Cashier (DEMO)", email: "cashier.demo@example.com", role: "cashier" },
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
    await once(trx, businessId, "discounts", "discounts", seedDiscounts);
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
  table: "products" | "customers" | "discounts",
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
      name: "Sample Game Shop (DEMO)",
      slug: "sample-game-shop-demo",
      brand_color: "#14614f",
      is_demo: true,
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  await trx
    .insertInto("locations")
    .values({ business_id: business.id, name: "Main store (DEMO)", tax_rate_mpct: 7000, is_demo: true })
    .execute();

  await trx
    .insertInto("staff")
    .values(
      DEMO_STAFF.map((s) => ({
        ...s,
        business_id: business.id,
        is_demo: true,
      })),
    )
    .execute();

  return business.id;
}

// Sample games and an accessory, with the prototype's prices and stock.
const DEMO_PRODUCTS = [
  {
    sku: "0001",
    name: "Sample Strategy Game (DEMO)",
    brand: "Sample Brand",
    category: "Strategy games",
    price_cents: 6499,
    cost_cents: 4300,
    reorder_at: 6,
    on_hand: 14,
  },
  {
    sku: "0002",
    name: "Sample Family Game (DEMO)",
    brand: "Sample Brand",
    category: "Family games",
    price_cents: 3899,
    cost_cents: 2500,
    reorder_at: 5,
    on_hand: 4,
  },
  {
    sku: "0003",
    name: "Sample Card Game (DEMO)",
    brand: "Sample Card Co",
    category: "Card games",
    price_cents: 1299,
    cost_cents: 700,
    reorder_at: 10,
    on_hand: 30,
  },
  {
    sku: "0004",
    name: "Sample Card Sleeves (DEMO)",
    brand: null,
    category: "Accessories",
    price_cents: 899,
    cost_cents: 350,
    reorder_at: 4,
    on_hand: 0,
  },
];

async function seedInventory(trx: Transaction<DB>, businessId: string): Promise<void> {
  const location = await trx
    .selectFrom("locations")
    .select("id")
    .where("business_id", "=", businessId)
    .orderBy("created_at")
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
// day the demo is set up, so the birthday tag always shows.
async function seedCustomers(trx: Transaction<DB>, businessId: string): Promise<void> {
  const today = todayIso();
  // The same calendar day n years back (Feb 29 becomes Feb 28 in a non-leap year).
  const yearsAgo = (n: number, days = 0) => {
    const d = addDays(today, days);
    const back = `${Number(d.slice(0, 4)) - n}${d.slice(4)}`;
    return isIsoDate(back) ? back : back.replace(/-02-29$/, "-02-28");
  };
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
    },
  ];

  await trx
    .insertInto("customers")
    .values(customers.map((c) => ({ ...c, business_id: businessId, is_demo: true })))
    .execute();
}

// Example store discounts until the owner's real list is in.
async function seedDiscounts(trx: Transaction<DB>, businessId: string): Promise<void> {
  const base = { business_id: businessId, is_demo: true };
  await trx
    .insertInto("discounts")
    .values([
      {
        ...base,
        name: "Cash discount (DEMO)",
        code: "CASH",
        kind: "percent",
        percent_mpct: 3000,
        scope: "ticket",
        cash_only: true,
      },
      {
        ...base,
        name: "Employee discount (DEMO)",
        code: "EMP",
        kind: "percent",
        percent_mpct: 20000,
        scope: "ticket",
        ask_note: true,
      },
      {
        ...base,
        name: "Senior Tuesday (DEMO)",
        code: "SR10",
        kind: "percent",
        percent_mpct: 10000,
        scope: "ticket",
      },
      {
        ...base,
        name: "Damaged bag (DEMO)",
        code: "DMG",
        kind: "fixed",
        amount_cents: 500,
        scope: "line",
        needs_approval: true,
      },
    ])
    .execute();
}

export interface DemoStaff {
  id: string;
  businessId: string;
  name: string;
  role: Role;
}

/**
 * Everyone active at the demo store, for the role picker: the three (DEMO) logins first,
 * then staff added in Settings. Owner access: only the demo build may call this.
 */
export async function listDemoStaff(db: Kysely<DB>): Promise<DemoStaff[]> {
  const rows = await db
    .selectFrom("staff as s")
    .innerJoin("businesses as b", "b.id", "s.business_id")
    .select(["s.id", "s.business_id", "s.name", "s.role", "s.is_demo"])
    .where("b.is_demo", "=", true)
    .where("s.active", "=", true)
    .execute();
  const order: Role[] = ["owner", "manager", "cashier"];
  return rows
    .sort(
      (a, b) =>
        Number(b.is_demo) - Number(a.is_demo) ||
        order.indexOf(a.role) - order.indexOf(b.role) ||
        a.name.localeCompare(b.name),
    )
    .map((r) => ({ id: r.id, businessId: r.business_id, name: r.name, role: r.role }));
}

export async function demoBusinessId(db: Kysely<DB>): Promise<string | null> {
  const b = await db.selectFrom("businesses").select("id").where("is_demo", "=", true).executeTakeFirst();
  return b?.id ?? null;
}
