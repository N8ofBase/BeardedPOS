# Pet store POS & grooming system

Point of sale, inventory, customers and pets, grooming calendar and online booking, and Astro Loyalty tracking for one independent pet store, built by PrismCortex so it can host several local businesses (and a second location per business) later.

- Full spec: `docs/SPEC.md` (export of the "Pet Store POS & Grooming System Spec" doc). Read the section for the feature you are working on before writing code.
- Working prototype: `docs/prototype.html`. It is the reference for screens, wording and behavior. Match its flows; do not copy its code structure (it is a single-file demo).
- Current phase plan: `docs/plans/phase-1-foundation.md`. Its approved decisions override the spec where they differ.

## Stack

- Front end: React + TypeScript (Vite), one app with staff routes and public booking routes. PWA for the counter tablet.
- Two run modes, same code:
  - **Demo mode (now):** handlers run in a Web Worker against PGlite (Postgres in the browser, saved to IndexedDB). Role picker instead of sign-in. Static site at `https://petpos-demo.prismcortex.net`.
  - **Hosted mode (Phase 1f, on hold):** API Gateway HTTP API + Lambda (Node.js 24) running the same handlers against RDS Postgres.
- Handlers are plain functions `(ctx, input)` in `services/api/src/handlers`, sharing a data layer in `packages/core`. `ctx` carries business id, staff id and role.
- Database: Postgres (PGlite in demo and tests, RDS in hosted). Migrations live in `packages/db/migrations`. Kysely for queries, no ORM.
- Auth (hosted): Cognito user pool with groups `owner`, `manager`, `cashier`, `groomer` and a `business_id` claim. Customers sign in with a one-time code.
- Payments: Square Terminal API (server-driven, Square Terminal device) at the counter, Square Payment Links (Checkout API) for booking deposits, Square webhooks into Lambda (verify the signature). Square Reader does not work from a web app; don't use it. Test in the Square Sandbox. Each business connects its own Square account via OAuth.
- Background work: EventBridge Scheduler (reminders), SQS (Astro sends, webhooks).
- Infrastructure: AWS CDK in TypeScript, region `us-east-1`. Stacks: `DemoSite` (S3 + CloudFront + Route 53 record), later `PetPos-dev` and `PetPos-prod`. Never deploy to `prod` unless asked.
- DNS: the `prismcortex.net` hosted zone already serves the PrismCortex website. Only add records; never change or delete existing ones. Clients will live at `<client>.pos.prismcortex.net`.
- Node 24 LTS locally. npm workspaces, Vitest.

## Rules

- Several businesses share one database: every table has `business_id`, and row-level security limits every query to `current_setting('app.business_id')`. Never query without it set.
- Money is always integer cents. Never use floats for money.
- Never store card numbers or card data. Square holds them; we store Square ids and amounts.
- Phone numbers are stored normalized to 10 digits; format only for display. Customers match on phone, then email.
- Appointments use a Postgres exclusion constraint on `(staff_id, tstzrange(starts_at, ends_at + buffer))` so a groomer can't be double-booked.
- Every refund, void, price change and customer delete writes to `audit_log`. A customer-delete entry keeps id, name and counts only, no contact details.
- Destructive actions (delete customer, remove demo data) need a typed "delete" confirmation in the UI.
- Sample data is marked "(DEMO)" in names and has `is_demo = true`; the remove-demo-data action deletes only those rows.
- Astro: all calls go through `AstroClient` in `packages/core/astro`. Until credentials exist, sales with Astro activity go to the `astro_queue` table for manual entry. Credentials live in Secrets Manager only. Astro is an optional module per business.
- Secrets never go in code, the browser bundle or the repo. The demo build contains no secrets at all.

## Working style

- One feature per session. Plan first (files, tables, endpoints), wait for approval, then build with tests.
- Write tests for money math, tax, Astro punch logic, booking overlap, import matching and separation between businesses.
- Keep UI copy plain and specific, as in the prototype.

## Commands

(fill in once the repo is scaffolded in session 1a)
- `npm run dev` — web app in demo mode
- `npm test` — unit and database tests
- `npx cdk deploy DemoSite` — deploy the demo site
