// Bulk email goes out through one small interface, like card payments. Demo mode uses
// PreviewMailer: nothing leaves the browser, and each email is kept as a preview. Hosted
// mode (Phase 1f) uses an Amazon SES adapter in the queue worker; sesSendEmailInput()
// builds its request so the worker only adds the AWS client. No AWS credentials or SDK
// ever reach the browser bundle.
import type { RenderedEmail } from "@bearded/core";

export interface SendMeta {
  businessId: string;
  sendId: string;
}

export interface Mailer {
  readonly name: string;
  /** True when nothing is really sent (sends are kept with status "preview"). */
  readonly preview: boolean;
  /** Where unsubscribe links point: the site that serves /unsubscribe. */
  readonly siteUrl: string;
  /** Messages per second the account allows; batches stay under it. */
  readonly perSecond: number;
  send(email: RenderedEmail, meta: SendMeta): Promise<{ messageId: string }>;
}

function randomHex(bytes: number): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export class PreviewMailer implements Mailer {
  readonly name = "Email preview (demo)";
  readonly preview = true;
  readonly perSecond = 1000;
  readonly siteUrl: string;
  constructor(siteUrl?: string) {
    const here = (globalThis as { location?: { origin?: string } }).location?.origin;
    this.siteUrl = siteUrl ?? here ?? "https://bearded-pos-demo.prismcortex.net";
  }
  async send(): Promise<{ messageId: string }> {
    return { messageId: `preview_${randomHex(9)}` };
  }
}

/** The mailer in use. Demo mode only has the preview one. */
export const mailer: Mailer = new PreviewMailer();

/** A random token for an unsubscribe link (128 bits). */
export function newUnsubscribeToken(): string {
  return randomHex(16);
}

/**
 * The SES v2 SendEmail request for one email. The tags let the bounce and complaint
 * handler find the business and the send without reading the message.
 */
export function sesSendEmailInput(email: RenderedEmail, meta: SendMeta, configurationSet: string) {
  return {
    FromEmailAddress: email.from,
    Destination: { ToAddresses: [email.to] },
    Content: {
      Simple: {
        Subject: { Data: email.subject, Charset: "UTF-8" },
        Body: {
          Text: { Data: email.text, Charset: "UTF-8" },
          Html: { Data: email.html, Charset: "UTF-8" },
        },
        Headers: Object.entries(email.headers).map(([Name, Value]) => ({ Name, Value })),
      },
    },
    ConfigurationSetName: configurationSet,
    EmailTags: [
      { Name: "business_id", Value: meta.businessId },
      { Name: "send_id", Value: meta.sendId },
    ],
  };
}
