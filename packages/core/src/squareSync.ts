// Keeping the register in step with the store's Square account. Square is the home for items,
// prices and stock: a sync brings them into the register. These rules decide what matches what;
// they don't read or write anything. Products match by the Square variation they were linked to,
// then SKU, then barcode, then name. Customers match by Square id, then phone, then email.
import { normalizePhone } from "./phone.ts";

/** One thing Square sells at the store's location (an item variation). */
export interface SquareShelfItem {
  variationId: string;
  /** "Fences", or "Fences (Deluxe)" for a named variation. */
  name: string;
  sku: string | null;
  barcode: string | null;
  /** Null for a variable price, which the register can't ring up. */
  priceCents: number | null;
  costCents: number | null;
  category: string | null;
  /** Square counts its stock. */
  tracksStock: boolean;
  /** Square's count at the location, when it counts. */
  stock: number | null;
}

/** A register product, as the sync compares it. */
export interface ShelfProduct {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  priceCents: number;
  costCents: number;
  onHand: number;
  squareVariationId: string | null;
  squareTracksStock: boolean;
}

export type ProductMatch = "linked" | "sku" | "barcode" | "name";

export interface ProductChange {
  item: SquareShelfItem;
  productId: string;
  match: ProductMatch;
  /** Only what differs from the register. */
  changes: { name?: string; priceCents?: number; costCents?: number; tracksStock?: boolean };
  /** Square's count when it differs from the register's (null: leave stock alone). */
  stockTo: number | null;
  stockFrom: number;
}

export interface NewProduct {
  item: SquareShelfItem;
  sku: string;
  /** Square's barcode, unless another register product already has it. */
  barcode: string | null;
}

export interface ProductPlan {
  create: NewProduct[];
  /** Matched products (linked or not yet): only those with something to change. */
  update: ProductChange[];
  /** Matched products already the same as Square. */
  unchanged: number;
  /** Square items the register can't ring up. */
  skipped: { item: SquareShelfItem; reason: string }[];
  /** Register products Square doesn't sell (left as they are). */
  onlyInRegister: { id: string; name: string }[];
}

const key = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/** A register SKU for a Square item without one (or whose SKU another product has). */
export function squareSku(variationId: string): string {
  return `SQ-${variationId.slice(-8).toUpperCase()}`;
}

/**
 * What a sync would change. `waiting` lists products with stock changes not yet sent to Square:
 * their count is left alone until Square has them, so a sale isn't counted twice.
 */
export function planProducts(
  square: SquareShelfItem[],
  shelf: ShelfProduct[],
  waiting: ReadonlySet<string> = new Set(),
): ProductPlan {
  const claimed = new Set<string>();
  const byVariation = new Map(shelf.filter((p) => p.squareVariationId).map((p) => [p.squareVariationId!, p]));
  const free = (p: ShelfProduct | undefined) =>
    p &&
    !claimed.has(p.id) &&
    (!p.squareVariationId || !square.some((s) => s.variationId === p.squareVariationId))
      ? p
      : undefined;
  const find = (pick: (p: ShelfProduct) => boolean) => free(shelf.find((p) => !claimed.has(p.id) && pick(p)));
  const skus = new Set(shelf.map((p) => key(p.sku)));
  const barcodes = new Set(shelf.map((p) => p.barcode).filter(Boolean));

  const plan: ProductPlan = { create: [], update: [], unchanged: 0, skipped: [], onlyInRegister: [] };
  for (const item of square) {
    if (item.priceCents === null) {
      plan.skipped.push({ item, reason: "Variable price in Square" });
      continue;
    }
    let match: ProductMatch | null = null;
    let product = byVariation.get(item.variationId);
    if (product && !claimed.has(product.id)) match = "linked";
    else if ((product = item.sku ? find((p) => key(p.sku) === key(item.sku)) : undefined)) match = "sku";
    else if ((product = item.barcode ? find((p) => p.barcode === item.barcode) : undefined))
      match = "barcode";
    else if ((product = find((p) => key(p.name) === key(item.name)))) match = "name";

    if (!product || !match) {
      const sku = item.sku && !skus.has(key(item.sku)) ? item.sku.trim() : squareSku(item.variationId);
      skus.add(key(sku));
      const barcode = item.barcode && !barcodes.has(item.barcode) ? item.barcode : null;
      if (barcode) barcodes.add(barcode);
      plan.create.push({ item, sku, barcode });
      continue;
    }
    claimed.add(product.id);
    const changes: ProductChange["changes"] = {};
    if (item.name.trim() && item.name.trim() !== product.name) changes.name = item.name.trim();
    if (item.priceCents !== product.priceCents) changes.priceCents = item.priceCents;
    if (item.costCents !== null && item.costCents !== product.costCents) changes.costCents = item.costCents;
    if (item.tracksStock !== product.squareTracksStock) changes.tracksStock = item.tracksStock;
    const stockTo =
      item.tracksStock && item.stock !== null && item.stock !== product.onHand && !waiting.has(product.id)
        ? item.stock
        : null;
    if (match !== "linked" || Object.keys(changes).length > 0 || stockTo !== null)
      plan.update.push({ item, productId: product.id, match, changes, stockTo, stockFrom: product.onHand });
    else plan.unchanged++;
  }
  plan.onlyInRegister = shelf.filter((p) => !claimed.has(p.id)).map((p) => ({ id: p.id, name: p.name }));
  return plan;
}

