import { join } from "node:path";
import { CfnOutput, Duration, Fn, RemovalPolicy, SecretValue, Stack, type StackProps } from "aws-cdk-lib";
import { HttpApi, HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { Certificate, CertificateValidation } from "aws-cdk-lib/aws-certificatemanager";
import {
  AllowedMethods,
  CachePolicy,
  Distribution,
  Function as EdgeFunction,
  FunctionCode,
  FunctionEventType,
  FunctionRuntime,
  HeadersFrameOption,
  HeadersReferrerPolicy,
  HttpVersion,
  OriginProtocolPolicy,
  OriginRequestPolicy,
  PriceClass,
  ResponseHeadersPolicy,
  ViewerProtocolPolicy,
} from "aws-cdk-lib/aws-cloudfront";
import { HttpOrigin, S3BucketOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import {
  InstanceClass,
  InstanceSize,
  InstanceType,
  MachineImage,
  NatProvider,
  NatTrafficDirection,
  Peer,
  Port,
  SecurityGroup,
  SubnetType,
  UserData,
  Vpc,
} from "aws-cdk-lib/aws-ec2";
import { Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Architecture, Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction, OutputFormat } from "aws-cdk-lib/aws-lambda-nodejs";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import {
  Credentials,
  DatabaseInstance,
  DatabaseInstanceEngine,
  ParameterGroup,
  PostgresEngineVersion,
} from "aws-cdk-lib/aws-rds";
import {
  AaaaRecord,
  ARecord,
  CnameRecord,
  HostedZone,
  RecordTarget,
  type IHostedZone,
} from "aws-cdk-lib/aws-route53";
import { CloudFrontTarget } from "aws-cdk-lib/aws-route53-targets";
import { BlockPublicAccess, Bucket, BucketEncryption } from "aws-cdk-lib/aws-s3";
import { BucketDeployment, Source } from "aws-cdk-lib/aws-s3-deployment";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import { EmailIdentity, Identity } from "aws-cdk-lib/aws-ses";
import type { Construct } from "constructs";
import { oldSiteRedirects } from "../../packages/store-core/src/oldSite.ts";
import { NAT_COMMANDS, NAT_IMAGE_PARAMETER } from "./nat.ts";
import { viewerRequestCode } from "./site-request.ts";

export interface StoreDemoStackProps extends StackProps {
  /** The existing hosted zone, e.g. prismcortex.net. */
  domainName: string;
  /** The store's name under it, e.g. bbg. */
  subdomain: string;
  /** The built store (apps/store/dist), relative to infra. */
  siteDir: string;
  /** The built register (apps/web/dist-hosted), relative to infra, served at /register. */
  registerDir: string;
  /** The register's first owners, as "Name <email>". They sign in with an email code. */
  registerOwners: string[];
  /** Emails that may sign in to Behind the Beard. SES sends each a verification email. */
  staffEmails: string[];
  /** The store's business id (DEV_BUSINESS_ID in services/store-api/src/node.ts). */
  businessId: string;
  /** "sandbox" for the demo; "live" takes real money on the real Square account. */
  squareMode?: "sandbox" | "live";
  /**
   * Keep the database off the internet: it sits in private subnets and only the Lambda can reach it.
   * The Lambda then runs in the VPC and reaches Square, SES and Secrets Manager through a small NAT
   * instance (about $7 a month). Also turns on a week of backups and delete protection.
   */
  privateDatabase?: boolean;
  /** Send each staff address an SES verification email (only one stack may own those identities). */
  verifyStaffEmails?: boolean;
  /** Load the register's (DEMO) sample stock at this count. Left out, the register starts empty. */
  demoStock?: number;
  /**
   * The live register's card payments go through the Square POS app once this is set: the Square
   * app's Production application id (public, "sq0idp-…"). Left empty, the register keeps the
   * pretend card reader.
   */
  squareApplicationId?: string;
  /**
   * The shop's own domain (BeardedDomain's zone). Attached, the site answers at the domain and www too,
   * on one certificate with its prismcortex.net name. Primary (once the domain points here), it's the
   * main address: other names redirect to it, Square sends shoppers back to it, mail comes from it, and
   * search engines may index it. The webhook stays on the prismcortex.net name either way, since Square
   * signs that exact URL.
   */
  shopDomain?: { zone: IHostedZone; name: string; primary: boolean };
}

function natUserData(): UserData {
  const data = UserData.forLinux();
  data.addCommands(...NAT_COMMANDS);
  return data;
}

/** Must match the placeholders in services/store-api/src/lambda.ts. */
const SQUARE_PLACEHOLDER = "paste-the-square-sandbox-token-here";
const LIVE_SQUARE_PLACEHOLDER = "paste-the-square-production-token-here";
const WEBHOOK_PLACEHOLDER = "paste-the-square-webhook-signature-key-here";

/**
 * The online store at <subdomain>.<domainName>: the built site in a private S3 bucket behind
 * CloudFront, /api to the store server in Lambda (behind an HTTP API), and the smallest RDS Postgres.
 * Used twice: BeardedStoreDemo (Square Sandbox, public database with TLS) and BeardedStore (the real
 * Square account, private database). Kept out of search engines until the domain moves. Adds only its
 * own records to the existing hosted zone; never changes other records.
 */
export class StoreDemoStack extends Stack {
  constructor(scope: Construct, id: string, props: StoreDemoStackProps) {
    super(scope, id, props);

    const siteName = `${props.subdomain}.${props.domainName}`;
    const live = props.squareMode === "live";
    const isPrivate = props.privateDatabase === true;
    const shop = props.shopDomain;
    const primaryName = shop?.primary ? shop.name : siteName;
    const zone = HostedZone.fromLookup(this, "Zone", { domainName: props.domainName });
    const repoRoot = join(process.cwd(), "..");

    // Database. In the demo it's public with TLS forced and a long generated password, so the Lambda
    // can stay outside the VPC (no NAT to pay for). Private: the database has no internet address, only
    // the Lambda's security group may connect, and the Lambda reaches out through a NAT instance.
    // Snapshot on delete either way: staff choices and accounts live here.
    const nat = isPrivate
      ? NatProvider.instanceV2({
          instanceType: InstanceType.of(InstanceClass.T4G, InstanceSize.NANO),
          // Our own setup (infra/lib/nat.ts): CDK's default commands fail on a t4g.nano.
          machineImage: MachineImage.fromSsmParameter(NAT_IMAGE_PARAMETER),
          userData: natUserData(),
          defaultAllowedTraffic: NatTrafficDirection.OUTBOUND_ONLY,
        })
      : undefined;
    const vpc = new Vpc(this, "Vpc", {
      maxAzs: 2,
      natGateways: nat ? 1 : 0,
      ...(nat ? { natGatewayProvider: nat } : {}),
      subnetConfiguration: nat
        ? [
            { name: "public", subnetType: SubnetType.PUBLIC, cidrMask: 24 },
            { name: "app", subnetType: SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
            { name: "data", subnetType: SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
          ]
        : [{ name: "public", subnetType: SubnetType.PUBLIC }],
    });
    nat?.connections.allowFrom(Peer.ipv4(vpc.vpcCidrBlock), Port.allTraffic(), "Out to the internet");
    const apiSecurity = isPrivate
      ? new SecurityGroup(this, "ApiSecurity", { vpc, description: "Store Lambda" })
      : undefined;
    const dbSecurity = new SecurityGroup(this, "DbSecurity", {
      vpc,
      description: apiSecurity
        ? "Store database: Postgres from the store Lambda only"
        : "Store database: Postgres over TLS (the Lambda has no fixed address)",
    });
    if (apiSecurity) dbSecurity.addIngressRule(apiSecurity, Port.tcp(5432), "Postgres from the store Lambda");
    else dbSecurity.addIngressRule(Peer.anyIpv4(), Port.tcp(5432), "Postgres over TLS");
    const engine = DatabaseInstanceEngine.postgres({ version: PostgresEngineVersion.VER_16 });
    const db = new DatabaseInstance(this, "Database", {
      engine,
      instanceType: InstanceType.of(InstanceClass.T4G, InstanceSize.MICRO),
      vpc,
      vpcSubnets: { subnetType: isPrivate ? SubnetType.PRIVATE_ISOLATED : SubnetType.PUBLIC },
      publiclyAccessible: !isPrivate,
      securityGroups: [dbSecurity],
      credentials: Credentials.fromGeneratedSecret("storeadmin"),
      databaseName: "store",
      parameterGroup: new ParameterGroup(this, "DbParams", {
        engine,
        parameters: { "rds.force_ssl": "1" },
      }),
      allocatedStorage: 20,
      maxAllocatedStorage: 20,
      storageEncrypted: true,
      multiAz: false,
      backupRetention: Duration.days(isPrivate ? 7 : 1),
      deletionProtection: isPrivate,
      removalPolicy: RemovalPolicy.SNAPSHOT,
    });

    // N8 pastes the Square token here in the AWS console. Deploys don't overwrite it.
    const square = live
      ? new Secret(this, "SquareLiveToken", {
          description:
            "Square production access token for the live store (plain text). Paste it in the console.",
          secretStringValue: SecretValue.unsafePlainText(LIVE_SQUARE_PLACEHOLDER),
        })
      : new Secret(this, "SquareSandboxToken", {
          description:
            "Square Sandbox access token for the store demo (plain text). Paste it in the console.",
          secretStringValue: SecretValue.unsafePlainText(SQUARE_PLACEHOLDER),
        });
    // The webhook's signature key from Square's Webhooks page. Until it's pasted, the webhook is off and
    // orders are confirmed by the thank-you page and the catch-up at start.
    const webhookKey = new Secret(this, "SquareWebhookKey", {
      description: "Square webhook signature key (plain text). Paste it in the console.",
      secretStringValue: SecretValue.unsafePlainText(WEBHOOK_PLACEHOLDER),
    });
    const webhookUrl = `https://${siteName}/api/square/webhook`;

    // Sign-in codes and receipts come from the store's own subdomain.
    const mail = new EmailIdentity(this, "MailDomain", { identity: Identity.domain(siteName) });
    mail.dkimRecords.forEach((r, i) => {
      new CnameRecord(this, `Dkim${i + 1}`, {
        zone,
        recordName: `${r.name}.`,
        domainName: r.value,
        ttl: Duration.hours(1),
      });
    });
    // While SES is in its sandbox it only sends to verified addresses, so verify the staff.
    if (props.verifyStaffEmails !== false)
      props.staffEmails.forEach(
        (email, i) => new EmailIdentity(this, `Staff${i + 1}`, { identity: Identity.email(email) }),
      );

    const api = new NodejsFunction(this, "StoreApi", {
      entry: join(repoRoot, "services/store-api/src/lambda.ts"),
      handler: "handler",
      runtime: Runtime.NODEJS_24_X,
      architecture: Architecture.ARM_64,
      memorySize: 512,
      // The first start on a new database runs every migration; API Gateway waits at most 30 seconds.
      timeout: Duration.seconds(29),
      ...(apiSecurity
        ? { vpc, vpcSubnets: { subnetType: SubnetType.PRIVATE_WITH_EGRESS }, securityGroups: [apiSecurity] }
        : {}),
      logGroup: new LogGroup(this, "StoreApiLogs", {
        retention: RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
      projectRoot: repoRoot,
      depsLockFilePath: join(repoRoot, "package-lock.json"),
      environment: {
        SQUARE_ENV: live ? "live" : "sandbox",
        DB_SECRET_ARN: db.secret!.secretArn,
        SQUARE_SECRET_ARN: square.secretArn,
        SQUARE_WEBHOOK_SECRET_ARN: webhookKey.secretArn,
        SQUARE_WEBHOOK_URL: webhookUrl,
        STORE_MIGRATIONS_DIR: "/var/task/migrations",
        RDS_CA_FILE: "/var/task/rds-global-bundle.pem",
        MAIL_FROM: `Bearded Board Games <no-reply@${primaryName}>`,
        BBG_BUSINESS_ID: props.businessId,
        BBG_STAFF: props.staffEmails.join(","),
        BBG_SITE_URL: `https://${primaryName}`,
        // The register at /register: its own tables beside the store's, and (DEMO) sample stock.
        POS_MIGRATIONS_DIR: "/var/task/pos-migrations",
        POS_OWNERS: props.registerOwners.join(", "),
        ...(props.demoStock ? { POS_DEMO_STOCK: String(props.demoStock) } : {}),
        ...(live && props.squareApplicationId ? { SQUARE_APP_ID: props.squareApplicationId } : {}),
      },
      bundling: {
        format: OutputFormat.ESM,
        target: "node24",
        mainFields: ["module", "main"],
        // The runtime has the AWS SDK; PGlite is only for local runs; pg-native is optional.
        externalModules: ["@aws-sdk/*", "@electric-sql/pglite", "pg-native"],
        banner: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
        sourceMap: true,
        commandHooks: {
          beforeBundling: () => [],
          beforeInstall: () => [],
          afterBundling: (inputDir, outputDir) => [
            `node "${join(inputDir, "infra/scripts/copy-store-lambda-files.mjs")}" "${inputDir}" "${outputDir}"`,
          ],
        },
      },
    });
    db.secret!.grantRead(api);
    square.grantRead(api);
    webhookKey.grantRead(api);
    api.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["ses:SendEmail"],
        resources: [`arn:aws:ses:${this.region}:${this.account}:identity/*`],
      }),
    );

    const httpApi = new HttpApi(this, "HttpApi", { description: "Bearded Board Games store /api" });
    httpApi.addRoutes({
      path: "/api/{proxy+}",
      methods: [HttpMethod.ANY],
      integration: new HttpLambdaIntegration("StoreApiIntegration", api),
    });
    // https://<id>.execute-api.<region>.amazonaws.com -> the host part.
    const apiHost = Fn.select(2, Fn.split("/", httpApi.apiEndpoint));

    const certificate = shop
      ? new Certificate(this, "ShopCertificate", {
          domainName: siteName,
          subjectAlternativeNames: [shop.name, `www.${shop.name}`],
          validation: CertificateValidation.fromDnsMultiZone({
            [siteName]: zone,
            [shop.name]: shop.zone,
            [`www.${shop.name}`]: shop.zone,
          }),
        })
      : new Certificate(this, "Certificate", {
          domainName: siteName,
          validation: CertificateValidation.fromDns(zone),
        });

    // Kept out of search results until the shop's own domain is the main address.
    const headers = new ResponseHeadersPolicy(this, "Headers", {
      securityHeadersBehavior: {
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: HeadersFrameOption.DENY, override: true },
        referrerPolicy: {
          referrerPolicy: HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
          override: true,
        },
        strictTransportSecurity: { accessControlMaxAge: Duration.days(365), override: true },
      },
      ...(shop?.primary
        ? {}
        : {
            customHeadersBehavior: {
              customHeaders: [{ header: "X-Robots-Tag", value: "noindex, nofollow", override: true }],
            },
          }),
    });

    const bucket = new Bucket(this, "SiteBucket", {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const viewerRequest = new EdgeFunction(this, "SiteRequest", {
      runtime: FunctionRuntime.JS_2_0,
      comment: "Old Squarespace links and single-page app routes",
      code: FunctionCode.fromInline(
        viewerRequestCode(oldSiteRedirects, shop?.primary ? shop.name : undefined),
      ),
    });

    const distribution = new Distribution(this, "Distribution", {
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(bucket),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        responseHeadersPolicy: headers,
        functionAssociations: [{ function: viewerRequest, eventType: FunctionEventType.VIEWER_REQUEST }],
      },
      additionalBehaviors: {
        "/api/*": {
          origin: new HttpOrigin(apiHost, { protocolPolicy: OriginProtocolPolicy.HTTPS_ONLY }),
          viewerProtocolPolicy: ViewerProtocolPolicy.HTTPS_ONLY,
          allowedMethods: AllowedMethods.ALLOW_ALL,
          cachePolicy: CachePolicy.CACHING_DISABLED,
          originRequestPolicy: OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          responseHeadersPolicy: headers,
        },
      },
      domainNames: shop ? [siteName, shop.name, `www.${shop.name}`] : [siteName],
      certificate,
      defaultRootObject: "index.html",
      priceClass: PriceClass.PRICE_CLASS_100,
      httpVersion: HttpVersion.HTTP2_AND_3,
    });

    const target = RecordTarget.fromAlias(new CloudFrontTarget(distribution));
    new ARecord(this, "AliasA", { zone, recordName: props.subdomain, target });
    new AaaaRecord(this, "AliasAAAA", { zone, recordName: props.subdomain, target });

    new BucketDeployment(this, "DeploySite", {
      sources: [Source.asset(join(process.cwd(), props.siteDir))],
      destinationBucket: bucket,
      // The register's files are deployed below; pruning here would delete them.
      exclude: ["register/*"],
      distribution,
      distributionPaths: ["/*"],
      // The song videos make the site about 50 MB.
      memoryLimit: 1024,
    });

    new BucketDeployment(this, "DeployRegister", {
      sources: [Source.asset(join(process.cwd(), props.registerDir))],
      destinationBucket: bucket,
      destinationKeyPrefix: "register/",
      distribution,
      distributionPaths: ["/register/*"],
    });

    new CfnOutput(this, "SiteUrl", { value: `https://${primaryName}` });
    new CfnOutput(this, "DistributionDomain", {
      value: distribution.distributionDomainName,
      description: "For the shop domain's records (storeDistributionDomain in infra/cdk.json)",
    });
    new CfnOutput(this, "SquareSecretName", {
      value: square.secretName,
      description: `Paste the Square ${live ? "production" : "Sandbox"} token here (Secrets Manager, us-east-1)`,
    });
    new CfnOutput(this, "SquareWebhookUrl", {
      value: webhookUrl,
      description: "Square Developer, Webhooks: add this URL with payment.updated and order.updated",
    });
    new CfnOutput(this, "SquareWebhookSecretName", {
      value: webhookKey.secretName,
      description: "Paste the webhook's signature key here (Secrets Manager, us-east-1)",
    });
    new CfnOutput(this, "RegisterUrl", { value: `https://${primaryName}/register` });
    new CfnOutput(this, "DistributionId", { value: distribution.distributionId });
  }
}
