import type { Transaction } from "kysely";
import {
  AppError,
  cleanCustomer,
  isCustomerKind,
  isUniqueViolation,
  normalizeEmail,
  normalizePhone,
  validateCustomer,
  type CustomerInput,
  type CustomerKind,
} from "@pet-pos/core";
import type { DB } from "@pet-pos/db";
import { defineHandler } from "../handler.ts";
import { audit, likePattern } from "../shared.ts";

export interface PunchCard {
  programId: string;
  programName: string;
  balance: number;
  buyCount: number;
  rewardText: string;
}

export interface CustomerCard {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  birthday: string | null;
  kind: CustomerKind;
  /** A retailer's store name. */
  company: string | null;
  emailOptIn: boolean;
  followUpOn: string | null;
  tags: TagChip[];
  punchCards: PunchCard[];
}

export interface TagChip {
  id: string;
  name: string;
}

export interface CustomerProfile extends CustomerCard {
  smsOptIn: boolean;
  notes: string | null;
  wholesaleTerms: string | null;
  followUpNote: string | null;
}

export const CUSTOMER_COLUMNS = [
  "id",
  "name",
  "phone",
  "email",
  "street",
  "city",
  "state",
  "zip",
  "birthday",
  "kind",
  "company",
  "email_opt_in as emailOptIn",
  "follow_up_on as followUpOn",
] as const;

/** Adds tags and punch cards to customer rows (two queries, however many customers). */
export async function toCards(
  trx: Transaction<DB>,
  rows: Omit<CustomerCard, "punchCards" | "tags">[],
): Promise<CustomerCard[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const cards = await punchCards(trx, ids);
  const tags = await tagsFor(trx, ids);
  return rows.map((r) => ({ ...r, tags: tags.get(r.id) ?? [], punchCards: cards.get(r.id) ?? [] }));
}

/** Each customer's tags, by name. */
export async function tagsFor(trx: Transaction<DB>, customerIds: string[]): Promise<Map<string, TagChip[]>> {
  const rows = customerIds.length
    ? await trx
        .selectFrom("customer_tags as ct")
        .innerJoin("tags as t", "t.id", "ct.tag_id")
        .select(["ct.customer_id", "t.id", "t.name"])
        .where("ct.customer_id", "in", customerIds)
        .orderBy("t.name")
        .execute()
    : [];
  const map = new Map<string, TagChip[]>();
  for (const { customer_id, ...tag } of rows) map.set(customer_id, [...(map.get(customer_id) ?? []), tag]);
  return map;
}

async function punchCards(trx: Transaction<DB>, customerIds: string[]): Promise<Map<string, PunchCard[]>> {
  const rows = await trx
    .selectFrom("astro_balances as b")
    .innerJoin("astro_programs as a", "a.id", "b.program_id")
    .select([
      "b.customer_id",
      "b.program_id as programId",
      "a.name as programName",
      "b.balance",
      "a.buy_count as buyCount",
      "a.reward_text as rewardText",
    ])
    .where("b.customer_id", "in", customerIds)
    .where("b.balance", ">", 0)
    .orderBy("a.name")
    .execute();
  const map = new Map<string, PunchCard[]>();
  for (const { customer_id, ...card } of rows) map.set(customer_id, [...(map.get(customer_id) ?? []), card]);
  return map;
}

/**
 * Name, store name or email; three or more digits also match anywhere in the phone.
 * Optionally only one customer type, or only customers with a tag.
 */
export const searchCustomers = defineHandler<
  { q: string; kind?: CustomerKind | null; tagId?: string | null },
  CustomerCard[]
>({
  action: "customers.view",
  async run(trx, _ctx, { q, kind, tagId }) {
    let query = trx.selectFrom("customers as c").select(CUSTOMER_COLUMNS.map((k) => `c.${k}` as const));
    if (kind) {
      if (!isCustomerKind(kind)) throw new AppError("invalid", "Pick People or Retailers.");
      query = query.where("c.kind", "=", kind);
    }
    if (tagId)
      query = query.where((eb) =>
        eb.exists(
          eb
            .selectFrom("customer_tags as ct")
            .select("ct.tag_id")
            .whereRef("ct.customer_id", "=", "c.id")
            .where("ct.tag_id", "=", tagId),
        ),
      );
    const text = q.trim();
    if (text) {
      const pat = likePattern(text);
      const digits = text.replace(/\D/g, "");
      query = query.where((eb) =>
        eb.or([
          eb("c.name", "ilike", pat),
          eb("c.company", "ilike", pat),
          eb("c.email", "ilike", pat),
          ...(digits.length >= 3 ? [eb("c.phone", "like", `%${digits}%`)] : []),
        ]),
      );
    }
    const rows = await query.orderBy("c.name").limit(100).execute();
    return toCards(trx, rows);
  },
});

