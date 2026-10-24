// Square over its REST API: the Sandbox for now, the real account once N8 says so. Plain fetch, no
// SDK. The access token comes from the server's environment and never reaches the browser.
import { createHash } from "node:crypto";
import type { SquareCatalog, SquareItem } from "@bearded/store-core";
import type { SquareStore } from "./types.ts";

export const SQUARE_VERSION = "2024-12-18";
export const SQUARE_URLS = {
  sandbox: "https://connect.squareupsandbox.com",
  live: "https://connect.squareup.com",
} as const;

/** How long a catalog read is reused, so a busy page doesn't call Square on every visit. */
export const CATALOG_SECONDS = 60;

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export interface SquareApiOptions {
  mode: "sandbox" | "live";
  token: string;
  /** The store's Square location; when left out, the account's main location. */
  locationId?: string;
  fetch?: Fetch;
  now?: () => number;
}

// No constructor parameter properties here or below: the seed script runs on Node's type stripping.
export class SquareApiError extends Error {
  readonly status: number;
  readonly codes: string[];
  constructor(status: number, codes: string[], message: string) {
    super(message);
    this.status = status;
    this.codes = codes;
  }
}

// Only the fields the store reads.
interface Money {
  amount?: number;
  currency?: string;
}
export interface CatalogObject {
  type: string;
  id: string;
  is_deleted?: boolean;
  present_at_all_locations?: boolean;
  present_at_location_ids?: string[];
  absent_at_location_ids?: string[];
  item_data?: {
    name?: string;
    product_type?: string;
    image_ids?: string[];
    variations?: CatalogObject[];
  };
  item_variation_data?: {
    name?: string;
    pricing_type?: string;
    price_money?: Money;
    track_inventory?: boolean;
    location_overrides?: { location_id?: string; track_inventory?: boolean }[];
  };
  image_data?: { url?: string };
}
interface SquareOrder {
  id: string;
  state?: string;
  tenders?: unknown[];
  net_amount_due_money?: Money;
  total_money?: Money;
}

const soldAt = (o: CatalogObject, location: string) =>
  !o.is_deleted &&
  (o.present_at_all_locations
    ? !(o.absent_at_location_ids ?? []).includes(location)
    : (o.present_at_location_ids ?? []).includes(location));

/** Paid in full: Square took a payment and nothing is left to pay. Payment-link orders stay OPEN until fulfilled. */
export const orderIsPaid = (o: SquareOrder) =>
  o.state === "COMPLETED" ||
  (o.state === "OPEN" && (o.tenders?.length ?? 0) > 0 && (o.net_amount_due_money?.amount ?? 1) === 0);

/** Turns Square catalog objects and stock counts into the store's catalog shape. */
export function toCatalog(
  objects: CatalogObject[],
  counts: Map<string, number>,
  locationId: string,
  capturedAt: string,
): SquareCatalog {
  const images = new Map(
    objects.filter((o) => o.type === "IMAGE" && o.image_data?.url).map((o) => [o.id, o.image_data!.url!]),
  );
  const items: SquareItem[] = [];
  let currency = "USD";
  for (const item of objects) {
    if (item.type !== "ITEM" || !item.item_data || !soldAt(item, locationId)) continue;
    const data = item.item_data;
    for (const v of data.variations ?? []) {
      const vd = v.item_variation_data;
      if (!vd || !soldAt(v, locationId)) continue;
      const fixed = vd.pricing_type !== "VARIABLE_PRICING" && Number.isInteger(vd.price_money?.amount);
      if (vd.price_money?.currency) currency = vd.price_money.currency;
      const override = vd.location_overrides?.find((l) => l.location_id === locationId);
      const tracksStock = override?.track_inventory ?? vd.track_inventory ?? false;
      items.push({
        itemId: item.id,
        variationId: v.id,
        name: data.name ?? "",
        variationName: vd.name ?? null,
        productType: data.product_type ?? "REGULAR",
        priceCents: fixed ? vd.price_money!.amount! : null,
        tracksStock,
        stock: tracksStock ? (counts.get(v.id) ?? 0) : null,
        imageUrl: images.get(data.image_ids?.[0] ?? "") ?? null,
      });
    }
  }
  return { capturedAt, locationId, currency, items };
}

export class SquareApiStore implements SquareStore {
  readonly mode: "sandbox" | "live";
  private readonly base: string;
  private readonly fetchFn: Fetch;
  private readonly now: () => number;
  private location: Promise<string> | undefined;
  private cached: { at: number; value: Promise<SquareCatalog> } | undefined;

  private readonly opts: SquareApiOptions;

  constructor(opts: SquareApiOptions) {
    if (!opts.token) throw new Error("A Square access token is required.");
    this.opts = opts;
    this.mode = opts.mode;
    this.base = SQUARE_URLS[opts.mode];
    this.fetchFn = opts.fetch ?? ((url, init) => fetch(url, init));
    this.now = opts.now ?? Date.now;
    if (opts.locationId) this.location = Promise.resolve(opts.locationId);
  }

