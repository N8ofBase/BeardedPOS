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

export interface DB {
  businesses: BusinessesTable;
  locations: LocationsTable;
  staff: StaffTable;
}

export type Business = Selectable<BusinessesTable>;
export type Location = Selectable<LocationsTable>;
export type Staff = Selectable<StaffTable>;
