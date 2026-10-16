# Pet Store POS & Grooming System Spec

Oct 15, 2026 · @N8 the Gr8

## Overview

One web app runs the store's register, inventory, customer and pet records, grooming calendar, and Astro Loyalty tracking. It replaces a Shopify POS + booking app + MyTime combination with a single system the store owns, built by Nate with Claude Code on AWS.

**Goals**

- Ring a sale with Astro frequent buyer credit in under 30 seconds
- Book, check in and check out a groom on the same ticket as retail items
- Know stock levels and what to reorder without a spreadsheet
- Keep monthly running cost well under a commercial POS subscription

**Roles**

| Role | Can do |
| --- | --- |
| Owner | Everything, including settings, prices, staff, reports, refunds |
| Manager | Inventory, purchase orders, schedule changes, refunds up to a limit |
| Cashier | Ring sales, look up and add customers, check in appointments |
| Groomer | See own schedule, add grooming notes and photos, mark appointments done |
| Customer (public) | Book grooming online, manage own pets and appointments |

**Scope by phase**

1. Foundation: products, inventory, customers, pets, staff login
2. POS: checkout with Stripe Terminal, receipts, refunds, Astro queue
3. Grooming: services, groomer schedules, calendar, check-in to POS
4. Online booking: public booking page, deposits, email and text reminders
5. Growth: purchase orders, reports, live Astro API once credentials arrive

Out of scope for now: daycare and boarding, e-commerce storefront, multiple locations. The data model leaves room for a location field so a second store is an addition, not a rewrite.

## Architecture

A serverless web app on AWS: the browser loads a static app, every action goes through one API, and only Lambda functions inside a private network can reach the database.

&#91;embedded content: system architecture · 4 zones\]

The card reader talks to Stripe directly; the POS only creates the payment and records the result, so card numbers never touch your servers.

- **Front end:** React + TypeScript, one app with staff and public booking routes; installable as a PWA on the counter tablet
- **API:** API Gateway HTTP API + Lambda (Node.js, TypeScript); one Lambda per area (sales, inventory, booking) sharing a data layer
- **Database:** RDS Postgres in private subnets; migrations in the repo, run on deploy
- **Auth:** Cognito user pool with groups per role; customers sign in with a one-time code
- **Payments:** Stripe Terminal (server-driven) for the counter, Stripe Checkout for deposits, webhooks into Lambda
- **Background work:** EventBridge Scheduler for reminders, SQS for Astro sends and webhooks
- **Infrastructure:** AWS CDK, separate dev and prod stacks; GitHub Actions deploys on merge

## Data model

Postgres, one schema. Money is stored as integer cents. Every table has `id` (UUID), `created_at`, `updated_at`, and `location_id` where a second store would split the data.

| Table | Key fields | Notes |
| --- | --- | --- |
| staff | name, email, role, cognito\_sub, active | Role drives permissions; Cognito handles login |
| products | sku, barcode, name, brand, category, price\_cents, cost\_cents, tax\_class, reorder\_at, astro\_program\_id, active | Barcode indexed for scanning |
| inventory\_levels | product\_id, on\_hand, back\_bar | Back-bar = grooming supplies used, not sold |
| inventory\_moves | product\_id, qty\_change, reason (sale, receive, adjust, consume, return), ref\_id, staff\_id | Append-only; on\_hand is the running sum |
| vendors | name, contact, lead\_time\_days, min\_order\_cents |  |
| purchase\_orders / po\_lines | vendor\_id, status, expected\_at / product\_id, qty, cost\_cents, received\_qty | Phase 5 |
| customers | name, phone, email, street, city, state, zip, birthday (optional), sms\_opt\_in, notes, astro\_customer\_id | Phone is the lookup key at the counter |
| pets | customer\_id, name, species (dog, cat, other), breed or notes, size (S/M/L/XL), coat, birthday (optional), weight\_lb, temperament, allergies, vet\_name | One customer, many pets |
| vaccinations | pet\_id, vaccine, expires\_on, proof\_file\_key | File in S3; block booking when rabies has lapsed |
| services | name, base\_minutes, price by size (JSON), buffer\_minutes, deposit\_cents, active | e.g. Full groom, Bath, Nail trim |
| groomer\_schedules | staff\_id, weekday, start\_time, end\_time / time\_off rows |  |
| appointments | pet\_id, staff\_id, service\_id, starts\_at, ends\_at, status (booked, checked\_in, in\_progress, ready, done, no\_show, cancelled), deposit\_payment\_id, notes | Exclusion constraint stops double-booking a groomer |
| grooming\_notes | appointment\_id, staff\_id, note, photo\_keys | Shows on the pet's history |
| sales | customer\_id, staff\_id, status, subtotal, discount, tax, total, payment\_method | Open ticket until paid |
| sale\_lines | sale\_id, product\_id or appointment\_id, qty, unit\_price\_cents, discount\_cents | Services and retail on one ticket |
| payments | sale\_id, provider (stripe, cash), provider\_ref, amount\_cents, status, refunded\_cents | Never stores card numbers |
| astro\_programs | name, brand, buy\_count, reward\_text, astro\_program\_ref | Mirrors programs the store joined in Astro |
| astro\_punches | customer\_id, program\_id, sale\_id, qty, kind (earn, redeem) | Running balance per customer per program |
| astro\_queue | sale\_id, payload (JSON), status (pending, entered, sent, failed), attempts, error | The bridge to Astro, see Astro section |
| audit\_log | staff\_id, action, entity, entity\_id, before, after | Refunds, price changes, voids |

