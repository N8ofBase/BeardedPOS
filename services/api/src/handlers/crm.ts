// Customer relationships: tags, the timeline on each profile, follow-ups, what a retailer
// has earned us, and the one door the store server uses to add people it meets online.
import { CompiledQuery, sql, type Transaction } from "kysely";
import {
  addProfit,
  AppError,
  cleanTagName,
  isIsoDate,
  isUniqueViolation,
  lineProfit,
  looksLikeEmail,
  NO_PROFIT,
  normalizeEmail,
  normalizePhone,
  type Profit,
} from "@bearded/core";
import type { CustomerEventKind, DB } from "@bearded/db";
import { defineHandler } from "../handler.ts";
import { profitLineQuery } from "./profit.ts";

type Trx = Transaction<DB>;

// ---- tags ----

export interface TagRow {
  id: string;
  name: string;
  customers: number;
}

export const listTags = defineHandler<void, TagRow[]>({
  action: "customers.view",
  async run(trx) {
    return trx
      .selectFrom("tags as t")
      .select([
        "t.id",
        "t.name",
        sql<number>`(SELECT count(*) FROM customer_tags ct WHERE ct.tag_id = t.id)::int`.as("customers"),
      ])
      .orderBy(sql`lower(t.name)`)
      .execute();
  },
});

const TAG_DUP = "There's already a tag with that name.";

/** Finds a tag by name, any case, or adds it. */
async function tagId(trx: Trx, businessId: string, name: string, isDemo = false): Promise<string> {
  const clean = cleanTagName(name);
  if (!clean) throw new AppError("invalid", "Tags are 1 to 40 characters.");
  const found = await trx
    .selectFrom("tags")
    .select("id")
    .where(sql`lower(name)`, "=", clean.toLowerCase())
    .executeTakeFirst();
  if (found) return found.id;
  return (
    await trx
      .insertInto("tags")
      .values({ business_id: businessId, name: clean, is_demo: isDemo })
      .returning("id")
      .executeTakeFirstOrThrow()
  ).id;
}

/** Renames a tag (with an id) or adds one. */
export const saveTag = defineHandler<{ id?: string; name: string }, { id: string }>({
  action: "tags.manage",
  async run(trx, ctx, { id, name }) {
    const clean = cleanTagName(name ?? "");
    if (!clean)
      throw new AppError("invalid", "Tags are 1 to 40 characters.", { name: "Tags are 1 to 40 characters." });
    try {
      if (!id)
        return {
          id: (
            await trx
              .insertInto("tags")
              .values({ business_id: ctx.businessId, name: clean })
              .returning("id")
              .executeTakeFirstOrThrow()
          ).id,
        };
      const res = await trx.updateTable("tags").set({ name: clean }).where("id", "=", id).executeTakeFirst();
      if (res.numUpdatedRows === 0n) throw new AppError("not_found", "That tag doesn't exist anymore.");
      return { id };
    } catch (err) {
      if (isUniqueViolation(err, "tags_name_per_business"))
        throw new AppError("conflict", TAG_DUP, { name: TAG_DUP });
      throw err;
    }
  },
});

/** Takes the tag off every customer and deletes it. Emails already sent keep their counts. */
export const deleteTag = defineHandler<{ id: string }, void>({
  action: "tags.manage",
  async run(trx, _ctx, { id }) {
    const res = await trx.deleteFrom("tags").where("id", "=", id).executeTakeFirst();
    if (res.numDeletedRows === 0n) throw new AppError("not_found", "That tag doesn't exist anymore.");
  },
});

/** Replaces a customer's tags with these names, adding any tag that doesn't exist yet. */
export const setCustomerTags = defineHandler<{ customerId: string; tags: string[] }, void>({
  action: "customers.edit",
  async run(trx, ctx, { customerId, tags }) {
    await requireCustomer(trx, customerId);
    if (!Array.isArray(tags) || tags.length > 30)
      throw new AppError("invalid", "A customer can have up to 30 tags.");
    const ids = new Set<string>();
    for (const name of tags) ids.add(await tagId(trx, ctx.businessId, String(name)));
    await trx.deleteFrom("customer_tags").where("customer_id", "=", customerId).execute();
    if (ids.size)
      await trx
        .insertInto("customer_tags")
        .values([...ids].map((tag_id) => ({ business_id: ctx.businessId, customer_id: customerId, tag_id })))
        .execute();
  },
});

async function requireCustomer(trx: Trx, id: string): Promise<{ name: string }> {
  const c = await trx.selectFrom("customers").select("name").where("id", "=", id).executeTakeFirst();
  if (!c) throw new AppError("not_found", "That customer doesn't exist. They may have been deleted.");
  return c;
}

// ---- timeline and follow-ups ----

export type TimelineKind = CustomerEventKind | "sale";

export interface TimelineEntry {
  id: string;
  kind: TimelineKind;
  at: Date;
  summary: string;
  /** Who added it, for notes and follow-ups. */
  staffName: string | null;
  /** Sales: the receipt, to open it. */
  saleId: string | null;
}

