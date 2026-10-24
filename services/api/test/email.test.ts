import type { Kysely } from "kysely";
import { beforeEach, describe, expect, it } from "vitest";
import { EVERYONE, type Ctx, type EmailAudience } from "@bearded/core";
import { ensureDemo, listDemoStaff, withBusiness, type DB } from "@bearded/db";
import { createTestDb, insertBusiness } from "@bearded/db/test-db";
import { sesSendEmailInput } from "../src/email/mailer.ts";
import { deliverBatch, queueCampaign, recordSesEvent } from "../src/handlers/email.ts";
import { invoke } from "../src/registry.ts";
import { invokePublic } from "../src/public/registry.ts";
import type { Mailer } from "../src/email/mailer.ts";

let db: Kysely<DB>;
let businessId: string;
let owner: Ctx;
let cashier: Ctx;
let tag: (name: string) => Promise<string>;

beforeEach(async () => {
  ({ db } = await createTestDb());
  businessId = await ensureDemo(db);
  const staff = await listDemoStaff(db);
  const ctx = (role: Ctx["role"]): Ctx => ({
    businessId,
    role,
    staffId: staff.find((s) => s.role === role)!.id,
  });
  owner = ctx("owner");
  cashier = ctx("cashier");
  tag = async (name) => (await invoke(db, owner, "listTags", undefined)).find((t) => t.name === name)!.id;
});

const draft = (audience: EmailAudience = EVERYONE) => ({
  subject: "Fences is back",
  body: "Hi {first name},\n\nThe reprint is in.",
  audience,
});

async function sendsOf(id: string) {
  return withBusiness(db, businessId, (trx) =>
    trx.selectFrom("email_sends").selectAll().where("campaign_id", "=", id).orderBy("to_address").execute(),
  );
}

describe("who gets it", () => {
  it("counts opted-in customers by type and tag, and says who's left out", async () => {
    // Demo: Sample Customer (VIP, backer), Sample Family (VIP, game night), the retailer; the cat parent has no email.
    const all = await invoke(db, owner, "previewAudience", { audience: EVERYONE });
    expect(all).toMatchObject({ count: 3, noEmail: 1, notOptedIn: 0, suppressed: 0 });
    const vip = await tag("VIP (DEMO)");
    const night = await tag("Game night (DEMO)");
    const people = await invoke(db, owner, "previewAudience", {
      audience: { kinds: ["person"], anyTags: [vip], allTags: [], notTags: [night] },
    });
    expect(people).toMatchObject({ count: 1, sample: ["Sample Customer (DEMO)"] });
    expect(people.description).toBe(
      "People tagged VIP (DEMO), not tagged Game night (DEMO) who agreed to email",
    );
    const shops = await invoke(db, owner, "previewAudience", {
      audience: { ...EVERYONE, kinds: ["retailer"] },
    });
    expect(shops.sample).toEqual(["Sample Buyer (DEMO)"]);
  });

  it("is for owners and managers only", async () => {
    await expect(invoke(db, cashier, "previewAudience", { audience: EVERYONE })).rejects.toThrow(
      /permission/,
    );
    await expect(invoke(db, cashier, "sendCampaign", { ...draft(), sendAt: null })).rejects.toThrow(
      /permission/,
    );
  });
});

