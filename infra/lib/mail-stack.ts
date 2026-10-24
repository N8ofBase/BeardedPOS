import { CfnOutput, Duration, Stack, type StackProps } from "aws-cdk-lib";
import { CnameRecord, HostedZone, MxRecord, TxtRecord } from "aws-cdk-lib/aws-route53";
import {
  ConfigurationSet,
  EmailIdentity,
  EmailSendingEvent,
  EventDestination,
  Identity,
  SuppressionReasons,
} from "aws-cdk-lib/aws-ses";
import { Topic } from "aws-cdk-lib/aws-sns";
import type { Construct } from "constructs";

export interface MailStackProps extends StackProps {
  /** The existing hosted zone, e.g. prismcortex.net. */
  domainName: string;
  /** The sending domain under it, e.g. mail.bearded.pos (mail comes from news@mail.bearded.pos.prismcortex.net). */
  mailSubdomain: string;
}

/**
 * Bulk email through Amazon SES from a subdomain of the existing zone: the verified
 * identity with DKIM, a custom MAIL FROM domain, a DMARC policy, and a configuration
 * set that reports deliveries, bounces and complaints to an SNS topic (the app's
 * recordSesEvent() turns those into suppressions). Adds only its own records to the
 * zone; never changes existing ones.
 */
export class MailStack extends Stack {
  constructor(scope: Construct, id: string, props: MailStackProps) {
    super(scope, id, props);

    const zone = HostedZone.fromLookup(this, "Zone", { domainName: props.domainName });
    const sendDomain = `${props.mailSubdomain}.${props.domainName}`;
    const mailFrom = `bounce.${sendDomain}`;
    const ttl = Duration.hours(1);

    const events = new Topic(this, "SesEvents", { displayName: "SES deliveries, bounces and complaints" });

    const configurationSet = new ConfigurationSet(this, "BulkMail", {
      configurationSetName: "bearded-bulk",
      // SES keeps its own account-level list too; ours (email_suppressions) is per business.
      suppressionReasons: SuppressionReasons.BOUNCES_AND_COMPLAINTS,
    });
    configurationSet.addEventDestination("ToSns", {
      destination: EventDestination.snsTopic(events),
      events: [EmailSendingEvent.DELIVERY, EmailSendingEvent.BOUNCE, EmailSendingEvent.COMPLAINT],
    });

    const identity = new EmailIdentity(this, "SendDomain", {
      identity: Identity.domain(sendDomain),
      mailFromDomain: mailFrom,
      configurationSet,
    });

    // Easy DKIM: three CNAMEs that SES gives us.
    identity.dkimRecords.forEach((r, i) => {
      // The token name is already a full name; the trailing dot stops the zone being added again.
      new CnameRecord(this, `Dkim${i + 1}`, { zone, recordName: `${r.name}.`, domainName: r.value, ttl });
    });
    // Custom MAIL FROM, so SPF lines up with our domain.
    new MxRecord(this, "MailFromMx", {
      zone,
      recordName: mailFrom,
      values: [{ priority: 10, hostName: `feedback-smtp.${this.region}.amazonses.com` }],
      ttl,
    });
    new TxtRecord(this, "MailFromSpf", {
      zone,
      recordName: mailFrom,
      values: ["v=spf1 include:amazonses.com ~all"],
      ttl,
    });
    // Monitor-only to start; tighten to quarantine once reports look clean.
    new TxtRecord(this, "Dmarc", {
      zone,
      recordName: `_dmarc.${sendDomain}`,
      values: ["v=DMARC1; p=none;"],
      ttl,
    });

    new CfnOutput(this, "SendDomainName", { value: sendDomain });
    new CfnOutput(this, "ConfigurationSetName", { value: configurationSet.configurationSetName });
    new CfnOutput(this, "SesEventsTopicArn", { value: events.topicArn });
  }
}
