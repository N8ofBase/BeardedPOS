import { CfnOutput, Duration, Fn, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import {
  AaaaRecord,
  ARecord,
  CnameRecord,
  MxRecord,
  PublicHostedZone,
  RecordTarget,
  TxtRecord,
  type IPublicHostedZone,
} from "aws-cdk-lib/aws-route53";
import { EmailIdentity, Identity } from "aws-cdk-lib/aws-ses";
import type { Construct } from "constructs";
import { COPIED_TTL_SECONDS, missingValues, SQUARESPACE_SITE, type DnsRecord } from "./bbg-dns.ts";

/** CloudFront's fixed hosted zone id for alias records. */
const CLOUDFRONT_ZONE_ID = "Z2FDTNDATAQYW2";

export interface DomainStackProps extends StackProps {
  /** e.g. beardedboardgames.com */
  domainName: string;
  /** The records copied from the old DNS host. */
  records: DnsRecord[];
  /**
   * Where the domain itself and www point: still the Squarespace site, or the live store's CloudFront
   * distribution (its DistributionDomain output, like d123.cloudfront.net).
   */
  website: { kind: "squarespace" } | { kind: "store"; distributionDomain: string };
}

/**
 * The shop's own domain in Route 53, holding every record copied from Squarespace, plus the shop's SES
 * sender. Nothing here is live until the nameservers at the registrar point at this zone (the
 * NameServers output). The zone is kept if the stack is deleted, since email depends on it.
 */
export class DomainStack extends Stack {
  readonly zone: IPublicHostedZone;

  constructor(scope: Construct, id: string, props: DomainStackProps) {
    super(scope, id, props);
    const missing = missingValues(props.records);
    if (missing.length)
      throw new Error(
        `Copy these values from Squarespace into infra/lib/bbg-dns.ts first: ${missing.join(", ")}`,
      );

    const zone = new PublicHostedZone(this, "Zone", {
      zoneName: props.domainName,
      comment: "Bearded Board Games. Records copied from Squarespace; see infra/lib/bbg-dns.ts",
    });
    zone.applyRemovalPolicy(RemovalPolicy.RETAIN);
    this.zone = zone;

    const ttl = Duration.seconds(COPIED_TTL_SECONDS);
    props.records.forEach((r, i) => {
      const id = `${r.type}${r.name ? `-${r.name}` : "-apex"}-${i}`.replace(/[^A-Za-z0-9-]/g, "");
      const recordName = r.name || undefined;
      if (r.type === "MX")
        new MxRecord(this, id, {
          zone,
          recordName,
          ttl,
          values: r.values.map((v) => ({ priority: v.priority, hostName: v.host })),
        });
      else if (r.type === "TXT") new TxtRecord(this, id, { zone, recordName, ttl, values: r.values });
      else if (r.type === "CNAME") new CnameRecord(this, id, { zone, recordName, ttl, domainName: r.value });
      else
        new ARecord(this, id, { zone, recordName, ttl, target: RecordTarget.fromIpAddresses(...r.values) });
    });

    // The website. Same construct ids for both kinds, so the switch is an in-place record update with
    // no moment where the name doesn't resolve.
    const site = props.website;
    if (site.kind === "squarespace") {
      new ARecord(this, "SiteApex", {
        zone,
        ttl: Duration.minutes(5),
        target: RecordTarget.fromIpAddresses(...SQUARESPACE_SITE.apex),
      });
      new CnameRecord(this, "SiteWww", {
        zone,
        recordName: "www",
        ttl: Duration.minutes(5),
        domainName: SQUARESPACE_SITE.www,
      });
    } else {
      const target = RecordTarget.fromAlias({
        bind: () => ({ dnsName: site.distributionDomain, hostedZoneId: CLOUDFRONT_ZONE_ID }),
      });
      new ARecord(this, "SiteApex", { zone, target });
      new AaaaRecord(this, "SiteApexV6", { zone, target });
      new CnameRecord(this, "SiteWww", {
        zone,
        recordName: "www",
        ttl: Duration.minutes(5),
        domainName: site.distributionDomain,
      });
    }

    // Receipts and sign-in codes from the shop's own domain. SES checks the DKIM records, which only
    // resolve once the nameservers move; until then the store keeps sending from its prismcortex.net name.
    new EmailIdentity(this, "Mail", { identity: Identity.publicHostedZone(zone) });

    new CfnOutput(this, "NameServers", {
      value: Fn.join(" ", zone.hostedZoneNameServers!),
      description: "Squarespace, Domains, Domain Nameservers: use custom nameservers, these four",
    });
  }
}
