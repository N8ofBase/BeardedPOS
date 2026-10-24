import { App } from "aws-cdk-lib";
import { DemoSiteStack } from "../lib/demo-site-stack.js";
import { MailStack } from "../lib/mail-stack.js";

const app = new App();

const account = process.env.CDK_DEFAULT_ACCOUNT;
if (!account) {
  throw new Error("No AWS account found. Sign in with `aws sso login` (or `aws configure`) first.");
}

new DemoSiteStack(app, "DemoSite", {
  // CloudFront certificates must be in us-east-1.
  env: { account, region: "us-east-1" },
  domainName: app.node.getContext("domainName"),
  subdomain: app.node.getContext("demoSubdomain"),
  siteDir: app.node.getContext("siteDir"),
  budgetMonthlyUsd: Number(app.node.getContext("budgetMonthlyUsd")),
  // Passed at deploy time: npx cdk deploy DemoSite -c budgetEmail=you@example.com
  budgetEmail: app.node.tryGetContext("budgetEmail"),
  description: "PrismCortex pet POS demo site (static, no backend)",
});

// Bulk email (SES). Deploy on its own: npx cdk deploy BeardedMail
new MailStack(app, "BeardedMail", {
  env: { account, region: "us-east-1" },
  domainName: app.node.getContext("domainName"),
  mailSubdomain: app.node.getContext("mailSubdomain"),
  description: "Bearded Board Games bulk email: SES identity, DNS records and bounce/complaint events",
});
