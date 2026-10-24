// Bulk email by customer type and tag. The audience is saved as rules; the server works
// out who gets it when it sends (audienceDecision() in core), so opt-outs made after the
// email was written are still respected. Sending goes through `mailer` (preview in the
// demo, Amazon SES when hosted), a batch at a time.
import { sql, type Transaction } from "kysely";
import {
  AppError,
  audienceDecision,
  cleanAudience,
  describeAudience,
  looksLikeEmail,
  normalizeEmail,
  renderCampaignEmail,
  unsubscribeUrl,
  validateCampaign,
  type Ctx,
  type CustomerKind,
  type EmailAudience,
  type EmailSender,
  type RenderedEmail,
} from "@bearded/core";
import type { CampaignStatus, DB, EmailSendStatus } from "@bearded/db";
import { mailer as defaultMailer, newUnsubscribeToken, type Mailer } from "../email/mailer.ts";
import { defineHandler } from "../handler.ts";
import { addEvent } from "./crm.ts";

type Trx = Transaction<DB>;

// ---- sender setup ----

export interface EmailSetup {
  fromName: string;
  fromAddress: string;
  mailingAddress: string;
  /** What's missing before anything can be sent; empty when ready. */
  missing: string[];
}

export const getEmailSetup = defineHandler<void, EmailSetup>({
  action: "email.send",
  async run(trx, ctx) {
    const b = await trx
      .selectFrom("businesses")
      .select(["name", "email_from_name", "email_from_address", "mailing_address"])
      .where("id", "=", ctx.businessId)
      .executeTakeFirstOrThrow();
    const setup = {
      fromName: b.email_from_name ?? b.name,
      fromAddress: b.email_from_address ?? "",
      mailingAddress: b.mailing_address ?? "",
    };
    return { ...setup, missing: missingSetup(setup) };
  },
});

function missingSetup(s: { fromAddress: string; mailingAddress: string }): string[] {
  const m: string[] = [];
  if (!s.fromAddress) m.push("the address email comes from");
  if (!s.mailingAddress) m.push("the store's mailing address for the email footer");
  return m;
}

export const saveEmailSetup = defineHandler<
  { fromName: string; fromAddress: string; mailingAddress: string },
  void
>({
  action: "settings.edit",
  async run(trx, ctx, input) {
    const fromName = input.fromName.trim();
    const fromAddress = input.fromAddress.trim().toLowerCase();
    const mailingAddress = input.mailingAddress.trim().replace(/\s*\n\s*/g, ", ");
    const errors: Record<string, string> = {};
    if (!fromName || fromName.length > 80) errors.fromName = "Add the name people see, up to 80 characters.";
    if (fromAddress && !looksLikeEmail(fromAddress))
      errors.fromAddress = "Enter an address like news@example.com.";
    if (mailingAddress.length > 200) errors.mailingAddress = "Keep the address under 200 characters.";
    const first = Object.values(errors)[0];
    if (first) throw new AppError("invalid", first, errors);
    await trx
      .updateTable("businesses")
      .set({
        email_from_name: fromName,
        email_from_address: fromAddress || null,
        mailing_address: mailingAddress || null,
      })
      .where("id", "=", ctx.businessId)
      .execute();
  },
});

async function senderFor(trx: Trx, businessId: string): Promise<EmailSender> {
  const b = await trx
    .selectFrom("businesses")
    .select(["name", "email_from_name", "email_from_address", "mailing_address"])
    .where("id", "=", businessId)
    .executeTakeFirstOrThrow();
  const s = {
    fromName: b.email_from_name ?? b.name,
    fromAddress: b.email_from_address ?? "",
    mailingAddress: b.mailing_address ?? "",
  };
  const missing = missingSetup(s);
  if (missing.length)
    throw new AppError("invalid", `Before sending, add ${missing.join(" and ")} in Settings.`);
  return s;
}

// ---- who gets it ----

interface Recipient {
  id: string;
  name: string;
  email: string;
}

export interface AudienceCount {
  /** Who will get the email. */
  count: number;
  /** Match the type and tags but won't get it. */
  noEmail: number;
  notOptedIn: number;
  suppressed: number;
  /** A few names, to check it looks right. */
  sample: string[];
  description: string;
}

