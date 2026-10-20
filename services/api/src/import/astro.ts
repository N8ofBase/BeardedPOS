import { sql } from "kysely";
import { normalizePhone, parseCount } from "@pet-pos/core";
import { diff, Skip, text, type Row, type RowCtx, type RowResult } from "./base.ts";

/** Astro programs file: matched by name, ignoring case. */
export async function programRow(r: Row, rc: RowCtx): Promise<RowResult> {
  const name = text(r.name);
  if (!name) throw new Skip("No program name");
  const buy = parseCount(r.buyCount ?? "");
  if (!buy || buy < 2) throw new Skip("Buy count missing or under 2");
  const existing = await rc.trx
    .selectFrom("astro_programs")
    .selectAll()
    .where(sql`lower(name)`, "=", name.toLowerCase())
    .executeTakeFirst();
  const values = { buy_count: buy, brand: text(r.brand), reward_text: text(r.reward) };
  if (existing) {
    const d = diff(existing, values);
    if (d) {
      await rc.trx.updateTable("astro_programs").set(d.after).where("id", "=", existing.id).execute();
      await rc.changes.add("program", existing.id, "updated", d.before, d.after);
    }
    return { action: "update", label: existing.name };
  }
  const row = {
    name,
    buy_count: buy,
    brand: values.brand ?? null,
    reward_text: values.reward_text ?? "Reward",
  };
  const { id } = await rc.trx
    .insertInto("astro_programs")
    .values({ ...row, business_id: rc.ctx.businessId })
    .returning("id")
    .executeTakeFirstOrThrow();
  await rc.changes.add("program", id, "created", null, row);
  return { action: "new", label: name };
}

/**
 * Punch balances file: the number becomes the customer's balance for the program.
 * Earlier opening balances are replaced by one opening_balance row; punches earned
 * or redeemed in this system are counted, so the total comes out at the file's number.
 */
export async function punchRow(r: Row, rc: RowCtx): Promise<RowResult> {
  const phone = normalizePhone(r.phone);
  const email = text(r.email);
  let customer = phone
    ? await rc.trx
        .selectFrom("customers")
        .select(["id", "name"])
        .where("phone", "=", phone)
        .executeTakeFirst()
    : undefined;
  if (!customer && email)
    customer = await rc.trx
      .selectFrom("customers")
      .select(["id", "name"])
      .where(sql`lower(email)`, "=", email.toLowerCase())
      .executeTakeFirst();
  if (!customer) throw new Skip("No customer with that phone or email");

  const programName = text(r.program);
  if (!programName) throw new Skip("No program name");
  const program = await rc.trx
    .selectFrom("astro_programs")
    .select(["id", "name"])
    .where(sql`lower(name)`, "=", programName.toLowerCase())
    .executeTakeFirst();
  if (!program) throw new Skip(`Unknown program "${programName}"`);

  const n = parseCount(r.count ?? "");
  if (n === null || n === undefined) throw new Skip("Punch count isn't a number");

  const punches = await rc.trx
    .selectFrom("astro_punches")
    .selectAll()
    .where("customer_id", "=", customer.id)
    .where("program_id", "=", program.id)
    .execute();
  const earnedHere = punches.reduce(
    (s, p) =>
      s +
      (p.kind === "earn" || p.kind === "reward_return"
        ? p.qty
        : p.kind === "redeem" || p.kind === "refund_reversal"
          ? -p.qty
          : 0),
    0,
  );
  const opening = n - earnedHere;
  if (opening < 0)
    throw new Skip("This customer has earned more punches here since; check the balance in Astro");
  const openings = punches.filter((p) => p.kind === "opening_balance");
  const label = `${customer.name} · ${program.name}: ${n}`;
  if (openings.length === (opening > 0 ? 1 : 0) && (openings[0]?.qty ?? 0) === opening)
    return { action: "update", label };

  for (const p of openings) {
    await rc.trx.deleteFrom("astro_punches").where("id", "=", p.id).execute();
    await rc.changes.add("punch", p.id, "deleted", { ...p }, null);
  }
  if (opening > 0) {
    const row = {
      customer_id: customer.id,
      program_id: program.id,
      qty: opening,
      kind: "opening_balance" as const,
    };
    const { id } = await rc.trx
      .insertInto("astro_punches")
      .values({ ...row, business_id: rc.ctx.businessId, import_batch_id: rc.changes.batchId })
      .returning("id")
      .executeTakeFirstOrThrow();
    await rc.changes.add("punch", id, "created", null, row);
  }
  return { action: "update", label };
}
