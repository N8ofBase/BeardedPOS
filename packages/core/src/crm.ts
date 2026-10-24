// Customer relationships: customer types, tags, who a bulk email goes to, and the email
// itself. The server and the screens both use these, so the count shown before sending
// is the list the server sends to.

export const CUSTOMER_KINDS = ["person", "retailer"] as const;
export type CustomerKind = (typeof CUSTOMER_KINDS)[number];

export const KIND_LABEL: Record<CustomerKind, string> = {
  person: "Person",
  retailer: "Retailer",
};

export function isCustomerKind(v: unknown): v is CustomerKind {
  return typeof v === "string" && (CUSTOMER_KINDS as readonly string[]).includes(v);
}

export const TAG_MAX = 40;

/** Trims and collapses spaces. Null when the name can't be a tag. */
export function cleanTagName(name: string): string | null {
  const t = name.trim().replace(/\s+/g, " ");
  return t.length >= 1 && t.length <= TAG_MAX ? t : null;
}

/** For matching store signups and suppressions: trimmed and lower-case. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// ---- who gets a bulk email ----

export interface EmailAudience {
  /** Empty means every type. */
  kinds: CustomerKind[];
  /** Has at least one of these. Empty means no tag needed. */
  anyTags: string[];
  /** Has every one of these. */
  allTags: string[];
  /** Has none of these. */
  notTags: string[];
}

export const EVERYONE: EmailAudience = { kinds: [], anyTags: [], allTags: [], notTags: [] };

export interface AudienceCandidate {
  kind: CustomerKind;
  email: string | null;
  emailOptIn: boolean;
  tagIds: string[];
}

/** Why a customer who matches the tags still won't get the email. */
export type SkipReason = "no_email" | "not_opted_in" | "suppressed";

/**
 * Whether one customer gets the email. Matching the type and tags is not enough: they
 * need an email, must have agreed to marketing email, and must not be suppressed.
 */
export function audienceDecision(
  c: AudienceCandidate,
  a: EmailAudience,
  suppressed: ReadonlySet<string>,
): "send" | "no_match" | SkipReason {
  if (a.kinds.length && !a.kinds.includes(c.kind)) return "no_match";
  const has = new Set(c.tagIds);
  if (a.anyTags.length && !a.anyTags.some((t) => has.has(t))) return "no_match";
  if (!a.allTags.every((t) => has.has(t))) return "no_match";
  if (a.notTags.some((t) => has.has(t))) return "no_match";
  if (!c.email) return "no_email";
  if (!c.emailOptIn) return "not_opted_in";
  if (suppressed.has(normalizeEmail(c.email))) return "suppressed";
  return "send";
}

/** Checks an audience from the browser and drops duplicates. Throws a plain message. */
export function cleanAudience(a: EmailAudience): EmailAudience {
  const uniq = (xs: unknown) => {
    if (!Array.isArray(xs) || xs.some((x) => typeof x !== "string")) throw new Error("bad audience");
    return [...new Set(xs as string[])];
  };
  const kinds = uniq(a?.kinds);
  if (!kinds.every(isCustomerKind)) throw new Error("bad audience");
  const out = { kinds, anyTags: uniq(a.anyTags), allTags: uniq(a.allTags), notTags: uniq(a.notTags) };
  if (out.notTags.some((t) => out.anyTags.includes(t) || out.allTags.includes(t)))
    throw new Error("A tag can't be both included and left out.");
  return out as EmailAudience;
}

/** "Retailers tagged VIP or Backer, not tagged Wholesale-paused" */
export function describeAudience(a: EmailAudience, tagName: (id: string) => string): string {
  const who = a.kinds.length === 1 ? (a.kinds[0] === "retailer" ? "Retailers" : "People") : "Everyone";
  const parts: string[] = [];
  const names = (ids: string[], joiner: string) => ids.map(tagName).join(joiner);
  if (a.anyTags.length) parts.push(`tagged ${names(a.anyTags, " or ")}`);
  if (a.allTags.length) parts.push(`tagged ${names(a.allTags, " and ")}`);
  if (a.notTags.length) parts.push(`not tagged ${names(a.notTags, " or ")}`);
  const base = parts.length ? `${who} ${parts.join(", ")}` : who;
  return `${base} who agreed to email`;
}

// ---- the email ----

export const CAMPAIGN_LIMITS = { subject: 150, body: 20000 };

export function validateCampaign(c: { subject: string; body: string }): { subject?: string; body?: string } {
  const e: { subject?: string; body?: string } = {};
  const subject = c.subject.trim();
  if (!subject) e.subject = "Add a subject.";
  else if (subject.length > CAMPAIGN_LIMITS.subject)
    e.subject = `Keep the subject under ${CAMPAIGN_LIMITS.subject} characters.`;
  if (!c.body.trim()) e.body = "Write the email.";
  else if (c.body.length > CAMPAIGN_LIMITS.body) e.body = "That email is too long.";
  return e;
}

export interface EmailSender {
  fromName: string;
  fromAddress: string;
  /** Required by law in every bulk email. */
  mailingAddress: string;
}

export interface RenderedEmail {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  /** One-click unsubscribe, which Gmail and Yahoo require for bulk mail (RFC 8058). */
  headers: Record<string, string>;
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** "Hi {first name}" in the body becomes the customer's first name, or "there". */
export function personalize(body: string, name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? "";
  return body.replace(/\{first name\}/gi, first || "there");
}

/**
 * Builds the email one customer receives. The body is plain text: blank lines start a
 * new paragraph and web addresses become links in the HTML part.
 */
export function renderCampaignEmail(input: {
  sender: EmailSender;
  to: string;
  name: string;
  subject: string;
  body: string;
  unsubscribeUrl: string;
}): RenderedEmail {
  const body = personalize(input.body, input.name).replace(/\r\n/g, "\n").trim();
  const footer = [
    `You're getting this because you joined the ${input.sender.fromName} email list.`,
    `Unsubscribe: ${input.unsubscribeUrl}`,
    input.sender.mailingAddress,
  ];
  const text = `${body}\n\n--\n${footer.join("\n")}\n`;
  const linkify = (s: string) =>
    escapeHtml(s).replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}">${u}</a>`);
  const paragraphs = body
    .split(/\n{2,}/)
    .map((p) => `<p>${linkify(p).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;font-size:16px;line-height:1.5;color:#1f1f1f;max-width:600px;margin:0 auto;padding:16px">
${paragraphs}
<hr style="border:none;border-top:1px solid #ddd;margin:24px 0">
<p style="font-size:13px;color:#666">${escapeHtml(footer[0]!)}<br>
<a href="${escapeHtml(input.unsubscribeUrl)}">Unsubscribe</a><br>
${escapeHtml(input.sender.mailingAddress)}</p>
</body></html>`;
  const name = input.sender.fromName.replace(/["\\\r\n]/g, "");
  return {
    from: `"${name}" <${input.sender.fromAddress}>`,
    to: input.to,
    subject: input.subject.trim(),
    text,
    html,
    headers: {
      "List-Unsubscribe": `<${input.unsubscribeUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
}

/** Where the unsubscribe link points: the store's public page, with the send's token. */
export function unsubscribeUrl(siteUrl: string, businessId: string, token: string): string {
  const base = siteUrl.replace(/\/+$/, "");
  return `${base}/unsubscribe?b=${encodeURIComponent(businessId)}&t=${encodeURIComponent(token)}`;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function looksLikeEmail(s: string): boolean {
  return EMAIL.test(s.trim());
}
