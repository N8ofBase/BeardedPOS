// beardedboardgames.com's DNS records, copied from Squarespace (Domains, DNS Settings) on 2026-11-18.
// The BeardedDomain stack puts them in a Route 53 zone so email and the newsletter tools keep working
// once the nameservers move. Squarespace's Domain Connect record is left out (it only lets Squarespace
// edit its own DNS); its website records are below, and the live store replaces them.

export type DnsRecord =
  | { type: "MX"; name: string; values: { priority: number; host: string }[] }
  | { type: "TXT"; name: string; values: string[] }
  | { type: "CNAME"; name: string; value: string }
  | { type: "A"; name: string; values: string[] };

/** Squarespace's 4 hours. */
export const COPIED_TTL_SECONDS = 4 * 60 * 60;

/** A Google verification value not copied yet: synth refuses to run until it's filled in. */
export const NOT_COPIED = "PASTE-FROM-SQUARESPACE";

/** Names are relative to the zone; "" is the domain itself (Squarespace's "@"). */
export const BBG_RECORDS: DnsRecord[] = [
  // Google Workspace email.
  {
    type: "MX",
    name: "",
    values: [
      { priority: 1, host: "aspmx.l.google.com" },
      { priority: 5, host: "alt1.aspmx.l.google.com" },
      { priority: 5, host: "alt2.aspmx.l.google.com" },
      { priority: 10, host: "alt3.aspmx.l.google.com" },
      { priority: 10, host: "alt4.aspmx.l.google.com" },
    ],
  },
  // All TXT values at one name share one record set: SPF and the Workspace verification. SPF adds
  // Google (Workspace mail) and Amazon SES (the store's receipts) to Squarespace's Sender.net-only
  // record, as N8 asked on 2026-11-18.
  {
    type: "TXT",
    name: "",
    values: [
      "v=spf1 include:_spf.google.com include:sendersrv.com include:amazonses.com ?all",
      "google-site-verification=kKD4s46RaA4QbODpVLgqxW9xchqJxOGvPYYPhsaM600",
    ],
  },
  {
    type: "TXT",
    name: "google",
    values: ["google-site-verification=F3KtQ3BEtDUTeKmjiCA7oLOcp1MpHEJAlcmmfh6CiBM"],
  },
  { type: "TXT", name: "_dmarc", values: ["v=DMARC1; p=none;"] },
  // Mailchimp (k2, k3) and Sender.net (sender) newsletter signatures.
  { type: "CNAME", name: "k2._domainkey", value: "dkim2.mcsv.net" },
  { type: "CNAME", name: "k3._domainkey", value: "dkim3.mcsv.net" },
  { type: "CNAME", name: "sender._domainkey", value: "dkim.sendersrv.com" },
  // A separate server; kept as is.
  { type: "A", name: "theranch", values: ["45.33.62.123"] },
];

/**
 * Squarespace's website records, copied too, so moving the nameservers changes nothing anyone can see.
 * The "live" stage swaps them for the store.
 */
export const SQUARESPACE_SITE = {
  apex: ["198.185.159.144", "198.185.159.145", "198.49.23.144", "198.49.23.145"],
  www: "ext-sq.squarespace.com",
};

/** Every value that still needs copying from Squarespace. */
export const missingValues = (records: DnsRecord[]): string[] =>
  records.flatMap((r) =>
    r.type === "TXT" && r.values.some((v) => v.includes(NOT_COPIED)) ? [`TXT ${r.name || "@"}`] : [],
  );