describe("sending", () => {
  it("sends to everyone who matches, notes it on their timeline, and marks the email sent", async () => {
    const vip = await tag("VIP (DEMO)");
    const r = await invoke(db, owner, "sendCampaign", {
      ...draft({ ...EVERYONE, anyTags: [vip] }),
      sendAt: null,
    });
    expect(r).toMatchObject({ queued: 2, sent: 2, failed: 0, left: 0, scheduled: false });
    const c = await invoke(db, owner, "getCampaign", { id: r.id });
    expect(c).toMatchObject({ status: "sent", counts: { total: 2, sent: 2 } });
    const sends = await sendsOf(r.id);
    expect(sends.map((s) => [s.to_address, s.status])).toEqual([
      ["customer.demo@example.com", "preview"],
      ["family.demo@example.com", "preview"],
    ]);
    expect(new Set(sends.map((s) => s.unsubscribe_token)).size).toBe(2);
    const t = await invoke(db, owner, "customerTimeline", { customerId: sends[0]!.customer_id });
    expect(t[0]).toMatchObject({ kind: "email", summary: "Email (preview): Fences is back" });
    await expect(invoke(db, owner, "saveCampaign", { id: r.id, ...draft() })).rejects.toThrow(
      "already gone out",
    );
    await expect(invoke(db, owner, "deleteCampaign", { id: r.id })).rejects.toThrow("Only drafts");
  });

  it("refuses to send to nobody", async () => {
    const night = await tag("Game night (DEMO)");
    await expect(
      invoke(db, owner, "sendCampaign", {
        ...draft({ kinds: ["retailer"], anyTags: [night], allTags: [], notTags: [] }),
        sendAt: null,
      }),
    ).rejects.toThrow("Nobody matches");
  });

  it("needs a from address and a mailing address first", async () => {
    await invoke(db, owner, "saveEmailSetup", { fromName: "Bearded", fromAddress: "", mailingAddress: "" });
    expect((await invoke(db, owner, "getEmailSetup", undefined)).missing).toHaveLength(2);
    await expect(invoke(db, owner, "sendCampaign", { ...draft(), sendAt: null })).rejects.toThrow(
      /Before sending, add/,
    );
  });

  it("schedules for later and sends when the time comes", async () => {
    const later = new Date(Date.now() + 3_600_000).toISOString();
    const r = await invoke(db, owner, "sendCampaign", { ...draft(), sendAt: later });
    expect(r.scheduled).toBe(true);
    expect((await invoke(db, owner, "releaseDueCampaigns", undefined)).released).toBe(0);
    await withBusiness(db, businessId, (trx) =>
      trx
        .updateTable("email_campaigns")
        .set({ send_at: new Date(Date.now() - 1000) })
        .where("id", "=", r.id)
        .execute(),
    );
    expect((await invoke(db, owner, "releaseDueCampaigns", undefined)).released).toBe(1);
    expect(await invoke(db, owner, "getCampaign", { id: r.id })).toMatchObject({
      status: "sent",
      counts: { sent: 3 },
    });
  });

  it("skips someone who unsubscribed after the email was queued, and records a failed send", async () => {
    const { id } = await invoke(db, owner, "saveCampaign", draft());
    const fails: Mailer = {
      name: "flaky",
      preview: false,
      siteUrl: "https://x.example",
      perSecond: 14,
      async send(email) {
        if (email.to.startsWith("buyer")) throw new Error("Throttling");
        return { messageId: `m-${email.to}` };
      },
    };
    const out = await withBusiness(db, businessId, async (trx) => {
      await queueCampaign(trx, businessId, id, owner.staffId);
      await trx
        .updateTable("customers")
        .set({ email_opt_in: false })
        .where("email", "=", "family.demo@example.com")
        .execute();
      return deliverBatch(trx, fails, businessId, id, 100);
    });
    expect(out).toEqual({ sent: 1, failed: 2, left: 0 });
    const sends = await sendsOf(id);
    expect(sends.map((s) => [s.to_address, s.status, s.error])).toEqual([
      ["buyer.demo@example.com", "failed", "Throttling"],
      ["customer.demo@example.com", "sent", null],
      ["family.demo@example.com", "failed", "Unsubscribed before it went out"],
    ]);
  });

  it("sends a test to one address only", async () => {
    const e = await invoke(db, owner, "sendTestEmail", {
      subject: "Hi",
      body: "Hello {first name}",
      to: "me@example.com",
    });
    expect(e).toMatchObject({ to: "me@example.com", subject: "[Test] Hi" });
    expect(e.text).toContain("100 Sample St (DEMO)");
    expect(await invoke(db, owner, "listCampaigns", undefined)).toEqual([]);
  });
});

