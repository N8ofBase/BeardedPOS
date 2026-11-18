import { describe, expect, it } from "vitest";
import { BBG_RECORDS, missingValues, NOT_COPIED, type DnsRecord } from "../lib/bbg-dns.ts";

describe("beardedboardgames.com records copied from Squarespace", () => {
  it("has every value filled in", () => {
    expect(missingValues(BBG_RECORDS)).toEqual([]);
    expect(missingValues([{ type: "TXT", name: "", values: [`x=${NOT_COPIED}`] }])).toEqual(["TXT @"]);
  });

  it("keeps Google Workspace email exactly", () => {
    const mx = BBG_RECORDS.find((r): r is Extract<DnsRecord, { type: "MX" }> => r.type === "MX")!;
    expect(mx.name).toBe("");
    expect(mx.values.map((v) => `${v.priority} ${v.host}`).sort()).toEqual(
      [
        "1 aspmx.l.google.com",
        "10 alt3.aspmx.l.google.com",
        "10 alt4.aspmx.l.google.com",
        "5 alt1.aspmx.l.google.com",
        "5 alt2.aspmx.l.google.com",
      ].sort(),
    );
  });

  it("has one SPF record, naming Google, Sender.net and Amazon SES", () => {
    const spf = BBG_RECORDS.flatMap((r) => (r.type === "TXT" ? r.values : [])).filter((v) =>
      v.startsWith("v=spf1"),
    );
    expect(spf).toHaveLength(1);
    for (const inc of ["_spf.google.com", "sendersrv.com", "amazonses.com"])
      expect(spf[0]).toContain(`include:${inc}`);
  });

  it("keeps the Sender.net and Mailchimp newsletter signatures", () => {
    const cnames = Object.fromEntries(
      BBG_RECORDS.flatMap((r) => (r.type === "CNAME" ? [[r.name, r.value]] : [])),
    );
    expect(cnames).toMatchObject({
      "sender._domainkey": "dkim.sendersrv.com",
      "k2._domainkey": "dkim2.mcsv.net",
      "k3._domainkey": "dkim3.mcsv.net",
    });
  });

  it("puts each name and type in one record set", () => {
    const keys = BBG_RECORDS.map((r) => `${r.type} ${r.name}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
