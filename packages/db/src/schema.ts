// Kysely table types. Keep in step with migrations/.
import type { ColumnType, Generated, Selectable } from "kysely";
import type { Role } from "@pet-pos/core";

type CreatedAt = Generated<Date>;
type UpdatedAt = Generated<Date>;
/** jsonb: read as an object, written as a JSON string. */
type Json<T> = ColumnType<T, string | undefined, string>;

export interface BusinessesTable {
  id: Generated<string>;
  name: string;
  slug: string;
  brand_color: string | null;
  logo_key: string | null;
  modules: Json<Record<string, boolean>>;
  is_demo: Generated<boolean>;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface LocationsTable {
  id: Generated<string>;
  business_id: string;
  name: string;
  timezone: Generated<string>;
  tax_rate_bp: Generated<number>;
  is_demo: Generated<boolean>;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface StaffTable {
  id: Generated<string>;
  business_id: string;
  name: string;
  email: string | null;
  role: Role;
  cognito_sub: string | null;
  active: Generated<boolean>;
  is_demo: Generated<boolean>;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface AstroProgramsTable {
  id: Generated<string>;
  business_id: string;
  name: string;
  brand: string | null;
  buy_count: number;
  reward_text: Generated<string>;
  astro_program_ref: string | null;
  active: Generated<boolean>;
  is_demo: Generated<boolean>;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface ProductsTable {
  id: Generated<string>;
  business_id: string;
  sku: string;
  barcode: string | null;
  name: string;
  brand: string | null;
  category: Generated<string>;
  price_cents: number;
  cost_cents: Generated<number>;
  tax_class: Generated<TaxClass>;
  reorder_at: Generated<number>;
  astro_program_id: string | null;
  astro_offer_label: string | null;
  astro_offer_cents: number | null;
  active: Generated<boolean>;
  is_demo: Generated<boolean>;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface InventoryLevelsTable {
  business_id: string;
  product_id: string;
  location_id: string;
  on_hand: Generated<number>;
  back_bar_on_hand: Generated<number>;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface InventoryMovesTable {
  id: Generated<string>;
  business_id: string;
  product_id: string;
  location_id: string;
  qty_change: number;
  reason: MoveReason;
  ref_id: string | null;
  staff_id: string | null;
  note: string | null;
  is_demo: Generated<boolean>;
  created_at: CreatedAt;
}

export interface AuditLogTable {
  id: Generated<string>;
  business_id: string;
  staff_id: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  before: Json<Record<string, unknown>> | null;
  after: Json<Record<string, unknown>> | null;
  created_at: CreatedAt;
}

/** Postgres date, kept as "YYYY-MM-DD" (see parsers.ts). */
type DateString = string;

export interface CustomersTable {
  id: Generated<string>;
  business_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  birthday: DateString | null;
  sms_opt_in: Generated<boolean>;
  notes: string | null;
  astro_customer_id: string | null;
  is_demo: Generated<boolean>;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export type Species = "dog" | "cat" | "other";
export type PetSize = "S" | "M" | "L" | "XL";

export interface PetsTable {
  id: Generated<string>;
  business_id: string;
  customer_id: string;
  name: string;
  species: Generated<Species>;
  breed: string | null;
  size: PetSize | null;
  coat: string | null;
  birthday: DateString | null;
  weight_lb: number | null;
  temperament: string | null;
  allergies: string | null;
  vet_name: string | null;
  is_demo: Generated<boolean>;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface VaccinationsTable {
  id: Generated<string>;
  business_id: string;
  pet_id: string;
  vaccine: string;
  expires_on: DateString;
  proof_file_key: string | null;
  is_demo: Generated<boolean>;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export type PunchKind = "earn" | "redeem" | "opening_balance";

export interface AstroPunchesTable {
  id: Generated<string>;
  business_id: string;
  customer_id: string;
  program_id: string;
  sale_id: string | null;
  qty: number;
  kind: PunchKind;
  is_demo: Generated<boolean>;
  created_at: CreatedAt;
}

export interface AstroBalancesView {
  business_id: string;
  customer_id: string;
  program_id: string;
  balance: number;
}

export interface DemoSeedPartsTable {
  business_id: string;
  part: string;
  seeded_at: Generated<Date>;
}

export type TaxClass = "standard" | "exempt";
export type MoveReason = "sale" | "receive" | "adjust" | "consume" | "return";

export interface DB {
  businesses: BusinessesTable;
  locations: LocationsTable;
  staff: StaffTable;
  astro_programs: AstroProgramsTable;
  products: ProductsTable;
  inventory_levels: InventoryLevelsTable;
  inventory_moves: InventoryMovesTable;
  audit_log: AuditLogTable;
  customers: CustomersTable;
  pets: PetsTable;
  vaccinations: VaccinationsTable;
  astro_punches: AstroPunchesTable;
  astro_balances: AstroBalancesView;
  demo_seed_parts: DemoSeedPartsTable;
}

export type Business = Selectable<BusinessesTable>;
export type Location = Selectable<LocationsTable>;
export type Staff = Selectable<StaffTable>;
export type Product = Selectable<ProductsTable>;
export type AstroProgram = Selectable<AstroProgramsTable>;