describe("unsubscribing", () => {
  it("turns email off from the link, once, and shows on the timeline and the counts", async () => {
    const r = await invoke(db, owner, "sendCampaign", { ...draft(), sendAt: null });
    const send = (await sendsOf(r.id)).find((s) => s.to_address === "customer.demo@example.com")!;
    const pub = (name: "unsubscribeStatus" | "unsubscribe") =>
      invokePublic(db, { businessId, token: null, demo: true }, name, { token: send.unsubscribe_token });
    expect(await pub("unsubscribeStatus")).toEqual({
      storeName: "Sample Game Shop (DEMO)",
      email: "c•••@example.com",
      alreadyOff: false,
    });
    expect((await pub("unsubscribe")).alreadyOff).toBe(true);
    expect((await pub("unsubscribe")).alreadyOff).toBe(true);
    const c = await invoke(db, owner, "getCustomer", { id: send.customer_id });
    expect(c.emailOptIn).toBe(false);
    const t = await invoke(db, owner, "customerTimeline", { customerId: send.customer_id });
    expect(t.filter((e) => e.kind === "unsubscribed")).toHaveLength(1);
    expect((await invoke(db, owner, "getCampaign", { id: r.id })).counts.unsubscribed).toBe(1);
    // Everyone else still gets email.
    expect((await invoke(db, owner, "previewAudience", { audience: EVERYONE })).count).toBe(2);
  });

  it("rejects a made-up token and another business's token", async () => {
    await expect(
      invokePublic(db, { businessId, token: null, demo: true }, "unsubscribe", { token: "0".repeat(32) }),
    ).rejects.toThrow("isn't right");
    const r = await invoke(db, owner, "sendCampaign", { ...draft(), sendAt: null });
    const send = (await sendsOf(r.id))[0]!;
    const other = await insertBusiness(db, "other");
    await expect(
      invokePublic(db, { businessId: other, token: null, demo: true }, "unsubscribe", {
        token: send.unsubscribe_token,
      }),
    ).rejects.toThrow("isn't right");
  });
});

describe("SES", () => {
  it("builds the SendEmail request with one-click unsubscribe headers and tags", async () => {
    const e = await invoke(db, owner, "previewCampaignEmail", draft());
    const req = sesSendEmailInput(e, { businessId, sendId: "s1" }, "bearded-bulk");
    expect(req.FromEmailAddress).toBe(
      '"Sample Game Shop (DEMO)" <news@mail.bearded-pos-demo.prismcortex.net>',
    );
    expect(req.Content.Simple.Headers).toContainEqual({
      Name: "List-Unsubscribe-Post",
      Value: "List-Unsubscribe=One-Click",
    });
    expect(req.EmailTags).toEqual([
      { Name: "business_id", Value: businessId },
      { Name: "send_id", Value: "s1" },
    ]);
    expect(req.ConfigurationSetName).toBe("bearded-bulk");
  });

  it("suppresses hard bounces and complaints, but not soft bounces", async () => {
    const { id } = await invoke(db, owner, "saveCampaign", draft());
    const ok: Mailer = {
      name: "ses",
      preview: false,
      siteUrl: "https://x",
      perSecond: 14,
      send: async (m) => ({ messageId: `m-${m.to}` }),
    };
    await withBusiness(db, businessId, async (trx) => {
      await queueCampaign(trx, businessId, id, null);
      await deliverBatch(trx, ok, businessId, id, 100);
      await recordSesEvent(trx, businessId, { type: "Delivery", messageId: "m-buyer.demo@example.com" });
      await recordSesEvent(trx, businessId, {
        type: "Bounce",
        messageId: "m-customer.demo@example.com",
        permanent: false,
      });
      await recordSesEvent(trx, businessId, { type: "Complaint", messageId: "m-family.demo@example.com" });
      await recordSesEvent(trx, businessId, { type: "Delivery", messageId: "m-family.demo@example.com" });
    });
    const sends = await sendsOf(id);
    expect(sends.map((s) => s.status)).toEqual(["delivered", "bounced", "complained"]);
    const a = await invoke(db, owner, "previewAudience", { audience: EVERYONE });
    expect(a).toMatchObject({ count: 2, notOptedIn: 1 });
    await withBusiness(db, businessId, (trx) =>
      recordSesEvent(trx, businessId, {
        type: "Bounce",
        messageId: "m-buyer.demo@example.com",
        permanent: true,
      }),
    );
    expect(await invoke(db, owner, "previewAudience", { audience: EVERYONE })).toMatchObject({
      count: 1,
      suppressed: 1,
    });
  });
});
