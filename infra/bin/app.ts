import { existsSync } from "node:fs";
import { join } from "node:path";
import { App } from "aws-cdk-lib";
import { DemoSiteStack } from "../lib/demo-site-stack.js";
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
    description:
      "Bearded Board Games online store demo: site, register, /api Lambda, Postgres (Square Sandbox only)",
  });
