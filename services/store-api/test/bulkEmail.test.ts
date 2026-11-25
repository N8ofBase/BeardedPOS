// Real bulk email on the hosted register: the every-minute run sends the queue through SES in batches,
// and the unsubscribe link (page and one-click) turns email off.
import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EVERYONE, type Ctx } from "@bearded/core";
import { invoke, mailer, PreviewMailer, setMailer, type Mailer } from "@bearded/api";
import { ensureDemo, listDemoStaff, withBusiness, type DB } from "@bearded/db";
import { createTestDb } from "@bearded/db/test-db";
import type { Database } from "../src/db.ts";
import { runEmailQueue, sesBulkMailer, type SesSend } from "../src/emailQueue.ts";
import { makeStore, type TestStore } from "./helpers.ts";

let db: Kysely<DB>;
let businessId: string;
let owner: Ctx;
let sent: Parameters<SesSend>[0][];
let ses: Mailer;
let store: TestStore;

beforeEach(async () => {
  ({ db } = await createTestDb());
  businessId = await ensureDemo(db);
  const staff = await listDemoStaff(db);
  owner = { businessId, role: "owner", staffId: staff.find((s) => s.role === "owner")!.id };
  sent = [];
  ses = sesBulkMailer({
    siteUrl: "https://beardedboardgames.com",
    perSecond: 1,
    send: async (input) => {
      sent.push(input);
      return { MessageId: `m${sent.length}` };
    },
  });
  setMailer(ses);
  store = makeStore({} as Database, { businessId });
  store.ctx.pos = db;
});

afterEach(() => setMailer(new PreviewMailer()));

const send = () =>
  invoke(db, owner, "sendCampaign", {
    subject: "Fences is back",
    body: "Hi {first name}",
    audience: EVERYONE,
    sendAt: null,
  });

const statuses = (id: string) =>
  withBusiness(db, businessId, (trx) =>
    trx
      .selectFrom("email_sends")
      .select(["status", "unsubscribe_token"])
      .where("campaign_id", "=", id)
      .execute(),
  );

describe("sending through SES", () => {
  it("queues on send, then the run sends a batch a second until the queue is empty", async () => {
    expect(mailer.preview).toBe(false);
    expect((await invoke(db, owner, "getEmailSetup", undefined)).realSend).toBe(true);
    const r = await send();
    expect(r).toMatchObject({ queued: 3, sent: 0, left: 3 });
    expect(sent).toHaveLength(0);

    let clock = 0;
    const waits: number[] = [];
    const run = await runEmailQueue(db, businessId, ses, {
      now: () => clock,
      sleep: async (ms) => {
        waits.push(ms);
        clock += ms;
      },
    });
    expect(run).toMatchObject({ sent: 3, failed: 0, left: 0 });
    expect(waits).toEqual([1000, 1000]); // perSecond 1: three batches, a second apart
    expect(sent).toHaveLength(3);
    const first = sent[0]!;
    expect(first.FromEmailAddress).toContain("<news@");
    expect(first).not.toHaveProperty("ConfigurationSetName");
    const list = first.Content.Simple.Headers.find((h) => h.Name === "List-Unsubscribe")!.Value;
    expect(list).toMatch(/^<https:\/\/beardedboardgames\.com\/api\/unsubscribe\?b=.+&t=[0-9a-f]{32}>$/);
    expect(first.Content.Simple.Body.Text.Data).toContain("https://beardedboardgames.com/unsubscribe?b=");
    expect((await statuses(r.id)).map((s) => s.status)).toEqual(["sent", "sent", "sent"]);
    expect((await invoke(db, owner, "getCampaign", { id: r.id })).status).toBe("sent");
  });

  it("stops when its time is up and leaves the rest for the next run", async () => {
    const r = await send();
    let clock = 0;
    const run = await runEmailQueue(db, businessId, ses, {
      runMs: 1500,
      now: () => clock,
      sleep: async (ms) => void (clock += ms),
    });
    expect(run).toMatchObject({ sent: 2, left: 1 });
    expect((await invoke(db, owner, "getCampaign", { id: r.id })).status).toBe("sending");
    expect(await runEmailQueue(db, businessId, ses, { sleep: async () => {} })).toMatchObject({
      sent: 1,
      left: 0,
    });
  });

  it("starts scheduled emails whose time has come", async () => {
    const r = await invoke(db, owner, "sendCampaign", {
      subject: "Later",
      body: "Hi",
      audience: EVERYONE,
      sendAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    await withBusiness(db, businessId, (trx) =>
      trx
        .updateTable("email_campaigns")
        .set({ send_at: new Date(Date.now() - 1000) })
        .where("id", "=", r.id)
        .execute(),
    );
    const run = await runEmailQueue(db, businessId, { ...ses, perSecond: 10 }, { sleep: async () => {} });
    expect(run).toMatchObject({ released: 1, sent: 3, left: 0 });
  });

  it("really sends the test email", async () => {
    await invoke(db, owner, "sendTestEmail", { subject: "Hi", body: "Hello", to: "n8@example.com" });
    expect(sent.map((s) => s.Destination.ToAddresses)).toEqual([["n8@example.com"]]);
  });
});

describe("the unsubscribe link", () => {
  it("shows whose address it is, then turns email off, from the page or a mail app's one-click post", async () => {
    const r = await send();
    await runEmailQueue(db, businessId, { ...ses, perSecond: 10 }, { sleep: async () => {} });
    const [a, b] = await statuses(r.id);
    const look = await store.call("GET", `/api/unsubscribe?b=${businessId}&t=${a!.unsubscribe_token}`);
    expect(look.status).toBe(200);
    expect(look.body).toMatchObject({ alreadyOff: false, email: expect.stringContaining("•••@") });
    const off = await store.call("POST", `/api/unsubscribe?b=${businessId}&t=${a!.unsubscribe_token}`, {});
    expect(off.body).toMatchObject({ alreadyOff: true });
    // A mail app posts a form body ("List-Unsubscribe=One-Click"), which the server doesn't read.
    const oneClick = await store.call("POST", `/api/unsubscribe?b=${businessId}&t=${b!.unsubscribe_token}`);
    expect(oneClick.status).toBe(200);
    expect((await invoke(db, owner, "previewAudience", { audience: EVERYONE })).count).toBe(1);
  });

  it("refuses a wrong token or another shop's link", async () => {
    const bad = await store.call("GET", `/api/unsubscribe?b=${businessId}&t=${"0".repeat(32)}`);
    expect(bad).toMatchObject({ status: 404, body: { error: expect.stringContaining("isn't right") } });
    const other = await store.call("GET", `/api/unsubscribe?b=someone-else&t=${"0".repeat(32)}`);
    expect(other.status).toBe(404);
  });
});
