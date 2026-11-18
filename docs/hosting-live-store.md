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

## Moving beardedboardgames.com

The domain stays registered at Squarespace; only its DNS moves to Route 53 (Squarespace's DNS can't
point the bare domain at CloudFront). The `BeardedDomain` stack holds every record copied from
Squarespace (`infra/lib/bbg-dns.ts`: Google Workspace email, the Mailchimp and Sender.net signatures,
SPF with Google, Sender.net and Amazon SES, DMARC, both Google verifications, `theranch`), plus the
shop's SES sender. It moves in three stages, set by `shopDomainStage` in `infra/cdk.json`. Each one
is safe to stop at.

1. **"copy": move the nameservers. Nobody sees a change.** `npm.cmd run deploy:domain`. The zone also
   copies Squarespace's website records, so the old site keeps showing. Then in Squarespace, Domains,
   beardedboardgames.com:
   - DNS, DNSSEC: if it's on, turn it off first and wait a day (a nameserver move with DNSSEC on can
     take the whole domain offline).
   - Domain Nameservers: "Use custom nameservers", the four in the `NameServers` output.

   Check after an hour: email to and from adam@beardedboardgames.com still works, and the old site
   still loads. Resolvers can take up to two days to move over; nothing breaks meanwhile, since both
   DNS hosts give the same answers.
2. **"attach": the store answers at the domain too.** Set `"shopDomainStage": "attach"`,
   `npm.cmd run deploy:store-live`. The certificate gains beardedboardgames.com and www and validates
   through the zone (only once the nameservers have moved). Copy the `DistributionDomain` output into
   `storeDistributionDomain` in `infra/cdk.json`. The domain still shows Squarespace.
3. **"live": switch over.** Set `"shopDomainStage": "live"`, `npm.cmd run deploy:store-live`. The
   domain and www point at the store (an in-place record change, so the name never stops resolving);
   www and bbg-live.prismcortex.net redirect to https://beardedboardgames.com; Square sends shoppers
   back there; mail comes from no-reply@beardedboardgames.com; search engines may index it. The webhook
   keeps its bbg-live.prismcortex.net address, so nothing changes in Square.

Going back from "live" to "attach" puts Squarespace back on the domain within minutes (5-minute TTL),
as long as the Squarespace site plan hasn't been cancelled.

Cancel Squarespace's website plan only after a couple of weeks live, and keep the domain: it's billed
separately. Either keep paying Squarespace for the domain, or transfer it to Route 53 (about $14 a
year) first. The DNS stays in Route 53 either way.

## Card payments at the register (Square POS app)

The live register takes cards through the Square POS app on the same phone or tablet, with the
Square Reader you already use at the farmers market. Tap Card on the register, the Square app opens
with the amount, the customer taps or inserts, and the register comes back showing Paid. The server
asks Square about each payment (amount, location, time) before it counts, and refunds from the
register go back to the card through Square. Until these steps are done the register keeps the
pretend reader, so only take cash.

1. **Register the return page.** Square Developer, signed in as Bearded Board Games, the "Bearded
   Store" app, Production, Point of Sale API: add the web callback URL
   `https://bbg-live.prismcortex.net/register/square-return`. Add
   `https://beardedboardgames.com/register/square-return` too, before the domain's "live" stage.
2. **Set the app id.** Same app, Production, Credentials: copy the Application ID (`sq0idp-…`; it isn't
   secret) into `squareLiveApplicationId` in `infra/cdk.json`, then `npm.cmd run deploy:store-live`.
3. **Check the token's permissions.** The production access token must allow Orders read and Payments
   write (for refunds). A personal access token from the Developer Dashboard has them.
4. **Set up the phone or tablet.** Install Square Point of Sale, sign in to Bearded Board Games, pair
   the reader. Open the register in Safari (iPhone/iPad) or Chrome (Android) itself, not from a
   home-screen icon: Square comes back to the browser, and a home-screen app has its own sign-in.
5. **A $1 test.** Ring up $1, tap Card, pay in the Square app, check the register says Paid, then
   refund it from Sales. If you can, also try Tap to Pay on the phone in the Square app.

If Square's app doesn't come back to the register (it can happen when it's offline), go back to the
register yourself and tap **Find it in Square**: it looks up a card payment of that amount taken since
the sale started. Only tap **Cancel card payment** when the customer really didn't pay. A laptop can't
open the Square app; on a laptop take cash, or ring the sale up on the phone.

Tips added in the Square app go to Square, not into the register's totals. Refunds made in the Square
app itself aren't seen by the register; refund from the register instead.

## Not yet

- The register's items, prices, stock and customers don't sync with Square yet. That's the next step.