  async call<T>(method: "GET" | "POST" | "PUT", path: string, body?: unknown): Promise<T> {
    const res = await this.fetchFn(`${this.base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.opts.token}`,
        "Square-Version": SQUARE_VERSION,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as T & {
      errors?: { code?: string; detail?: string }[];
    };
    if (!res.ok) {
      const errors = data.errors ?? [];
      throw new SquareApiError(
        res.status,
        errors.map((e) => e.code ?? "UNKNOWN"),
        `Square ${method} ${path} failed (${res.status}): ${errors.map((e) => e.detail ?? e.code).join("; ")}`,
      );
    }
    return data;
  }

  locationId(): Promise<string> {
    this.location ??= this.call<{ location?: { id: string } }>("GET", "/v2/locations/main").then((r) => {
      if (!r.location?.id) throw new Error("This Square account has no main location.");
      return r.location.id;
    });
    return this.location;
  }

  catalog(): Promise<SquareCatalog> {
    const at = this.now();
    if (this.cached && at - this.cached.at < CATALOG_SECONDS * 1000) return this.cached.value;
    const value = this.readCatalog(at);
    this.cached = { at, value };
    value.catch(() => {
      if (this.cached?.value === value) this.cached = undefined;
    });
    return value;
  }

  private async readCatalog(at: number): Promise<SquareCatalog> {
    const locationId = await this.locationId();
    const objects: CatalogObject[] = [];
    let cursor: string | undefined;
    do {
      const q = new URLSearchParams({ types: "ITEM,IMAGE" });
      if (cursor) q.set("cursor", cursor);
      const page = await this.call<{ objects?: CatalogObject[]; cursor?: string }>(
        "GET",
        `/v2/catalog/list?${q}`,
      );
      objects.push(...(page.objects ?? []));
      cursor = page.cursor;
    } while (cursor);

    const tracked = objects
      .filter((o) => o.type === "ITEM")
      .flatMap((o) => o.item_data?.variations ?? [])
      .map((v) => v.id);
    const counts = new Map<string, number>();
    for (let i = 0; i < tracked.length; i += 500) {
      let countCursor: string | undefined;
      do {
        const page = await this.call<{
          counts?: { catalog_object_id: string; state: string; quantity?: string }[];
          cursor?: string;
        }>("POST", "/v2/inventory/counts/batch-retrieve", {
          catalog_object_ids: tracked.slice(i, i + 500),
          location_ids: [locationId],
          states: ["IN_STOCK"],
          cursor: countCursor,
        });
        for (const c of page.counts ?? [])
          counts.set(c.catalog_object_id, Math.max(0, Math.floor(Number(c.quantity ?? 0))));
        countCursor = page.cursor;
      } while (countCursor);
    }
    return toCatalog(objects, counts, locationId, new Date(at).toISOString());
  }

  async createPaymentLink(order: {
    id: string;
    lines: { productId: string; qty: number }[];
    redirectUrl: string;
  }) {
    const r = await this.call<{ payment_link: { id: string; url: string; order_id?: string } }>(
      "POST",
      "/v2/online-checkout/payment-links",
      {
        // Our order id: a retry of the same checkout gets the same link instead of a second order.
        idempotency_key: order.id,
        order: {
          location_id: await this.locationId(),
          reference_id: order.id,
          line_items: order.lines.map((l) => ({ catalog_object_id: l.productId, quantity: String(l.qty) })),
          pricing_options: { auto_apply_taxes: true },
        },
        checkout_options: { redirect_url: order.redirectUrl },
      },
    );
    return {
      url: r.payment_link.url,
      squareOrderId: r.payment_link.order_id ?? null,
      paymentLinkId: r.payment_link.id,
    };
  }

  /** Whether Square's order for a checkout has been paid. */
  async orderPaid(squareOrderId: string): Promise<boolean> {
    const r = await this.call<{ order?: SquareOrder }>(
      "GET",
      `/v2/orders/${encodeURIComponent(squareOrderId)}`,
    );
    return !!r.order && orderIsPaid(r.order);
  }

  private async customerIds(email: string): Promise<string[]> {
    const r = await this.call<{ customers?: { id: string }[] }>("POST", "/v2/customers/search", {
      query: { filter: { email_address: { exact: email } } },
      limit: 10,
    });
    return (r.customers ?? []).map((c) => c.id);
  }

  async upsertCustomer(email: string): Promise<void> {
    if ((await this.customerIds(email)).length > 0) return;
    await this.call("POST", "/v2/customers", {
      // One customer per email even if two signups race. Square caps keys at 45 characters.
      idempotency_key: `bbg-vip-${createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 36)}`,
      email_address: email,
      note: "Joined the VIP list on the website.",
    });
  }

  async hasPaidOrder(email: string): Promise<boolean> {
    const ids = await this.customerIds(email);
    if (ids.length === 0) return false;
    const r = await this.call<{ orders?: SquareOrder[] }>("POST", "/v2/orders/search", {
      location_ids: [await this.locationId()],
      query: { filter: { customer_filter: { customer_ids: ids } } },
      limit: 50,
    });
    return (r.orders ?? []).some(orderIsPaid);
  }
}