/** Everything that happened with a customer, newest first: their events and their sales. */
export const customerTimeline = defineHandler<{ customerId: string }, TimelineEntry[]>({
  action: "customers.view",
  async run(trx, _ctx, { customerId }) {
    await requireCustomer(trx, customerId);
    const events = await trx
      .selectFrom("customer_events as e")
      .leftJoin("staff as s", "s.id", "e.staff_id")
      .select(["e.id", "e.kind", "e.created_at as at", "e.summary", "s.name as staffName"])
      .where("e.customer_id", "=", customerId)
      .orderBy("e.created_at", "desc")
      .limit(200)
      .execute();
    const sales = await trx
      .selectFrom("sales")
      .select([
        "id",
        "receipt_number",
        "source",
        "status",
        "total_cents",
        "refunded_cents",
        "created_at",
        "import_key",
      ])
      .where("customer_id", "=", customerId)
      .where("status", "=", "paid")
      .orderBy("created_at", "desc")
      .limit(200)
      .execute();
    const money = (c: number) => `$${(c / 100).toFixed(2)}`;
    const entries: TimelineEntry[] = [
      ...events.map((e) => ({ ...e, saleId: null })),
      ...sales.map((s) => ({
        id: s.id,
        kind: "sale" as const,
        at: s.created_at,
        summary:
          (s.source === "import"
            ? `Past order, ${money(s.total_cents)}`
            : `Bought ${money(s.total_cents)}, receipt #${s.receipt_number}`) +
          (s.refunded_cents > 0 ? ` (${money(s.refunded_cents)} refunded)` : ""),
        staffName: null,
        saleId: s.source === "register" ? s.id : null,
      })),
    ];
    return entries.sort((a, b) => b.at.getTime() - a.at.getTime());
  },
});

export const addCustomerNote = defineHandler<{ customerId: string; text: string }, void>({
  action: "customers.edit",
  async run(trx, ctx, { customerId, text }) {
    await requireCustomer(trx, customerId);
    const t = (text ?? "").trim();
    if (!t) throw new AppError("invalid", "Write the note first.");
    if (t.length > 2000) throw new AppError("invalid", "Keep a note under 2,000 characters.");
    await addEvent(trx, {
      businessId: ctx.businessId,
      customerId,
      kind: "note",
      summary: t,
      staffId: ctx.staffId,
    });
  },
});

/** Sets or clears the date to get back to a customer (a retailer reorder, say). */
export const setFollowUp = defineHandler<{ customerId: string; on: string | null; note: string }, void>({
  action: "customers.edit",
  async run(trx, ctx, { customerId, on, note }) {
    await requireCustomer(trx, customerId);
    if (on !== null && !isIsoDate(on)) throw new AppError("invalid", "Pick a real date.");
    const n = (note ?? "").trim() || null;
    if (n && n.length > 200) throw new AppError("invalid", "Keep the follow-up note under 200 characters.");
    await trx
      .updateTable("customers")
      .set({ follow_up_on: on, follow_up_note: on ? n : null })
      .where("id", "=", customerId)
      .execute();
    await addEvent(trx, {
      businessId: ctx.businessId,
      customerId,
      kind: "follow_up",
      summary: on ? `Follow up on ${on}${n ? `: ${n}` : ""}` : "Follow-up cleared",
      staffId: ctx.staffId,
    });
  },
});

export interface FollowUpRow {
  id: string;
  name: string;
  company: string | null;
  on: string;
  note: string | null;
}

/** Customers with a follow-up date, soonest first (overdue ones on top). */
export const followUps = defineHandler<void, FollowUpRow[]>({
  action: "customers.view",
  async run(trx) {
    return trx
      .selectFrom("customers")
      .select(["id", "name", "company", "follow_up_on as on", "follow_up_note as note"])
      .where("follow_up_on", "is not", null)
      .orderBy("follow_up_on")
      .orderBy("name")
      .limit(100)
      .execute() as Promise<FollowUpRow[]>;
  },
});

export async function addEvent(
  trx: Trx,
  e: {
    businessId: string;
    customerId: string;
    kind: CustomerEventKind;
    summary: string;
    staffId?: string | null;
    refId?: string | null;
  },
): Promise<void> {
  await trx
    .insertInto("customer_events")
    .values({
      business_id: e.businessId,
      customer_id: e.customerId,
      kind: e.kind,
      summary: e.summary.slice(0, 2000),
      staff_id: e.staffId ?? null,
      ref_id: e.refId ?? null,
    })
    .execute();
}

// ---- what a customer has earned us ----

export interface CustomerProfit extends Profit {
  orders: number;
}

