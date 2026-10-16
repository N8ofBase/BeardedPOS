# Pet store POS & grooming system

Point of sale, inventory, customers and pets, grooming calendar and online booking, and Astro Loyalty tracking for one independent pet store (built so a second location can be added later).

- Full spec: `docs/SPEC.md` (export of the "Pet Store POS & Grooming System Spec" doc). Read the section for the feature you are working on before writing code.
- Working prototype: `docs/prototype.html`. It is the reference for screens, wording and behavior. Match its flows; do not copy its code structure (it is a single-file demo).

## Stack

- Front end: React + TypeScript (Vite), one app with staff routes and public booking routes. PWA for the counter tablet.
- API: API Gateway HTTP API + Lambda (Node.js 20, TypeScript). One Lambda per area (sales, inventory, customers, grooming, booking, import) sharing a data layer in `packages/core`.
- Database: RDS Postgres in private subnets. Migrations live in `packages/db/migrations` and run on deploy.
- Auth: Cognito user pool with groups `owner`, `manager`, `cashier`, `groomer`. Customers sign in with a one-time code.
- Payments: Stripe Terminal (server-driven) at the counter, Stripe Checkout for booking deposits, webhooks into Lambda.
- Background work: EventBridge Scheduler (reminders), SQS (Astro sends, webhooks).
- Infrastructure: AWS CDK in TypeScript, stacks `dev` and `prod`. Never deploy to `prod` unless asked.

## Rules

- Money is always integer cents. Never use floats for money.
- Never store card numbers or card data. Stripe holds them; we store Stripe ids and amounts.
- Phone numbers are stored normalized to 10 digits; format only for display. Customers match on phone, then email.
- Appointments use a Postgres exclusion constraint on `(staff_id, tstzrange(starts_at, ends_at + buffer))` so a groomer can't be double-booked.
- Every refund, void, price change and customer delete writes to `audit_log`.
- Destructive actions (delete customer, remove demo data) need a typed "delete" confirmation in the UI.
- Sample data is marked "(DEMO)" in names and uses ids starting `demo-`; the remove-demo-data action deletes only those.
- Astro: all calls go through `AstroClient` in `packages/core/astro`. Until credentials exist, sales with Astro activity go to the `astro_queue` table for manual entry. Credentials live in Secrets Manager only.
- Secrets never go in code, the browser bundle or the repo.

## Working style

- One feature per session. Plan first (files, tables, endpoints), wait for approval, then build with tests.
- Write tests for money math, tax, Astro punch logic, booking overlap and import matching.
- Keep UI copy plain and specific, as in the prototype.

## Commands

(fill in once the repo is scaffolded)
- `npm run dev` — local web app
- `npm test` — unit tests
- `npx cdk deploy PetPos-dev` — deploy dev stack
