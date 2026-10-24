import { sql } from "kysely";
import { normalizePhone, normalizeZip, parseLooseDate, parseYesNo } from "@pet-pos/core";
import { diff, Skip, text, type Row, type RowCtx, type RowResult } from "./base.ts";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A past date, or null with a warning. */
function pastDate(rc: RowCtx, raw: string | undefined, what: string): string | null | undefined {
  if (raw === undefined) return undefined;
  const d = parseLooseDate(raw, rc.today);
  if (d === null) return undefined;
  if (d === undefined) {
    rc.warn(`${what} "${raw}" isn't a date, left blank`);
    return undefined;
  }
  if (d > rc.today) {
    rc.warn(`${what} ${d} is in the future, left blank`);
    return undefined;
  }
  return d;
}

/** Finds a customer by phone, then email. Refuses a row whose phone and email point at two people. */
async function findCustomer(rc: RowCtx, phone: string | null, email: string | null) {
  const byPhone = phone
    ? await rc.trx.selectFrom("customers").selectAll().where("phone", "=", phone).executeTakeFirst()
    : undefined;
  const byEmail = email
    ? await rc.trx
        .selectFrom("customers")
        .selectAll()
        .where(sql`lower(email)`, "=", email.toLowerCase())
        .executeTakeFirst()
    : undefined;
  if (byPhone && byEmail && byPhone.id !== byEmail.id)
    throw new Skip("Phone and email belong to two different customers");
  return byPhone ?? byEmail;
}

/** Customers file. */
export async function customerRow(r: Row, rc: RowCtx): Promise<RowResult> {
  const name = (text(r.name) ?? [text(r.first), text(r.last)].filter(Boolean).join(" ")).trim();
  const phoneRaw = text(r.phone);
  const phone = normalizePhone(phoneRaw);
  if (phoneRaw && !phone) throw new Skip("Phone isn't 10 digits");
  let email = text(r.email) ?? null;
  if (email && !EMAIL.test(email)) {
    rc.warn(`Email "${email}" doesn't look like an email, left out`);
    email = null;
  }
  if (!phone && !email) throw new Skip("No phone or email");

  const existing = await findCustomer(rc, phone, email);
  if (!existing && !name) throw new Skip("No name");

  const values: Record<string, unknown> = {
    name: name || undefined,
    phone: phone ?? undefined,
    email: email ?? undefined,
    street: text(r.street),
    city: text(r.city),
    notes: text(r.notes),
  };
  const state = text(r.state);
  if (state) {
    if (/^[A-Za-z]{2}$/.test(state)) values.state = state.toUpperCase();
    else rc.warn(`State "${state}" isn't a 2-letter state, left blank`);
  }
  if (r.zip) {
    const zip = normalizeZip(r.zip);
    if (zip) values.zip = zip;
    else if (zip === undefined) rc.warn(`ZIP "${r.zip}" isn't a ZIP code, left blank`);
  }
  values.birthday = pastDate(rc, r.birthday, "Birthday");
  if (r.smsOptIn !== undefined) {
    const yes = parseYesNo(r.smsOptIn);
    if (yes === undefined) rc.warn(`SMS opt-in "${r.smsOptIn}" isn't yes or no, left as it was`);
    else if (yes !== null) values.sms_opt_in = yes;
  }

  let action: RowResult["action"];
  if (existing) {
    action = "update";
    const d = diff(existing, values);
    if (d) {
      await rc.trx.updateTable("customers").set(d.after).where("id", "=", existing.id).execute();
      await rc.changes.add("customer", existing.id, "updated", d.before, d.after);
    }
  } else {
    const row = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined));
    const inserted = await rc.trx
      .insertInto("customers")
      .values({
        ...row,
        name,
        business_id: rc.ctx.businessId,
        import_batch_id: rc.changes.batchId,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    action = "new";
    await rc.changes.add("customer", inserted.id, "created", null, row);
  }
  return { action, label: name || existing!.name };
}
