import { AppError, isHexColor, parseTaxPercent } from "@pet-pos/core";
import { defineHandler } from "../handler.ts";
import { audit } from "../shared.ts";

export interface StoreSettings {
  name: string;
  brandColor: string | null;
  logo: string | null;
  locationId: string;
  locationName: string;
  taxRateMpct: number;
  /** Astro offers and rewards come off before tax (true) or after. */
  astroDiscountsBeforeTax: boolean;
  /** Managers can refund up to this without the owner's OK. */
  refundApprovalCents: number;
}

/** Largest logo data URL accepted (the browser resizes to 256 px first). */
export const MAX_LOGO_CHARS = 300_000;

export const getSettings = defineHandler<void, StoreSettings>({
  action: "settings.view",
  async run(trx, ctx) {
    const b = await trx
      .selectFrom("businesses")
      .select(["name", "brand_color", "logo_data", "astro_discounts_before_tax", "refund_approval_cents"])
      .where("id", "=", ctx.businessId)
      .executeTakeFirstOrThrow();
    const loc = await trx
      .selectFrom("locations")
      .select(["id", "name", "tax_rate_mpct"])
      .orderBy("created_at")
      .executeTakeFirst();
    if (!loc) throw new AppError("invalid", "This store has no location set up yet.");
    return {
      name: b.name,
      brandColor: b.brand_color,
      logo: b.logo_data,
      locationId: loc.id,
      locationName: loc.name,
      taxRateMpct: loc.tax_rate_mpct,
      astroDiscountsBeforeTax: b.astro_discounts_before_tax,
      refundApprovalCents: b.refund_approval_cents,
    };
  },
});

export interface SettingsInput {
  name: string;
  brandColor: string | null;
  /** data:image/… URL, or null to remove the logo. */
  logo: string | null;
  locationName: string;
  /** As typed: "8.875" or "8.875%". */
  taxPercent: string;
  astroDiscountsBeforeTax: boolean;
  /** Left out: unchanged. */
  refundApprovalCents?: number;
}

export const updateSettings = defineHandler<SettingsInput, void>({
  action: "settings.edit",
  async run(trx, ctx, input) {
    const errors: Record<string, string> = {};
    const name = input.name.trim();
    if (!name) errors.name = "Store name is required.";
    const locationName = input.locationName.trim();
    if (!locationName) errors.locationName = "Location name is required.";
    if (input.brandColor !== null && !isHexColor(input.brandColor))
      errors.brandColor = "Pick a color with the color picker.";
    if (
      input.logo !== null &&
      (!/^data:image\/(png|jpeg|webp);base64,/.test(input.logo) || input.logo.length > MAX_LOGO_CHARS)
    )
      errors.logo = "Use a PNG, JPG or WebP image under 200 KB.";
    const tax = parseTaxPercent(input.taxPercent);
    if (tax === null) errors.taxPercent = "Enter the sales tax as a percent, like 8.875.";
    const limit = input.refundApprovalCents;
    if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 0 || limit > 10_000_000))
      errors.refundApprovalCents = "Enter the refund limit in dollars, like 50.00.";
    const first = Object.values(errors)[0];
    if (first) throw new AppError("invalid", first, errors);

    const before = await trx
      .selectFrom("businesses")
      .select("refund_approval_cents")
      .where("id", "=", ctx.businessId)
      .executeTakeFirstOrThrow();
    await trx
      .updateTable("businesses")
      .set({
        ...(limit !== undefined ? { refund_approval_cents: limit } : {}),
        name,
        brand_color: input.brandColor,
        logo_data: input.logo,
        astro_discounts_before_tax: input.astroDiscountsBeforeTax,
      })
      .where("id", "=", ctx.businessId)
      .execute();

    const loc = await trx
      .selectFrom("locations")
      .select(["id", "tax_rate_mpct"])
      .orderBy("created_at")
      .executeTakeFirstOrThrow();
    await trx
      .updateTable("locations")
      .set({ name: locationName, tax_rate_mpct: tax! })
      .where("id", "=", loc.id)
      .execute();
    if (limit !== undefined && limit !== before.refund_approval_cents)
      await audit(trx, ctx, {
        action: "settings.refund_limit",
        entity: "business",
        entityId: ctx.businessId,
        before: { refund_approval_cents: before.refund_approval_cents },
        after: { refund_approval_cents: limit },
      });
    // The tax rate changes what customers pay, so it's audited like a price change.
    if (loc.tax_rate_mpct !== tax)
      await audit(trx, ctx, {
        action: "settings.tax_rate",
        entity: "location",
        entityId: loc.id,
        before: { tax_rate_mpct: loc.tax_rate_mpct },
        after: { tax_rate_mpct: tax },
      });
  },
});
