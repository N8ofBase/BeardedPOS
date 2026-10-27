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
  Peer,
  Port,
  SecurityGroup,
  SubnetType,
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
import { AaaaRecord, ARecord, CnameRecord, HostedZone, RecordTarget } from "aws-cdk-lib/aws-route53";
import { CloudFrontTarget } from "aws-cdk-lib/aws-route53-targets";
import { BlockPublicAccess, Bucket, BucketEncryption } from "aws-cdk-lib/aws-s3";
import { BucketDeployment, Source } from "aws-cdk-lib/aws-s3-deployment";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import { EmailIdentity, Identity } from "aws-cdk-lib/aws-ses";
import type { Construct } from "constructs";
import { oldSiteRedirects } from "../../packages/store-core/src/oldSite.ts";
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
}

/** Must match SQUARE_PLACEHOLDER in services/store-api/src/lambda.ts: Square stays offline until replaced. */
const SQUARE_PLACEHOLDER = "paste-the-square-sandbox-token-here";

/**
 * The online store as a proof of concept at <subdomain>.<domainName>: the built site in a private S3
 * bucket behind CloudFront, /api to the store server in Lambda (behind an HTTP API), and the smallest
 * RDS Postgres. Square is Sandbox only. Kept out of search engines. Adds only its own records to the
 * existing hosted zone; never changes other records.
 */
export class StoreDemoStack extends Stack {
  constructor(scope: Construct, id: string, props: StoreDemoStackProps) {
    super(scope, id, props);

    const siteName = `${props.subdomain}.${props.domainName}`;
    const zone = HostedZone.fromLookup(this, "Zone", { domainName: props.domainName });
    const repoRoot = join(process.cwd(), "..");

    // Database. Public with TLS forced and a long generated password, so the Lambda can stay outside
    // the VPC (no NAT gateway to pay for). Snapshot on delete: staff choices and accounts live here.
    const vpc = new Vpc(this, "Vpc", {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [{ name: "public", subnetType: SubnetType.PUBLIC }],
    });
    const dbSecurity = new SecurityGroup(this, "DbSecurity", {
      vpc,
      description: "Store database: Postgres over TLS (the Lambda has no fixed address)",
    });
    dbSecurity.addIngressRule(Peer.anyIpv4(), Port.tcp(5432), "Postgres over TLS");
    const engine = DatabaseInstanceEngine.postgres({ version: PostgresEngineVersion.VER_16 });
    const db = new DatabaseInstance(this, "Database", {
      engine,
      instanceType: InstanceType.of(InstanceClass.T4G, InstanceSize.MICRO),
      vpc,
      vpcSubnets: { subnetType: SubnetType.PUBLIC },
      publiclyAccessible: true,
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
      backupRetention: Duration.days(1),
      deletionProtection: false,
      removalPolicy: RemovalPolicy.SNAPSHOT,
    });

    // N8 pastes the Square Sandbox token here in the AWS console. Deploys don't overwrite it.
    const square = new Secret(this, "SquareSandboxToken", {
      description: "Square Sandbox access token for the store demo (plain text). Paste it in the console.",
      secretStringValue: SecretValue.unsafePlainText(SQUARE_PLACEHOLDER),
    });

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
    props.staffEmails.forEach(
      (email, i) => new EmailIdentity(this, `Staff${i + 1}`, { identity: Identity.email(email) }),
    );

    const api = new NodejsFunction(this, "StoreApi", {
      entry: join(repoRoot, "services/store-api/src/lambda.ts"),
      handler: "handler",
      runtime: Runtime.NODEJS_24_X,
      architecture: Architecture.ARM_64,
      memorySize: 512,
      timeout: Duration.seconds(20),
      logGroup: new LogGroup(this, "StoreApiLogs", {
        retention: RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
      projectRoot: repoRoot,
      depsLockFilePath: join(repoRoot, "package-lock.json"),
      environment: {
        SQUARE_ENV: "sandbox",
        DB_SECRET_ARN: db.secret!.secretArn,
        SQUARE_SECRET_ARN: square.secretArn,
        STORE_MIGRATIONS_DIR: "/var/task/migrations",
        RDS_CA_FILE: "/var/task/rds-global-bundle.pem",
        MAIL_FROM: `Bearded Board Games <no-reply@${siteName}>`,
        BBG_BUSINESS_ID: props.businessId,
        BBG_STAFF: props.staffEmails.join(","),
        BBG_SITE_URL: `https://${siteName}`,
        // The register at /register: its own tables beside the store's, and (DEMO) sample stock.
        POS_MIGRATIONS_DIR: "/var/task/pos-migrations",
        POS_OWNERS: props.registerOwners.join(", "),
        POS_DEMO_STOCK: "100",
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

    const certificate = new Certificate(this, "Certificate", {
      domainName: siteName,
      validation: CertificateValidation.fromDns(zone),
    });

    // A proof of concept: keep it out of search results until the domain moves.
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
      customHeadersBehavior: {
        customHeaders: [{ header: "X-Robots-Tag", value: "noindex, nofollow", override: true }],
      },
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
      code: FunctionCode.fromInline(viewerRequestCode(oldSiteRedirects)),
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
      domainNames: [siteName],
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

    new CfnOutput(this, "SiteUrl", { value: `https://${siteName}` });
    new CfnOutput(this, "SquareSecretName", {
      value: square.secretName,
      description: "Paste the Square Sandbox token here (Secrets Manager, us-east-1)",
    });
    new CfnOutput(this, "RegisterUrl", { value: `https://${siteName}/register` });
    new CfnOutput(this, "DistributionId", { value: distribution.distributionId });
  }
}