async function resolveAudience(trx: Trx, audience: EmailAudience) {
  const rows = await trx
    .selectFrom("customers as c")
    .select([
      "c.id",
      "c.name",
      "c.kind",
      "c.email",
      "c.email_opt_in",
      sql<
        string[]
      >`coalesce((SELECT array_agg(ct.tag_id) FROM customer_tags ct WHERE ct.customer_id = c.id), '{}')`.as(
        "tag_ids",
      ),
    ])
    .orderBy("c.name")
    .execute();
  const suppressed = new Set(
    (await trx.selectFrom("email_suppressions").select("email").execute()).map((r) => r.email),
  );
  const out = { send: [] as Recipient[], noEmail: 0, notOptedIn: 0, suppressed: 0 };
  for (const r of rows) {
    const d = audienceDecision(
      { kind: r.kind as CustomerKind, email: r.email, emailOptIn: r.email_opt_in, tagIds: r.tag_ids },
      audience,
      suppressed,
    );
    if (d === "send") out.send.push({ id: r.id, name: r.name, email: r.email! });
    else if (d === "no_email") out.noEmail++;
    else if (d === "not_opted_in") out.notOptedIn++;
    else if (d === "suppressed") out.suppressed++;
  }
  return out;
}

async function tagNamer(trx: Trx): Promise<(id: string) => string> {
  const tags = await trx.selectFrom("tags").select(["id", "name"]).execute();
  const byId = new Map(tags.map((t) => [t.id, t.name]));
  return (id) => byId.get(id) ?? "(deleted tag)";
}

function checkAudience(a: EmailAudience): EmailAudience {
  try {
    return cleanAudience(a);
  } catch (err) {
    const msg =
      err instanceof Error && err.message !== "bad audience" ? err.message : "Pick who gets the email.";
    throw new AppError("invalid", msg);
  }
}

export const previewAudience = defineHandler<{ audience: EmailAudience }, AudienceCount>({
  action: "email.send",
  async run(trx, _ctx, input) {
    const audience = checkAudience(input.audience);
    const r = await resolveAudience(trx, audience);
    return {
      count: r.send.length,
      noEmail: r.noEmail,
      notOptedIn: r.notOptedIn,
      suppressed: r.suppressed,
      sample: r.send.slice(0, 5).map((s) => s.name),
      description: describeAudience(audience, await tagNamer(trx)),
    };
  },
});

// ---- campaigns ----

export interface CampaignCounts {
  total: number;
  queued: number;
  /** Sent, delivered, or (demo) previewed. */
  sent: number;
  delivered: number;
  bounced: number;
  complained: number;
  failed: number;
  unsubscribed: number;
}

export interface CampaignRow {
  id: string;
  subject: string;
  status: CampaignStatus;
  description: string;
  sendAt: Date | null;
  sentAt: Date | null;
  createdAt: Date;
  counts: CampaignCounts;
}

export interface CampaignDetail extends CampaignRow {
  body: string;
  audience: EmailAudience;
}

const NO_COUNTS: CampaignCounts = {
  total: 0,
  queued: 0,
  sent: 0,
  delivered: 0,
  bounced: 0,
  complained: 0,
  failed: 0,
  unsubscribed: 0,
};

async function countsFor(trx: Trx, ids: string[]): Promise<Map<string, CampaignCounts>> {
  const map = new Map<string, CampaignCounts>();
  if (!ids.length) return map;
  const rows = await trx
    .selectFrom("email_sends")
    .select(["campaign_id", "status", sql<number>`count(*)::int`.as("n")])
    .where("campaign_id", "in", ids)
    .groupBy(["campaign_id", "status"])
    .execute();
  for (const r of rows) {
    const c = { ...(map.get(r.campaign_id) ?? NO_COUNTS) };
    c.total += r.n;
    const s = r.status as EmailSendStatus;
    if (s === "queued") c.queued += r.n;
    else if (s === "failed") c.failed += r.n;
    else {
      c.sent += r.n;
      if (s === "delivered") c.delivered += r.n;
      if (s === "bounced") c.bounced += r.n;
      if (s === "complained") c.complained += r.n;
    }
    map.set(r.campaign_id, c);
  }
  const unsubs = await trx
    .selectFrom("customer_events")
    .select(["ref_id", sql<number>`count(*)::int`.as("n")])
    .where("kind", "=", "unsubscribed")
    .where("ref_id", "in", ids)
    .groupBy("ref_id")
    .execute();
  for (const u of unsubs) {
    const c = map.get(u.ref_id!);
    if (c) c.unsubscribed = u.n;
  }
  return map;
}

const CAMPAIGN_COLUMNS = [
  "id",
  "subject",
  "body",
  "audience",
  "status",
  "send_at as sendAt",
  "sent_at as sentAt",
  "created_at as createdAt",
] as const;

