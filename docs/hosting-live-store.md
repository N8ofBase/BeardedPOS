# Live store (real Square)

The `BeardedStore` stack runs the store on the real Bearded Board Games Square account, beside the
Sandbox demo (`BeardedStoreDemo`, see `hosting-store-demo.md`). The two never share a server or a
database, so test money and real money can't mix.

Until the domain moves it lives at https://bbg-live.prismcortex.net (`liveSubdomain` in `infra/cdk.json`)
and search engines are told to skip it.

## How it differs from the demo

- `SQUARE_ENV=live`: Square's production API. The server won't start until the production token is in
  its secret, so there is never an offline "preview" checkout on the live site.
- The database is private: no internet address, and only the store Lambda's security group may connect.
  The Lambda runs in the VPC and reaches Square, SES and Secrets Manager through a small NAT instance
  (t4g.nano). Seven days of backups, delete protection, and a snapshot if the stack is ever deleted. The
  stack itself has termination protection.
- The register at `/register` starts with no (DEMO) stock or sample customers.
- The staff SES verifications stay with the demo stack (SES allows only one owner per address).

Cost: about $25 a month (database about $15, NAT instance and its address about $7, the rest small).

## Steps

1. **Deploy** (Windows PowerShell):

   ```powershell
   git checkout main; git pull
   npm.cmd install
   aws sso login --profile prismcortex
   aws configure export-credentials --profile prismcortex --format powershell | Invoke-Expression
   npm.cmd run deploy:store-live
   ```

   The first deploy takes 15 to 20 minutes. Until step 2 the site loads but its `/api` says "The store is
   waking up".

2. **Paste the production token.** Square Developer, signed in as Bearded Board Games, the "Bearded Store"
   app, Production, Credentials: copy the Production Access token. AWS console, us-east-1, Secrets Manager,
   the secret in the `SquareSecretName` output, "Retrieve secret value", "Edit", plain text, paste, save.
   A running Lambda keeps the old value until it restarts (about 15 minutes of quiet).

3. **Check the account.** Sign in to Behind the Beard at `/behind-the-beard`. Under your email it says
   `Square (live, real money): <shop name>, <location>`. It must name Bearded Board Games. If it names
   another shop or says Square didn't answer, stop: the token is wrong.

4. **Set up the webhook.** Square Developer, the same app, Production, Webhooks, Subscriptions, "Add
   subscription": the URL in the `SquareWebhookUrl` output, events `payment.updated` and `order.updated`.
   Save, then copy its Signature key into the secret in the `SquareWebhookSecretName` output (plain text).
   Square's "Send test event" should answer 200. Until the key is pasted the webhook answers 404, and
   orders are still confirmed by the thank-you page and the catch-up at start.

5. **SES production access.** AWS console, us-east-1, Amazon SES, Account dashboard, "Request production
   access". Until then sign-in codes and receipts only reach verified addresses.

6. **Sales tax.** Online orders use the taxes set on each item in Square (the store asks Square to apply
   them), so check every game has the Missouri tax turned on in the Bearded Square catalog. For the
   register, set the rate in its Settings.

7. **A $1 test.** Buy something real, check it shows as paid and comes off stock, then refund it in
   Square.

When the domain moves, the site URL changes, so the webhook URL in step 4 changes with it: update the
subscription in Square at the same time.

## Not yet

- The register still uses the simulated card reader. Real counter card payments need a Square Terminal
  and its own build step; until then only take cash on the live register.
- beardedboardgames.com and www (the certificate, the DNS move and email from the shop's own domain) are
  the next PR, once we know where the domain is registered.