/** Net profit on a customer's register sales, after refunds. Retailers show it on their profile. */
export const customerProfit = defineHandler<{ customerId: string }, CustomerProfit>({
  action: "sales.view",
  async run(trx, _ctx, { customerId }) {
    await requireCustomer(trx, customerId);
    const lines = await profitLineQuery(trx)
      .select("s.id as saleId")
      .where("s.customer_id", "=", customerId)
      .execute();
    let total = { ...NO_PROFIT };
    for (const l of lines)
      total = addProfit(total, lineProfit({ ...l, unitCostCents: l.savedCostCents ?? l.currentCostCents }));
    return { ...total, orders: new Set(lines.map((l) => l.saleId)).size };
  },
});

// ---- people the store meets online ----

/**
 * The smallest database handle: what the store server has (pg, PGlite). Run it inside
 * withBusiness so row-level security applies.
 */
export interface SqlClient {
  query<R>(text: string, params: unknown[]): Promise<{ rows: R[] }>;
}

/** Wraps a Kysely transaction as a SqlClient. */
export function sqlClient(trx: Trx): SqlClient {
  return {
    async query<R>(text: string, params: unknown[]) {
      const r = await trx.executeQuery<R>(CompiledQuery.raw(text, params));
      return { rows: [...r.rows] };
    },
  };
}

export interface StoreContact {
  email: string;
  phone?: string | null;
  /** As typed; a VIP signup has none, so the email stands in. */
  name?: string | null;
  source: "vip" | "review" | "order";
  /** They ticked "email me" (VIP signups always have). */
  optIn: boolean;
  /** The store's own row id (review, order). */
  refId?: string | null;
  /** Timeline text; a plain default per source otherwise. */
  summary?: string | null;
}

const SOURCE_EVENT: Record<StoreContact["source"], { kind: CustomerEventKind; summary: string }> = {
  vip: { kind: "vip_signup", summary: "Joined the VIP list on the website" },
  review: { kind: "review", summary: "Wrote a review on the website" },
  order: { kind: "order", summary: "Ordered on the website" },
};

export const VIP_TAG = "VIP";

/**
 * Adds or matches the customer behind a website signup, review or order, and notes it on
 * their timeline. Matches on phone, then email. A VIP signup tags them VIP; ticking
 * "email me" opts them in again even if they unsubscribed before (bounces and spam
 * complaints still block sending).
 */
export async function recordStoreContact(
  db: SqlClient,
  businessId: string,
  c: StoreContact,
): Promise<{ customerId: string; created: boolean }> {
  const email = normalizeEmail(c.email ?? "");
  if (!looksLikeEmail(email))
    throw new AppError("invalid", "Check the email address, like name@example.com.");
  if (!SOURCE_EVENT[c.source]) throw new AppError("invalid", "Unknown signup source.");
  const phone = c.phone ? normalizePhone(c.phone) : null;
  const name = (c.name ?? "").trim().slice(0, 100) || email;

  let found: { id: string; email: string | null } | undefined;
  if (phone)
    found = (
      await db.query<{ id: string; email: string | null }>(
        "SELECT id, email FROM customers WHERE phone = $1",
        [phone],
      )
    ).rows[0];
  if (!found)
    found = (
      await db.query<{ id: string; email: string | null }>(
        "SELECT id, email FROM customers WHERE lower(email) = $1",
        [email],
      )
    ).rows[0];

  let customerId: string;
  const created = !found;
  if (found) {
    customerId = found.id;
    if (!found.email)
      await db.query(
        `UPDATE customers SET email = $2
          WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM customers o WHERE lower(o.email) = $2)`,
        [customerId, email],
      );
  } else {
    customerId = (
      await db.query<{ id: string }>(
        "INSERT INTO customers (business_id, name, email, phone) VALUES ($1, $2, $3, $4) RETURNING id",
        [businessId, name, email, phone],
      )
    ).rows[0]!.id;
  }

  if (c.optIn) {
    await db.query("UPDATE customers SET email_opt_in = true WHERE id = $1 AND email IS NOT NULL", [
      customerId,
    ]);
    await db.query("DELETE FROM email_suppressions WHERE email = $1 AND reason = 'unsubscribed'", [email]);
  }
  if (c.source === "vip") {
    await db.query(
      `INSERT INTO tags (business_id, name) VALUES ($1, $2)
         ON CONFLICT (business_id, lower(name)) DO NOTHING`,
      [businessId, VIP_TAG],
    );
    await db.query(
      `INSERT INTO customer_tags (business_id, customer_id, tag_id)
         SELECT $1, $2, id FROM tags WHERE lower(name) = lower($3)
         ON CONFLICT DO NOTHING`,
      [businessId, customerId, VIP_TAG],
    );
  }
  const ev = SOURCE_EVENT[c.source];
  await db.query(
    "INSERT INTO customer_events (business_id, customer_id, kind, summary, ref_id) VALUES ($1, $2, $3, $4, $5)",
    [businessId, customerId, ev.kind, (c.summary ?? "").trim().slice(0, 2000) || ev.summary, c.refId ?? null],
  );
  return { customerId, created };
}