export const listCampaigns = defineHandler<void, CampaignRow[]>({
  action: "email.send",
  async run(trx) {
    const rows = await trx
      .selectFrom("email_campaigns")
      .select(CAMPAIGN_COLUMNS)
      .orderBy("created_at", "desc")
      .limit(100)
      .execute();
    const counts = await countsFor(
      trx,
      rows.map((r) => r.id),
    );
    const name = await tagNamer(trx);
    return rows.map(({ body: _b, audience, ...r }) => ({
      ...r,
      description: describeAudience(audience, name),
      counts: counts.get(r.id) ?? NO_COUNTS,
    }));
  },
});

export const getCampaign = defineHandler<{ id: string }, CampaignDetail>({
  action: "email.send",
  async run(trx, _ctx, { id }) {
    const r = await trx
      .selectFrom("email_campaigns")
      .select(CAMPAIGN_COLUMNS)
      .where("id", "=", id)
      .executeTakeFirst();
    if (!r) throw new AppError("not_found", "That email doesn't exist anymore.");
    const counts = await countsFor(trx, [id]);
    return {
      ...r,
      description: describeAudience(r.audience, await tagNamer(trx)),
      counts: counts.get(id) ?? NO_COUNTS,
    };
  },
});

export interface CampaignInput {
  id?: string;
  subject: string;
  body: string;
  audience: EmailAudience;
}

function checkCampaign(input: CampaignInput) {
  const errors = validateCampaign(input);
  const first = Object.values(errors)[0];
  if (first) throw new AppError("invalid", first, errors as Record<string, string>);
  return { subject: input.subject.trim(), body: input.body, audience: checkAudience(input.audience) };
}

/** Saves a draft. Emails that are sending or sent can't change. */
export const saveCampaign = defineHandler<CampaignInput, { id: string }>({
  action: "email.send",
  async run(trx, ctx, input) {
    const c = checkCampaign(input);
    const values = { subject: c.subject, body: c.body, audience: JSON.stringify(c.audience) };
    if (!input.id)
      return trx
        .insertInto("email_campaigns")
        .values({ ...values, business_id: ctx.businessId, created_by: ctx.staffId })
        .returning("id")
        .executeTakeFirstOrThrow();
    const res = await trx
      .updateTable("email_campaigns")
      .set({ ...values, status: "draft", send_at: null })
      .where("id", "=", input.id)
      .where("status", "in", ["draft", "scheduled"])
      .executeTakeFirst();
    if (res.numUpdatedRows === 0n)
      throw new AppError("conflict", "This email has already gone out, so it can't change.");
    return { id: input.id };
  },
});

export const deleteCampaign = defineHandler<{ id: string }, void>({
  action: "email.send",
  async run(trx, _ctx, { id }) {
    const res = await trx
      .deleteFrom("email_campaigns")
      .where("id", "=", id)
      .where("status", "in", ["draft", "scheduled"])
      .executeTakeFirst();
    if (res.numDeletedRows === 0n)
      throw new AppError("conflict", "Only drafts and scheduled emails can be deleted.");
  },
});

/** Sends the draft to one address (yours) to check it. Nobody else gets it. */
export const sendTestEmail = defineHandler<{ subject: string; body: string; to: string }, RenderedEmail>({
  action: "email.send",
  async run(trx, ctx, input) {
    const errors = validateCampaign(input);
    const first = Object.values(errors)[0];
    if (first) throw new AppError("invalid", first);
    const to = normalizeEmail(input.to ?? "");
    if (!looksLikeEmail(to)) throw new AppError("invalid", "Enter the address to send the test to.");
    const staff = await trx
      .selectFrom("staff")
      .select("name")
      .where("id", "=", ctx.staffId)
      .executeTakeFirst();
    const email = renderCampaignEmail({
      sender: await senderFor(trx, ctx.businessId),
      to,
      name: staff?.name ?? "",
      subject: `[Test] ${input.subject.trim()}`,
      body: input.body,
      unsubscribeUrl: unsubscribeUrl(defaultMailer.siteUrl, ctx.businessId, "test"),
    });
    await defaultMailer.send(email, { businessId: ctx.businessId, sendId: "test" });
    return email;
  },
});

/**
 * Sends now (sendAt null or past) or schedules. Saves the draft first, so what was
 * on screen is what goes out.
 */