Use an exclusion constraint on appointments (`staff_id` + `tstzrange(starts_at, ends_at)`) so the database itself refuses an overlapping booking, even if two people book the same slot at once.

## Screens and features

Staff screens use a Shopify-like admin layout: left sidebar, page title with one primary action at top right, data tables with filters, a slide-over panel for editing. Use the store's own name, logo and colors. The POS screen is full-width and touch-first for a tablet at the counter.

**POS (register)**

- Barcode scan field always focused; USB or Bluetooth scanners type into it like a keyboard
- Product grid with category tabs and search; customer lookup by phone number
- Ticket shows retail items and grooming services together; checking out an appointment pulls its service onto the ticket
- Astro panel on the ticket: punches earned this sale, rewards ready to redeem, offers that apply to items in the cart
- Pay by Stripe Terminal card reader, cash (with change due), or split; deposits already paid are applied automatically
- Receipt by email or text; optional thermal printer later
- Refund and void, manager approval above a set amount, every one written to the audit log
- End of day: drawer count, card total, cash total, over/short

**Inventory**

- Product list with on-hand, reorder point, margin, and a low-stock filter
- Receive stock by scanning items or from a purchase order
- Count mode on a phone: scan, type the count, save the adjustment
- Back-bar items (shampoo, blades) consumed per grooming service
- Import products from a CSV, including distributor price lists

**Customers and pets**

- Customer profile: phone, email, mailing address, text opt-in, Astro punch cards, full order history (imported and new) with total spent, first and last visit, and most-bought items, upcoming appointments
- Pet profile: breed, size, coat, temperament, allergies, vet, vaccination expiry dates, grooming notes and before/after photos
- Pets entered one per row: name, Dog / Cat / Other, breed or notes (where "rabbit" or "ferret" goes for Other), optional birthday; pet names unique per customer
  - Birthday tags for customers and pets within 7 days, shown on the customer card and on the POS after lookup
  - "Usually buys" shortcuts on the POS from the customer's top items, one tap to add
  - Delete customer: a warning listing what goes (pets, contact info, punch cards, imported history), upcoming appointments cancelled, past sales kept; the Delete button stays disabled until the user types "delete"
  - Warning on booking and check-in when a vaccination has expired

**Grooming calendar**

- Day and week views, one column per groomer, drag to reschedule
- Service length set by service and pet size, plus buffer time
- Status flow: booked, checked in, in progress, ready for pickup, done, no-show
- "Ready for pickup" sends the customer a text
- Bulk move a groomer's appointments when they call out

**Online booking (public)**

- Customer picks pet, service, groomer (or any), and an open slot
- New customers create an account by phone or email with a one-time code
- Deposit collected with Stripe Checkout for new customers or chosen services
- Confirmation, day-before reminder, and a rebook nudge after a set number of weeks
- Cancel or reschedule from a link, up to a cutoff the store sets

**Reports**

- Daily sales by payment type and category, grooming revenue by groomer
- Low stock and reorder list, inventory value at cost
- Astro: punches earned, rewards and offers redeemed, queue backlog
- No-shows and rebooking rate

## Astro Loyalty

