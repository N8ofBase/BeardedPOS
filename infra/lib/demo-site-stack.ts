import { join } from "node:path";
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import { CfnBudget } from "aws-cdk-lib/aws-budgets";
import { Certificate, CertificateValidation } from "aws-cdk-lib/aws-certificatemanager";
import {
  Distribution,
  HttpVersion,
  PriceClass,
  ResponseHeadersPolicy,
  ViewerProtocolPolicy,
} from "aws-cdk-lib/aws-cloudfront";
import { S3BucketOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { AaaaRecord, ARecord, HostedZone, RecordTarget } from "aws-cdk-lib/aws-route53";
import { CloudFrontTarget } from "aws-cdk-lib/aws-route53-targets";
import { BlockPublicAccess, Bucket, BucketEncryption } from "aws-cdk-lib/aws-s3";
import { BucketDeployment, Source } from "aws-cdk-lib/aws-s3-deployment";
import type { Construct } from "constructs";

export interface DemoSiteStackProps extends StackProps {
  domainName: string;
  subdomain: string;
  siteDir: string;
  budgetMonthlyUsd: number;
  budgetEmail?: string;
}

/**
 * Static demo site: private S3 bucket behind CloudFront at <subdomain>.<domainName>.
 * Adds only its own records to the existing hosted zone; never touches other records.
 */
export class DemoSiteStack extends Stack {
  constructor(scope: Construct, id: string, props: DemoSiteStackProps) {
    super(scope, id, props);

    const siteName = `${props.subdomain}.${props.domainName}`;
    const zone = HostedZone.fromLookup(this, "Zone", { domainName: props.domainName });

    const certificate = new Certificate(this, "Certificate", {
      domainName: siteName,
      validation: CertificateValidation.fromDns(zone),
    });

    // Demo content only (no customer data), so the bucket can go with the stack.
    const bucket = new Bucket(this, "SiteBucket", {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const distribution = new Distribution(this, "Distribution", {
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(bucket),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        responseHeadersPolicy: ResponseHeadersPolicy.SECURITY_HEADERS,
      },
      domainNames: [siteName],
      certificate,
      defaultRootObject: "index.html",
      // Single-page app: unknown paths load index.html.
      errorResponses: [403, 404].map((httpStatus) => ({
        httpStatus,
        responseHttpStatus: 200,
        responsePagePath: "/index.html",
        ttl: Duration.minutes(5),
      })),
      priceClass: PriceClass.PRICE_CLASS_100,
      httpVersion: HttpVersion.HTTP2_AND_3,
    });

    const target = RecordTarget.fromAlias(new CloudFrontTarget(distribution));
    new ARecord(this, "AliasA", { zone, recordName: props.subdomain, target });
    new AaaaRecord(this, "AliasAAAA", { zone, recordName: props.subdomain, target });

    new BucketDeployment(this, "DeploySite", {
      sources: [Source.asset(join(process.cwd(), props.siteDir))],
      destinationBucket: bucket,
      distribution,
      distributionPaths: ["/*"],
    });

    if (props.budgetEmail) {
      new CfnBudget(this, "MonthlyBudget", {
        budget: {
          budgetName: "prismcortex-monthly",
          budgetType: "COST",
          timeUnit: "MONTHLY",
          budgetLimit: { amount: props.budgetMonthlyUsd, unit: "USD" },
        },
        notificationsWithSubscribers: [
          {
            notification: {
              notificationType: "ACTUAL",
              comparisonOperator: "GREATER_THAN",
              threshold: 80,
              thresholdType: "PERCENTAGE",
            },
            subscribers: [{ subscriptionType: "EMAIL", address: props.budgetEmail }],
          },
          {
            notification: {
              notificationType: "FORECASTED",
              comparisonOperator: "GREATER_THAN",
              threshold: 100,
              thresholdType: "PERCENTAGE",
            },
            subscribers: [{ subscriptionType: "EMAIL", address: props.budgetEmail }],
          },
        ],
      });
    }

    new CfnOutput(this, "SiteUrl", { value: `https://${siteName}` });
    new CfnOutput(this, "DistributionId", { value: distribution.distributionId });
  }
}
