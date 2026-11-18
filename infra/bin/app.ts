import { existsSync } from "node:fs";
import { join } from "node:path";
import { App } from "aws-cdk-lib";
import { BBG_RECORDS } from "../lib/bbg-dns.js";
import { DemoSiteStack } from "../lib/demo-site-stack.js";
import { DomainStack } from "../lib/domain-stack.js";
import { MailStack } from "../lib/mail-stack.js";
import { StoreDemoStack } from "../lib/store-demo-stack.js";

const app = new App();

const account = process.env.CDK_DEFAULT_ACCOUNT;
if (!account) {
  throw new Error("No AWS account found. Sign in with `aws sso login` (or `aws configure`) first.");
}

/**
 * A site stack needs its build. The whole app synthesizes on every deploy, so a stack whose site
 * isn't built yet is left out (with a note) instead of stopping the deploy of another stack.
 */
function built(stack: string, dir: string): boolean {
  if (existsSync(join(process.cwd(), dir))) return true;
  console.warn(`Leaving out ${stack}: ${dir} isn't built. Its npm deploy script builds it first.`);
  return false;
}

const siteDir: string = app.node.getContext("siteDir");
if (built("BeardedDemoSite", siteDir))
  new DemoSiteStack(app, "BeardedDemoSite", {
    // CloudFront certificates must be in us-east-1.
    env: { account, region: "us-east-1" },
    domainName: app.node.getContext("domainName"),
    subdomain: app.node.getContext("demoSubdomain"),
    siteDir,
    budgetMonthlyUsd: Number(app.node.getContext("budgetMonthlyUsd")),
    // Passed at deploy time: npx cdk deploy BeardedDemoSite -c budgetEmail=you@example.com
    budgetEmail: app.node.tryGetContext("budgetEmail"),
    description: "Bearded POS demo site (static, no backend)",
  });

// Bulk email (SES). Deploy on its own: npx cdk deploy BeardedMail
new MailStack(app, "BeardedMail", {
  env: { account, region: "us-east-1" },
  domainName: app.node.getContext("domainName"),
  mailSubdomain: app.node.getContext("mailSubdomain"),
  description: "Bearded Board Games bulk email: SES identity, DNS records and bounce/complaint events",
});

// The online store proof of concept at bbg.prismcortex.net: npm run deploy:store-demo
const storeSiteDir: string = app.node.getContext("storeSiteDir");
const registerDir: string = app.node.getContext("registerDir");
if (built("BeardedStoreDemo", storeSiteDir) && built("BeardedStoreDemo", registerDir))
  new StoreDemoStack(app, "BeardedStoreDemo", {
    env: { account, region: "us-east-1" },
    domainName: app.node.getContext("domainName"),
    subdomain: app.node.getContext("storeSubdomain"),
    siteDir: storeSiteDir,
    registerDir,
    registerOwners: app.node.getContext("registerOwners"),
    staffEmails: app.node.getContext("storeStaff"),
    businessId: app.node.getContext("storeBusinessId"),
    demoStock: 100,
    description:
      "Bearded Board Games online store demo: site, register, /api Lambda, Postgres (Square Sandbox only)",
  });

/**
 * The shop's own domain, in stages (shopDomainStage in cdk.json; docs/hosting-live-store.md):
 * - "copy": the BeardedDomain zone holds every Squarespace record, website included. Moving the
 *   nameservers to it changes nothing anyone can see.
 * - "attach": the live store also answers at the domain and www (its certificate validates through
 *   the zone, so the nameservers must have moved). The domain still shows Squarespace.
 * - "live": the domain and www point at the live store, which becomes the main address.
 */
const shopDomainName: string = app.node.getContext("shopDomain");
const shopStage: string = app.node.getContext("shopDomainStage");
if (!["copy", "attach", "live"].includes(shopStage))
  throw new Error('shopDomainStage must be "copy", "attach" or "live".');
const storeDistribution: string = app.node.tryGetContext("storeDistributionDomain") ?? "";
if (shopStage === "live" && !storeDistribution)
  throw new Error("The live stage needs storeDistributionDomain (BeardedStore's DistributionDomain output).");
const domain = new DomainStack(app, "BeardedDomain", {
  env: { account, region: "us-east-1" },
  domainName: shopDomainName,
  records: BBG_RECORDS,
  website:
    shopStage === "live" ? { kind: "store", distributionDomain: storeDistribution } : { kind: "squarespace" },
  terminationProtection: true,
  description: `${shopDomainName} DNS (copied from Squarespace) and the shop's SES sender`,
});

// The live store on the real Bearded Board Games Square account: npm run deploy:store-live
// Its own private database, so real orders never share a server with the Sandbox demo. The demo stack
// already owns the staff SES verifications, so this one doesn't send them again.
if (built("BeardedStore", storeSiteDir) && built("BeardedStore", registerDir))
  new StoreDemoStack(app, "BeardedStore", {
    env: { account, region: "us-east-1" },
    domainName: app.node.getContext("domainName"),
    subdomain: app.node.getContext("liveSubdomain"),
    siteDir: storeSiteDir,
    registerDir,
    registerOwners: app.node.getContext("registerOwners"),
    staffEmails: app.node.getContext("storeStaff"),
    businessId: app.node.getContext("storeBusinessId"),
    squareMode: "live",
    squareApplicationId: app.node.tryGetContext("squareLiveApplicationId") || undefined,
    privateDatabase: true,
    ...(shopStage === "copy"
      ? {}
      : { shopDomain: { zone: domain.zone, name: shopDomainName, primary: shopStage === "live" } }),
    verifyStaffEmails: false,
    terminationProtection: true,
    description:
      "Bearded Board Games live store: site, register, /api Lambda, private Postgres (real Square)",
  });