Astro issues API credentials only to approved POS partners, so the system ships with a manual queue and swaps in the live API later without changing how cashiers ring sales. Contact Astro about partner access in week one; their answer sets the Phase 5 timeline.

**Now: tracked locally, entered by hand**

1. Each product links to the Astro frequent buyer program it counts toward, and optionally to a current Astro offer (label + amount).
2. At checkout, the POS adds punches for the attached customer, offers the reward when a card is full, and applies offers the cashier ticks.
3. Every sale with Astro activity writes one `astro_queue` row with status `pending` and a payload: customer, items with UPCs, quantities, prices, punches earned, rewards and offers redeemed.
4. The Astro screen lists pending rows. Staff enter each one in the Astro retailer portal, then tap **Mark entered**.
5. A weekly report compares local punch balances with Astro for a few customers to catch drift.

**Later: live API**

- An `AstroClient` module is the only code that talks to Astro. Until credentials exist it does nothing and rows stay `pending`.
- With credentials, a Lambda on an SQS queue sends each row, marks it `sent`, and retries with backoff on failure; after 5 failures it goes to `failed` and shows on the Astro screen.
- Customer lookup and offer lists then come from Astro at checkout, with local data as the fallback when Astro is slow or down, so a sale is never blocked.
- Store Astro credentials in AWS Secrets Manager, never in code or the browser.

Open question for Astro: whether rewards and offers apply before or after tax under the store's agreement. The POS supports both as a setting.

## Bulk import

Owners and managers load existing customers, pets, Astro programs, punch balances and products from a CSV or Excel file in one pass, with a preview before anything is saved and a one-click undo afterward.

**Import flow (Settings → Import)**

1. Pick what the file holds and upload a .csv or .xlsx (parse in the browser with SheetJS).
2. Columns are matched automatically by header name; the user can change any match from a dropdown.
3. Preview: first 20 rows plus counts of new, updated and skipped rows, each skipped row with its reason (no phone, unknown program, bad price).
4. Import runs server-side in batches of 500 in one `import_batches` record, so a 5,000-customer file finishes in seconds.
5. Undo reverses a whole batch: deletes rows it created and restores fields it changed.

**Matching rules**

- Customers match on phone, normalized to 10 digits, then on email. A match updates the existing customer instead of creating a duplicate.
- Pets attach to their owner by the same phone or email; a pet with the same name under the same owner is updated.
- Programs match by name, case-insensitive. A punch row for an unknown program is skipped, not guessed.
- Products match on SKU or barcode.

**Accepted columns** (header names are flexible; these are the defaults in the downloadable templates)

| File | Columns |
| --- | --- |
| Customers | name or first name + last name, phone, email, street address, city, state, zip, sms opt-in, notes |
| Pets | owner phone or owner email, pet name, species, breed, size, birthday, allergies, vet, rabies expires |
| Customers + pets in one file | customer columns plus pet 1 name, pet 1 breed, pet 2 name, … |
| Astro programs | program name, brand, buy count, reward |
| Astro punch balances | customer phone or email, program name, current punches |
| Products | sku, barcode, name, brand, category, price, cost, on hand, reorder at, astro program |