/** Exact match on the phone, typed in any format. For the register (Phase 2). */
export const lookupByPhone = defineHandler<{ phone: string }, CustomerCard | null>({
  action: "customers.view",
  async run(trx, _ctx, { phone }) {
    const digits = normalizePhone(phone);
    if (!digits) return null;
    const row = await trx
      .selectFrom("customers")
      .select(CUSTOMER_COLUMNS)
      .where("phone", "=", digits)
      .executeTakeFirst();
    return row ? ((await toCards(trx, [row]))[0] ?? null) : null;
  },
});

export const getCustomer = defineHandler<{ id: string }, CustomerProfile>({
  action: "customers.view",
  async run(trx, _ctx, { id }) {
    const c = await trx
      .selectFrom("customers")
      .select([...CUSTOMER_COLUMNS, "sms_opt_in", "notes", "wholesale_terms", "follow_up_note"])
      .where("id", "=", id)
      .executeTakeFirst();
    if (!c) throw new AppError("not_found", "That customer doesn't exist. They may have been deleted.");
    const { sms_opt_in, notes, wholesale_terms, follow_up_note, ...rest } = c;
    const [card] = await toCards(trx, [rest]);
    return {
      ...card!,
      smsOptIn: sms_opt_in,
      notes,
      wholesaleTerms: wholesale_terms,
      followUpNote: follow_up_note,
    };
  },
});

/** Adds a customer, or updates one when an id is given. */
export const saveCustomer = defineHandler<{ id?: string; customer: CustomerInput }, { id: string }>({
  action: "customers.edit",
  async run(trx, ctx, input) {
    const errors = validateCustomer(input.customer);
    const first = Object.values(errors)[0];
    if (first) throw new AppError("invalid", first, errors as Record<string, string>);

    const c = cleanCustomer(input.customer);
    const values = {
      name: c.name,
      phone: c.phone,
      email: c.email,
      street: c.street,
      city: c.city,
      state: c.state,
      zip: c.zip,
      birthday: c.birthday,
      sms_opt_in: c.smsOptIn,
      notes: c.notes,
      // Older callers don't send these; leave what's stored alone.
      ...(input.customer.kind !== undefined
        ? { kind: c.kind, company: c.company, wholesale_terms: c.wholesaleTerms }
        : {}),
      ...(input.customer.emailOptIn !== undefined ? { email_opt_in: c.emailOptIn } : {}),
    };

    try {
      let id = input.id;
      if (id) {
        const res = await trx.updateTable("customers").set(values).where("id", "=", id).executeTakeFirst();
        if (res.numUpdatedRows === 0n)
          throw new AppError("not_found", "That customer doesn't exist anymore.");
      } else {
        id = (
          await trx
            .insertInto("customers")
            .values({ ...values, business_id: ctx.businessId })
            .returning("id")
            .executeTakeFirstOrThrow()
        ).id;
      }
      // Ticking "email" again means they agreed again: lift an earlier unsubscribe.
      if (c.emailOptIn && c.email)
        await trx
          .deleteFrom("email_suppressions")
          .where("email", "=", normalizeEmail(c.email))
          .where("reason", "=", "unsubscribed")
          .execute();
      return { id };
    } catch (err) {
      if (isUniqueViolation(err, "customers_phone_per_business"))
        throw new AppError("conflict", "Another customer already has that phone number.", {
          phone: "Another customer already has that phone number.",
        });
      if (isUniqueViolation(err, "customers_email_per_business"))
        throw new AppError("conflict", "Another customer already has that email.", {
          email: "Another customer already has that email.",
        });
      throw err;
    }
  },
});

export interface DeletePreview {
  name: string;
  punchCards: number;
}

async function preview(trx: Transaction<DB>, id: string): Promise<DeletePreview> {
  const c = await trx.selectFrom("customers").select("name").where("id", "=", id).executeTakeFirst();
  if (!c) throw new AppError("not_found", "That customer doesn't exist. They may have been deleted.");
  const cards = await punchCards(trx, [id]);
  return {
    name: c.name,
    punchCards: cards.get(id)?.length ?? 0,
  };
}

/** What a delete removes, for the warning before the typed confirmation. */
export const deletePreview = defineHandler<{ id: string }, DeletePreview>({
  action: "customers.delete",
  async run(trx, _ctx, { id }) {
    return preview(trx, id);
  },
});

/**
 * Deletes the customer and their punch cards. The audit entry
 * keeps the name and counts only, never contact details.
 */
export const deleteCustomer = defineHandler<{ id: string }, void>({
  action: "customers.delete",
  async run(trx, ctx, { id }) {
    const p = await preview(trx, id);
    await trx.deleteFrom("customers").where("id", "=", id).execute();
    await audit(trx, ctx, {
      action: "customer.delete",
      entity: "customer",
      entityId: id,
      before: {
        name: p.name,
        punch_cards: p.punchCards,
      },
    });
  },
});