export const sendCampaign = defineHandler<CampaignInput & { sendAt: string | null }, SendResult>({
  action: "email.send",
  async run(trx, ctx, input) {
    const { id } = await saveCampaign.run(trx, ctx, input);
    await senderFor(trx, ctx.businessId);
    if (input.sendAt) {
      const at = new Date(input.sendAt);
      if (Number.isNaN(at.getTime())) throw new AppError("invalid", "Pick a real date and time.");
      if (at.getTime() > Date.now() + 60_000) {
        await trx
          .updateTable("email_campaigns")
          .set({ status: "scheduled", send_at: at })
          .where("id", "=", id)
          .execute();
        return { id, queued: 0, sent: 0, failed: 0, left: 0, scheduled: true };
      }
    }
    const queued = await queueCampaign(trx, ctx.businessId, id, ctx.staffId);
    if (queued === 0) throw new AppError("invalid", "Nobody matches those tags and has agreed to email.");
    return { id, queued, scheduled: false, ...(await sendAll(trx, ctx, id)) };
  },
});

export interface SendResult {
  id: string;
  queued: number;
  sent: number;
  failed: number;
  /** Still queued; the hosted worker picks them up. */
  left: number;
  scheduled: boolean;
}

/** Demo mode sends right away; hosted mode leaves the queue to the worker. */
async function sendAll(trx: Trx, ctx: Ctx, id: string) {
  if (!defaultMailer.preview) return { sent: 0, failed: 0, left: await queuedCount(trx, id) };
  return deliverBatch(trx, defaultMailer, ctx.businessId, id, Number.MAX_SAFE_INTEGER);
}

async function queuedCount(trx: Trx, id: string) {
  return (
    await trx
      .selectFrom("email_sends")
      .select(sql<number>`count(*)::int`.as("n"))
      .where("campaign_id", "=", id)
      .where("status", "=", "queued")
      .executeTakeFirstOrThrow()
  ).n;
}

/**
 * Works out who gets the email now and adds one queued send for each. Returns how many.
 * Run once per email: it moves the email to "sending".
 */
export async function queueCampaign(
  trx: Trx,
  businessId: string,
  id: string,
  staffId: string | null,
): Promise<number> {
  const c = await trx
    .selectFrom("email_campaigns")
    .select(["audience", "status"])
    .where("id", "=", id)
    .forUpdate()
    .executeTakeFirst();
  if (!c) throw new AppError("not_found", "That email doesn't exist anymore.");
  if (c.status === "sending" || c.status === "sent")
    throw new AppError("conflict", "This email has already gone out.");
  const { send } = await resolveAudience(trx, c.audience);
  if (!send.length) return 0;
  await trx
    .insertInto("email_sends")
    .values(
      send.map((r) => ({
        business_id: businessId,
        campaign_id: id,
        customer_id: r.id,
        to_address: r.email,
        unsubscribe_token: newUnsubscribeToken(),
      })),
    )
    .execute();
  await trx
    .updateTable("email_campaigns")
    .set({ status: "sending", sent_by: staffId })
    .where("id", "=", id)
    .execute();
  return send.length;
}

/**
 * Sends up to `max` queued emails of one campaign and records each result. When none are
 * left the campaign is marked sent. The hosted queue worker calls this in small batches.
 */
