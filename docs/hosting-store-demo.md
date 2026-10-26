# Store demo at bbg.prismcortex.net

A proof of concept of the online store, hosted in AWS by the `BeardedStoreDemo` stack
(`infra/lib/store-demo-stack.ts`). Square is Sandbox only, and search engines are told not to index it.

## What it makes

- The built store (`apps/store/dist`) in a private S3 bucket behind CloudFront at https://bbg.prismcortex.net.
  Old Squarespace links (`oldSiteRedirects`) get a 301 to their new pages.
- `/api/*` goes to the store server in Lambda (Node 24, `services/store-api/src/lambda.ts`) behind an HTTP API.
- The smallest RDS Postgres 16 (db.t4g.micro, 20 GB). It's public with TLS forced and a generated
  password, so the Lambda doesn't need a NAT gateway. Migrations run on the first request.
- Two secrets: the database login (generated) and the Square Sandbox token (a placeholder until you paste it).
- Amazon SES for sign-in codes, from no-reply@bbg.prismcortex.net, plus a verification email to each staff address.
- New records in the prismcortex.net zone only: `bbg` A/AAAA, the certificate check, and three DKIM CNAMEs.

Cost: about $15 to $20 a month, mostly the database. Delete the stack to stop it (the database leaves a snapshot).

## Deploy (Windows PowerShell)

```powershell
git checkout main; git pull
npm.cmd install
aws sso login --profile prismcortex
aws configure export-credentials --profile prismcortex --format powershell | Invoke-Expression
npm.cmd run deploy:store-demo
```

The first deploy takes 15 to 20 minutes (the database and CloudFront are slow to create).

## After the first deploy

1. Open the SES verification emails sent to each staff address and click the link. Until SES is out of
   its sandbox, sign-in codes only reach verified addresses.
2. Paste the Square Sandbox token: AWS console, us-east-1, Secrets Manager, the secret named in the
   `SquareSecretName` output, "Retrieve secret value", "Edit", plain text. Until then the store shows
   the saved catalog and Square is offline. A running Lambda keeps the old value until it restarts,
   usually within about 15 minutes of quiet.
3. Staff sign-in emails are set in `infra/cdk.json` (`storeStaff`).