Past orders import into `sales` and `sale_lines` with `source = 'import'`, one row per item in the file; rows sharing a customer and receipt number (or a date, when there's no number) become one order. Imported orders carry no payment record and don't change inventory. They feed the customer's order history and the "usually buys" shortcuts on the POS.

Punch balances import as an `astro_punches` row of kind `opening_balance`, so reports can tell carried-over credit from credit earned in the new system.

Data model additions: an `import_batches` table (type, file name, staff\_id, row counts, status) and an `import_batch_id` column on customers, pets, products and astro\_punches.

Open question for Astro: which export formats the retailer portal offers for customers and frequent buyer balances. Get a sample export early and save its column mapping as a preset.

## Monthly cost estimate

Running cost is about **$40 a month** for one store, plus card processing. A comparable Shopify setup (Basic plan, POS Pro, Astro app, a grooming booking app) runs roughly $185 a month before processing. Figures are on-demand US prices; small items are approximate.

| Item | Monthly | Notes |
| --- | --- | --- |
| RDS Postgres db.t4g.micro | $12 | [source](https://www.bytebase.com/dbcost/rds/instance/db.t4g.micro/); move to t4g.small (\~$24) if it feels slow |
| RDS storage + backups, 20 GB | \~$3 | Backups up to the database size are included |
| NAT instance (t4g.nano) + public IPv4 | \~$7 | Lets Lambdas in the private network reach Stripe and Astro. A managed NAT Gateway costs \~$33+, so avoid it |
| Lambda, API Gateway, SQS, EventBridge Scheduler | \~$1–3 | A single store stays near the free-tier range |
| Amplify Hosting or S3 + CloudFront | \~$1–2 |  |
| Cognito | $0 | Staff and customer logins well under the free allowance |
| S3 for pet photos and vaccine proofs | \~$1 |  |
| SES email | <$1 | $0.10 per 1,000 emails |
| SMS: 10DLC number + low-volume campaign | $3 | [source](https://www.factualminds.com/blog/aws-end-user-messaging-sms-guide-2026/): $1 number, $2 campaign |
| SMS messages, \~600/month | \~$7 | Approximate; US rate varies by carrier, about 1 cent each with fees |
| CloudWatch logs and alarms | \~$3 |  |
| Domain + Route 53 | \~$2 |  |
| **Total infrastructure** | **\~$40** |  |
| Stripe in-person cards | 2.7% + 5¢ per sale | [source](https://www.nerdwallet.com/business/software/learn/stripe-fees); $30,000 in card sales ≈ $860. Commercial POS systems charge similar rates |
| Astro Loyalty | Store's existing plan | Same cost whichever POS they use |

**One-time costs**

- Card reader: Stripe Reader M2 $59, or WisePOS E $249 with its own screen ([source](https://www.nerdwallet.com/business/software/learn/stripe-fees))
- USB barcode scanner \~$30–60, cash drawer \~$80–120, receipt printer optional
- 10DLC SMS registration: about $60–70 in one-time fees, plus a few weeks for carrier approval, so start it in Phase 1

Not counted: your time as IT, and your Claude plan for building it. Card processing is the biggest cost by far, and it's the same order of magnitude on any system.

## Build plan and IT support

Build one phase at a time, each ending with something the store can use. The working prototype (single-page register with grooming, Astro queue, bulk import and demo data) is the reference for screens and behavior; save it in the repo as \`docs/prototype.html\` and point Claude Code at it. Run the new POS beside the old way for a week before switching over.

**Working with Claude Code**

- Keep this spec as `SPEC.md` in the repo root and a `CLAUDE.md` with stack choices, folder layout, money-in-cents rule, and test commands
- One feature per session: give the section of the spec, ask for a plan first, then the code and tests
- Infrastructure as code with AWS CDK in TypeScript, so dev and prod are identical and rebuildable
- Two environments: `dev` on your account with Stripe test mode, `prod` for the store

**Phase checklist**

- [ ] Week 1: contact Astro about partner API access; start 10DLC registration; order a Stripe reader
- [ ] Phase 1: repo, CDK stack, Cognito roles, products, inventory, customers, pets, CSV import
- [ ] Phase 2: POS checkout, Stripe Terminal, cash drawer, receipts, refunds, Astro queue, end-of-day report
- [ ] Phase 3: services, groomer schedules, calendar, check-in to POS, back-bar consumption
- [ ] Phase 4: public booking page, deposits, email and text reminders, rebook nudges
- [ ] Phase 5: purchase orders, reports, live Astro API

**Before go-live**

- [ ] Seed staging with records marked (DEMO) for training, with a one-step "remove demo data" that deletes only those; then import real products and customers and spot-check 20 barcodes at the counter
- [ ] Ring 50 test sales in Stripe test mode, including refunds, splits and Astro rewards
- [ ] Offline plan: if the internet drops, the reader takes no cards. Keep a paper sale log and cash-only fallback; consider a cellular hotspot
- [ ] Daily automated database backups, plus a monthly restore test into dev
- [ ] CloudWatch alarms emailed to you: API errors, database CPU and storage, failed Astro sends
- [ ] Staff training: one page per role, 30 minutes each

**Ongoing IT (you)**

- Agree with the owner in writing: response time for outages, what's included, and your monthly fee
- Patch dependencies monthly; keep the RDS engine on a supported version
- Owner gets admin access to the AWS account and Stripe, so the store isn't locked out if you're unavailable
- Keep a short runbook: how to restart, restore a backup, re-pair a card reader, and rotate keys