export async function deliverBatch(
  trx: Trx,
  mailer: Mailer,
  businessId: string,
  campaignId: string,
  max: number,
): Promise<{ sent: number; failed: number; left: number }> {
  const c = await trx
    .selectFrom("email_campaigns")
    .select(["subject", "body"])
    .where("id", "=", campaignId)
    .executeTakeFirstOrThrow();
  const sender = await senderFor(trx, businessId);
  const queue = await trx
    .selectFrom("email_sends as e")
    .innerJoin("customers as c", "c.id", "e.customer_id")
    .select(["e.id", "e.customer_id", "e.to_address", "e.unsubscribe_token", "c.name", "c.email_opt_in"])
    .where("e.campaign_id", "=", campaignId)
    .where("e.status", "=", "queued")
    .orderBy("e.created_at")
    .limit(Math.min(max, 10_000))
    .execute();
  const suppressed = new Set(
    (await trx.selectFrom("email_suppressions").select("email").execute()).map((r) => r.email),
  );
  let sent = 0;
  let failed = 0;
  for (const q of queue) {
    // They may have unsubscribed since the email was queued.
    if (!q.email_opt_in || suppressed.has(normalizeEmail(q.to_address))) {
      await trx
        .updateTable("email_sends")
        .set({ status: "failed", error: "Unsubscribed before it went out" })
        .where("id", "=", q.id)
        .execute();
      failed++;
      continue;
    }
    const email = renderCampaignEmail({
      sender,
      to: q.to_address,
      name: q.name,
      subject: c.subject,
      body: c.body,
      unsubscribeUrl: unsubscribeUrl(mailer.siteUrl, businessId, q.unsubscribe_token),
    });
    try {
      const { messageId } = await mailer.send(email, { businessId, sendId: q.id });
      await trx
        .updateTable("email_sends")
        .set({ status: mailer.preview ? "preview" : "sent", ses_message_id: messageId })
        .where("id", "=", q.id)
        .execute();
      await addEvent(trx, {
        businessId,
        customerId: q.customer_id,
        kind: "email",
        summary: `${mailer.preview ? "Email (preview)" : "Emailed"}: ${c.subject}`,
        refId: campaignId,
      });
      sent++;
    } catch (err) {
      await trx
        .updateTable("email_sends")
        .set({ status: "failed", error: (err instanceof Error ? err.message : String(err)).slice(0, 500) })
        .where("id", "=", q.id)
        .execute();
      failed++;
    }
  }
  const left = await queuedCount(trx, campaignId);
  if (left === 0)
    await trx
      .updateTable("email_campaigns")
      .set({ status: "sent", sent_at: new Date() })
      .where("id", "=", campaignId)
      .where("status", "=", "sending")
      .execute();
  return { sent, failed, left };
}

/**
 * Sends scheduled emails whose time has come. Hosted mode runs this from EventBridge
 * Scheduler; the demo runs it when the Email page opens.
 */
export const releaseDueCampaigns = defineHandler<void, { released: number }>({
  action: "email.send",
  async run(trx, ctx) {
    const due = await trx
      .selectFrom("email_campaigns")
      .select("id")
      .where("status", "=", "scheduled")
      .where("send_at", "<=", new Date())
      .execute();
    for (const d of due) {
      const n = await queueCampaign(trx, ctx.businessId, d.id, null);
      if (n === 0)
        await trx
          .updateTable("email_campaigns")
          .set({ status: "sent", sent_at: new Date() })
          .where("id", "=", d.id)
          .execute();
      else await sendAll(trx, ctx, d.id);
    }
    return { released: due.length };
  },
});

export interface CampaignEmailRow {
  customerId: string;
  name: string;
  toAddress: string;
  status: EmailSendStatus;
  error: string | null;
}

/** Who an email went to and what happened to each. */
export const campaignEmails = defineHandler<{ id: string }, CampaignEmailRow[]>({
  action: "email.send",
  async run(trx, _ctx, { id }) {
    return trx
      .selectFrom("email_sends as e")
      .innerJoin("customers as c", "c.id", "e.customer_id")
      .select(["e.customer_id as customerId", "c.name", "e.to_address as toAddress", "e.status", "e.error"])
      .where("e.campaign_id", "=", id)
      .orderBy("c.name")
      .limit(1000)
      .execute();
  },
});

/** The email one customer got (or would get), for the preview on screen. */
export const previewCampaignEmail = defineHandler<CampaignInput, RenderedEmail>({
  action: "email.send",
  async run(trx, ctx, input) {
    const c = checkCampaign(input);
    // Once sent, show the first email as it went out, with its working unsubscribe link.
    const sent = input.id
      ? await trx
          .selectFrom("email_sends as e")
          .innerJoin("customers as c", "c.id", "e.customer_id")
          .select(["c.name", "e.to_address as email", "e.unsubscribe_token as token"])
          .where("e.campaign_id", "=", input.id)
          .orderBy("c.name")
          .executeTakeFirst()
      : undefined;
    const who = sent ??
      (await resolveAudience(trx, c.audience)).send[0] ?? { name: "Sam Sample", email: "sam@example.com" };
    return renderCampaignEmail({
      sender: await senderFor(trx, ctx.businessId),
      to: who.email,
      name: who.name,
      subject: c.subject,
      body: c.body,
      unsubscribeUrl: unsubscribeUrl(defaultMailer.siteUrl, ctx.businessId, sent?.token ?? "preview"),
    });
  },
});

// ---- after sending: SES delivery, bounce and complaint events ----

export type SesEvent =
  | { type: "Delivery"; messageId: string }
  | { type: "Bounce"; messageId: string; permanent: boolean }
  | { type: "Complaint"; messageId: string };

