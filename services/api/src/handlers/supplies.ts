// Back-bar supplies: what a groom used comes off stock once, when the groom is
// finished (ready for pickup, or paid / marked done without passing through ready).
// Undoing "ready" puts it back. Moves reference the appointment, so the net is exact.
import { sql, type Transaction } from "kysely";
import { suppliesFor, type Ctx, type PetSize } from "@pet-pos/core";
import type { DB } from "@pet-pos/db";
import { currentLocationId } from "../shared.ts";

type Trx = Transaction<DB>;

async function serviceSupplies(trx: Trx, serviceIds: string[]) {
  if (!serviceIds.length) return [];
  const rows = await trx
    .selectFrom("service_supplies")
    .select(["product_id", "qty_s", "qty_m", "qty_l", "qty_xl"])
    .where("service_id", "in", serviceIds)
    .execute();
  return rows.map((r) => ({
    productId: r.product_id,
    qty: { S: r.qty_s, M: r.qty_m, L: r.qty_l, XL: r.qty_xl } as Record<PetSize, number>,
  }));
}

export async function useSupplies(trx: Trx, ctx: Ctx, appointmentId: string): Promise<void> {
  const a = await trx
    .selectFrom("appointments")
    .select(["service_id", "size", "pet_name", "supplies_used_at"])
    .where("id", "=", appointmentId)
    .executeTakeFirst();
  if (!a || a.supplies_used_at) return;
  const addons = await trx
    .selectFrom("appointment_addons")
    .select("service_id")
    .where("appointment_id", "=", appointmentId)
    .execute();
  const used = suppliesFor(
    await serviceSupplies(trx, [a.service_id, ...addons.map((x) => x.service_id)]),
    a.size,
  );
  if (used.length) {
    const locationId = await currentLocationId(trx);
    await trx
      .insertInto("inventory_moves")
      .values(
        used.map((u) => ({
          business_id: ctx.businessId,
          product_id: u.productId,
          location_id: locationId,
          qty_change: -u.qty,
          reason: "consume" as const,
          ref_id: appointmentId,
          staff_id: ctx.staffId,
          note: `Used on ${a.pet_name}'s groom`,
        })),
      )
      .execute();
  }
  await trx
    .updateTable("appointments")
    .set({ supplies_used_at: new Date() })
    .where("id", "=", appointmentId)
    .execute();
}

export async function returnSupplies(trx: Trx, ctx: Ctx, appointmentId: string): Promise<void> {
  const a = await trx
    .selectFrom("appointments")
    .select(["pet_name", "supplies_used_at"])
    .where("id", "=", appointmentId)
    .executeTakeFirst();
  if (!a?.supplies_used_at) return;
  const net = await trx
    .selectFrom("inventory_moves")
    .select(["product_id", "location_id", sql<number>`sum(qty_change)::int`.as("n")])
    .where("ref_id", "=", appointmentId)
    .where("reason", "=", "consume")
    .groupBy(["product_id", "location_id"])
    .execute();
  const back = net.filter((r) => r.n < 0);
  if (back.length)
    await trx
      .insertInto("inventory_moves")
      .values(
        back.map((r) => ({
          business_id: ctx.businessId,
          product_id: r.product_id,
          location_id: r.location_id,
          qty_change: -r.n,
          reason: "consume" as const,
          ref_id: appointmentId,
          staff_id: ctx.staffId,
          note: `Put back: ${a.pet_name}'s groom wasn't finished`,
        })),
      )
      .execute();
  await trx
    .updateTable("appointments")
    .set({ supplies_used_at: null })
    .where("id", "=", appointmentId)
    .execute();
}
