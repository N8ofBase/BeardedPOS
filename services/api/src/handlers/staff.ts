import { AppError, type Role } from "@pet-pos/core";
import { defineHandler } from "../handler.ts";

export interface Me {
  staff: { id: string; name: string; role: Role };
  business: { id: string; name: string; brandColor: string | null; modules: Record<string, boolean> };
  location: { id: string; name: string; taxRateBp: number } | null;
}

/** The signed-in staff member, their business and its first location. */
export const me = defineHandler<void, Me>({
  action: null,
  async run(trx, ctx) {
    const staff = await trx
      .selectFrom("staff")
      .select(["id", "name", "role", "active"])
      .where("id", "=", ctx.staffId)
      .executeTakeFirst();
    if (!staff || !staff.active)
      throw new AppError("forbidden", "This staff account isn't active. Ask the owner.");
    if (staff.role !== ctx.role) throw new AppError("forbidden", "Your role changed. Sign in again.");

    const business = await trx
      .selectFrom("businesses")
      .select(["id", "name", "brand_color", "modules"])
      .where("id", "=", ctx.businessId)
      .executeTakeFirstOrThrow();
    const location = await trx
      .selectFrom("locations")
      .select(["id", "name", "tax_rate_bp"])
      .orderBy("created_at")
      .executeTakeFirst();

    return {
      staff: { id: staff.id, name: staff.name, role: staff.role },
      business: {
        id: business.id,
        name: business.name,
        brandColor: business.brand_color,
        modules: business.modules,
      },
      location: location ? { id: location.id, name: location.name, taxRateBp: location.tax_rate_bp } : null,
    };
  },
});

export interface StaffListItem {
  id: string;
  name: string;
  role: Role;
  active: boolean;
}

export const listStaff = defineHandler<void, StaffListItem[]>({
  action: "staff.view",
  async run(trx) {
    return trx.selectFrom("staff").select(["id", "name", "role", "active"]).orderBy("name").execute();
  },
});