/**
 * Records what SES reported for one email. A permanent bounce or a spam complaint adds
 * the address to the suppression list; a complaint also turns off their email opt-in.
 * Run inside withBusiness for the business in the event's tags.
 */
export async function recordSesEvent(trx: Trx, businessId: string, e: SesEvent): Promise<void> {
  const send = await trx
    .selectFrom("email_sends")
    .select(["id", "customer_id", "to_address", "campaign_id", "status"])
    .where("ses_message_id", "=", e.messageId)
    .executeTakeFirst();
  if (!send) return;
  const status: EmailSendStatus =
    e.type === "Delivery" ? "delivered" : e.type === "Bounce" ? "bounced" : "complained";
  // A complaint can follow a delivery; never step back from a complaint or bounce.
  if (!(send.status === "complained" || (send.status === "bounced" && status === "delivered")))
    await trx.updateTable("email_sends").set({ status }).where("id", "=", send.id).execute();
  if (e.type === "Delivery" || (e.type === "Bounce" && !e.permanent)) return;
  const reason = e.type === "Bounce" ? "bounced" : "complained";
  await trx
    .insertInto("email_suppressions")
    .values({ business_id: businessId, email: normalizeEmail(send.to_address), reason })
    .onConflict((oc) => oc.columns(["business_id", "email"]).doNothing())
    .execute();
  if (e.type === "Complaint")
    await trx
      .updateTable("customers")
      .set({ email_opt_in: false })
      .where("id", "=", send.customer_id)
      .execute();
  await addEvent(trx, {
    businessId,
    customerId: send.customer_id,
    kind: "unsubscribed",
    summary:
      e.type === "Bounce"
        ? "Email bounced; no more bulk email to this address"
        : "Marked our email as spam; unsubscribed",
    refId: send.campaign_id,
  });
}

// ---- unsubscribing (public, from the link in every email) ----

export interface UnsubscribeInfo {
  storeName: string;
  /** "p•••@example.com" */
  email: string;
  alreadyOff: boolean;
}

const mask = (email: string) => {
  const [user = "", domain = ""] = email.split("@");
  return `${user.slice(0, 1)}•••@${domain}`;
};

async function sendByToken(trx: Trx, token: string) {
  if (typeof token !== "string" || !/^[0-9a-f]{32}$/.test(token))
    throw new AppError(
      "not_found",
      "That unsubscribe link isn't right. Reply to the email and we'll take you off the list.",
    );
  const s = await trx
    .selectFrom("email_sends as e")
    .innerJoin("customers as c", "c.id", "e.customer_id")
    .select(["e.customer_id", "e.campaign_id", "e.to_address", "c.email_opt_in"])
    .where("e.unsubscribe_token", "=", token)
    .executeTakeFirst();
  if (!s)
    throw new AppError(
      "not_found",
      "That unsubscribe link isn't right. Reply to the email and we'll take you off the list.",
    );
  return s;
}

export async function unsubscribeInfo(trx: Trx, businessId: string, token: string): Promise<UnsubscribeInfo> {
  const s = await sendByToken(trx, token);
  const b = await trx
    .selectFrom("businesses")
    .select("name")
    .where("id", "=", businessId)
    .executeTakeFirstOrThrow();
  const suppressed = await trx
    .selectFrom("email_suppressions")
    .select("email")
    .where("email", "=", normalizeEmail(s.to_address))
    .executeTakeFirst();
  return { storeName: b.name, email: mask(s.to_address), alreadyOff: !s.email_opt_in || !!suppressed };
}

/** Turns off bulk email for the person the link was sent to. Safe to repeat. */
export async function unsubscribe(trx: Trx, businessId: string, token: string): Promise<UnsubscribeInfo> {
  const info = await unsubscribeInfo(trx, businessId, token);
  if (info.alreadyOff) return info;
  const s = await sendByToken(trx, token);
  await trx.updateTable("customers").set({ email_opt_in: false }).where("id", "=", s.customer_id).execute();
  await trx
    .insertInto("email_suppressions")
    .values({ business_id: businessId, email: normalizeEmail(s.to_address), reason: "unsubscribed" })
    .onConflict((oc) => oc.columns(["business_id", "email"]).doNothing())
    .execute();
  await addEvent(trx, {
    businessId,
    customerId: s.customer_id,
    kind: "unsubscribed",
    summary: "Unsubscribed from email",
    refId: s.campaign_id,
  });
  return { ...info, alreadyOff: true };
}