/** A customer in Square's directory. */
export interface SquareCustomer {
  id: string;
  name: string;
  /** 10 digits, or null. */
  phone: string | null;
  /** Lower case, or null. */
  email: string | null;
}

export interface ShelfCustomer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  squareCustomerId: string | null;
}

export interface CustomerPlan {
  /** Register customers to link to their Square customer, filling in a missing phone or email. */
  link: { customerId: string; square: SquareCustomer; fill: { phone?: string; email?: string } }[];
  /** Square customers the register doesn't have yet. */
  create: SquareCustomer[];
  /** Register customers Square doesn't have yet (added to Square). */
  push: ShelfCustomer[];
  unchanged: number;
  /** Square customers whose phone or email another register customer already has (left out). */
  duplicates: SquareCustomer[];
}

/** Square's customer fields, tidied the register's way (phone 10 digits, email lower case). */
export function squareCustomer(c: {
  id: string;
  given_name?: string;
  family_name?: string;
  company_name?: string;
  email_address?: string;
  phone_number?: string;
}): SquareCustomer | null {
  const email = c.email_address?.trim().toLowerCase() || null;
  const phone = normalizePhone(c.phone_number);
  const name =
    [c.given_name, c.family_name]
      .map((s) => s?.trim())
      .filter(Boolean)
      .join(" ") ||
    c.company_name?.trim() ||
    email ||
    (phone ? `Customer ${phone.slice(-4)}` : "");
  return name && (phone || email || c.given_name || c.family_name) ? { id: c.id, name, phone, email } : null;
}

export function planCustomers(square: SquareCustomer[], shelf: ShelfCustomer[]): CustomerPlan {
  const plan: CustomerPlan = { link: [], create: [], push: [], unchanged: 0, duplicates: [] };
  // The register allows one customer per phone and per email.
  const phones = new Set(shelf.map((c) => c.phone).filter(Boolean));
  const emails = new Set(shelf.map((c) => key(c.email)).filter(Boolean));
  const claimed = new Set<string>();
  const linked = new Map(shelf.filter((c) => c.squareCustomerId).map((c) => [c.squareCustomerId!, c]));
  const open = shelf.filter((c) => !c.squareCustomerId);
  for (const s of square) {
    const known = linked.get(s.id);
    if (known) {
      claimed.add(known.id);
      plan.unchanged++;
      continue;
    }
    const match =
      (s.phone && open.find((c) => !claimed.has(c.id) && c.phone === s.phone)) ||
      (s.email && open.find((c) => !claimed.has(c.id) && key(c.email) === s.email)) ||
      undefined;
    if (!match) {
      if ((s.phone && phones.has(s.phone)) || (s.email && emails.has(s.email))) {
        plan.duplicates.push(s);
        continue;
      }
      if (s.phone) phones.add(s.phone);
      if (s.email) emails.add(s.email);
      plan.create.push(s);
      continue;
    }
    claimed.add(match.id);
    const fill: { phone?: string; email?: string } = {};
    if (!match.phone && s.phone && !phones.has(s.phone)) {
      fill.phone = s.phone;
      phones.add(s.phone);
    }
    if (!match.email && s.email && !emails.has(s.email)) {
      fill.email = s.email;
      emails.add(s.email);
    }
    plan.link.push({ customerId: match.id, square: s, fill });
  }
  plan.push = open.filter((c) => !claimed.has(c.id) && (c.phone || c.email));
  return plan;
}
