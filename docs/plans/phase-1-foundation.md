# Phase 1 plan: foundation

Status: **approved 2026-10-15.** Build sessions 1a–1e run in order (1b and 1c can run in parallel).

Spec scope (`docs/SPEC.md` → Phase checklist): repo, products, inventory, customers, pets, CSV import, staff roles.

## Goals for this phase

1. **A free demo for the store owner.** The app runs fully in the browser ("demo mode") and is hosted as a static site at `https://petpos-demo.prismcortex.net` for about $0–1 a month. There's no database server, no NAT and no Lambda yet.
2. **Built to host several businesses.** PrismCortex may offer this POS to other local businesses, so every table carries a `business_id` from the first migration, and Postgres row-level security keeps each business to its own rows.
3. **No throwaway code.** Demo mode runs the same migrations, business rules and query code as the hosted version. Only the transport (direct call vs. HTTP) and the sign-in (role picker vs. Cognito) differ.

The full AWS backend ("hosted mode") is session **1f**, held until the owner, or a first paying client, says yes.

## Sessions

| Session | What it delivers | Depends on | AWS cost |
| --- | --- | --- | --- |
| 0. Prototype online | `docs/prototype.html` served at petpos-demo.prismcortex.net | Nothing | ~$0 |
| 1a. Scaffold and demo mode | Repo layout, tooling, demo-mode data layer, role picker, admin shell, CI, static deploy replaces the prototype | 0 | ~$0 |
| 1b. Products and inventory | Product list and editing, receive stock, count mode, Astro programs | 1a | ~$0 |
| 1c. Customers and pets | Customer cards and profile, pet rows, vaccinations, birthday tags, delete with typed confirm | 1a | ~$0 |
| 1d. Bulk import | Upload, column matching, preview, batched import, undo | 1b, 1c | ~$0 |
| 1e. Demo data and settings | (DEMO) seed, "Reset demo" and "Remove all demo data", store settings, staff list | 1b, 1c | ~$0 |
| 1f. Hosted mode (on hold) | Cognito, RDS, Lambdas, NAT instance, `api.pos.prismcortex.net` | 1a–1e plus a go-ahead | ~$25/mo shared by all businesses |

---

## Decisions (approved)

1. **Node 24 LTS** for local work and, later, Lambda. Node 20 reached end of life in April 2026. If Lambda doesn't offer Node 24 when 1f starts, use Node 22.
2. **Demo records:** UUID ids plus an `is_demo` boolean; names end in "(DEMO)". Remove-demo-data deletes only `is_demo = true` rows.
3. **Booking buffer:** the Phase 3 exclusion constraint covers `tstzrange(starts_at, ends_at + buffer)`, as CLAUDE.md and the prototype do. The spec gets corrected when Phase 3 starts.
4. **GitHub Actions:** CI runs tests on every pull request. Merging to `main` deploys the demo site, using an AWS role GitHub signs in to (OIDC, so no AWS keys are stored in GitHub). Prod is deployed by hand only when asked.
5. **Order-history import moves to Phase 2**, with the sales tables.
6. **Customer delete audit entry** records the id, name, and counts of what was removed. No phone, email or address.
7. **Uniqueness per business:** phone and lower(email) are each unique when present. Pet names are unique per customer.
8. **AWS region:** `us-east-1`. The CloudFront certificate has to live there anyway.
9. **Several businesses:** `businesses` table, `business_id` on every table, row-level security keyed on `app.business_id` (set at the start of every transaction). Store name, logo, colors, tax rate and enabled modules (such as Astro) are settings for each business.
10. **Domains:**

    | Use | Address |
    | --- | --- |
    | Owner demo | `petpos-demo.prismcortex.net` |
    | Future clients | `<client>.pos.prismcortex.net` (one wildcard certificate) |
    | Future API | `api.pos.prismcortex.net` |

    Records are only **added** to the existing `prismcortex.net` hosted zone. Existing records are never changed.

---

## How demo mode works

```
Browser
  React app ──calls──▶ api client ──(demo)──▶ Web Worker: handlers ▶ packages/core ▶ Kysely ▶ PGlite (IndexedDB)
                                   └─(hosted, 1f)──▶ HTTPS ▶ API Gateway ▶ Lambda: same handlers ▶ same core ▶ RDS Postgres
```

- Handlers are plain functions `(ctx, input) → result`, where `ctx` holds the business id, staff id and role. A thin adapter wraps them as Lambdas in 1f, and the Web Worker calls them directly in demo mode.
- PGlite is Postgres compiled to WebAssembly. It runs the real migrations, constraints and row-level security, and stores data in IndexedDB on that device.
- Sign-in in demo mode is a picker: "Owner (DEMO)", "Manager (DEMO)", "Cashier (DEMO)", "Groomer (DEMO)". It sets the role in `ctx`, so permission checks behave as they will for real.
- A banner reads "Demo · data stays on this device", with **Reset demo**, which reloads the seed data.
- The demo build includes no secrets and calls nothing except Google Fonts.

---

## Repo layout

```
apps/web/                 React + TypeScript (Vite) app, staff and public routes, PWA
  src/api/                client: demo transport (worker) and http transport (1f)
  src/demo/worker.ts      runs handlers against PGlite in a Web Worker
packages/core/            domain logic shared by every handler
  money/  phone/  auth/   cents parsing and formatting, 10-digit phones, roles and permissions
  customers/ inventory/ import/ astro/   data access and rules per area
  astro/AstroClient.ts    stub only, does nothing until credentials exist
packages/db/
  migrations/             numbered .sql files
  src/migrate.ts          runner (PGlite in browser and tests; RDS in 1f)
  src/test-db.ts          fresh PGlite database per test file
  seed/demo.ts            (DEMO) records
services/api/
  src/handlers/           customers, inventory, import, staff (plain functions)
  src/lambda.ts           1f only: wraps handlers for API Gateway
infra/                    CDK app
  DemoSite stack          S3 + CloudFront + ACM cert + Route 53 record
  PetPos-dev / -prod      1f
.github/workflows/        ci.yml, deploy-demo.yml
```

npm workspaces, Vitest, ESLint and Prettier. Database access uses Kysely, a typed query builder, with PGlite and `pg` dialects. There's no ORM.

---

## Database tables (Phase 1)

Every table gets `id uuid` (default `gen_random_uuid()`), `business_id`, `created_at`, `updated_at` (set by a trigger) and `is_demo`. Tables with data that a second store would split also get `location_id`. All money columns are `integer` cents with `CHECK (>= 0)`. Every table has a row-level security policy `business_id = current_setting('app.business_id')::uuid`.

| Migration | Table | Notes | Constraints |
| --- | --- | --- | --- |
| 001 | `businesses` | name, slug (subdomain), logo_key, brand_color, modules (jsonb, such as `{"astro":true}`) | Unique slug |
| 001 | `locations` | business_id, name, timezone, tax_rate_bp (basis points: 8.25% = 825) | |
| 002 | `staff` | name, email, role, cognito_sub (null in demo), active | Unique per business: lower(email) |
| 003 | `astro_programs` | name, brand, buy_count, reward_text, astro_program_ref | Unique per business: lower(name) |
| 004 | `products` | spec fields plus astro_offer_label, astro_offer_cents | Unique per business: sku, and barcode where not null |
| 004 | `inventory_levels` | product_id, location_id, on_hand, back_bar_on_hand | Updated in the same transaction as each move |
| 004 | `inventory_moves` | qty_change, reason (sale, receive, adjust, consume, return), ref_id, staff_id, note | Append-only (a trigger blocks UPDATE and DELETE) |
| 005 | `customers` | spec fields; phone stored as 10 digits | Unique per business: phone and lower(email), where not null |
| 005 | `pets` | spec fields | Unique (customer_id, lower(name)); delete cascades from customer |
| 005 | `vaccinations` | pet_id, vaccine, expires_on, proof_file_key (empty until Phase 3) | |
| 006 | `astro_punches` | customer_id, program_id, sale_id, qty, kind (earn, redeem, opening_balance) | Balance = sum per customer and program |
| 007 | `audit_log` | staff_id, action, entity, entity_id, before, after (jsonb) | Append-only |
| 008 | `import_batches` | type, file_name, staff_id, counts, status (running, done, undone) | |
| 008 | `import_changes` | batch_id, entity, entity_id, op (created, updated), before (jsonb) | Lets undo restore changed fields |

Tables for later phases (sales, services, appointments, vendors, `astro_queue`, and others) are left out until their phase.

---

## Handlers (become API endpoints in 1f)

Each handler checks permissions with `can(ctx.role, action)` before doing anything.

**staff**
- `me`
- `listStaff`, `inviteStaff` (owner; in demo it only adds the row), `updateStaff`
- `getSettings`, `updateSettings` (owner)

**inventory**
- `listProducts {q, low, category}`
- `findByCode {code}`: barcode or SKU, for scanning
- `createProduct`, `updateProduct`: owner and manager; a price change writes `audit_log`
- `receiveStock {productId, qty}`
- `saveCounts {lines}`: writes `adjust` moves for the difference
- `listMoves`
- `listPrograms`, `createProgram`, `updateProgram`

**customers**
- `searchCustomers {q}`: three or more digits matches phone
- `lookupByPhone`
- `saveCustomer`: customer and pet rows saved together
- `getCustomer`: pets, vaccinations, punch balances
- `deletePreview`, `deleteCustomer`: owner and manager; writes `audit_log`
- `saveVaccinations`

**import** (owner and manager)
- `previewImport {type, rows}`: runs the real import inside a transaction, then rolls it back
- `startImport`, `importChunk` (500 rows), `finishImport`
- `listImports`
- `undoImport`: deletes created rows and restores fields the import changed. A field edited after the import is left alone and listed in the result.

**demo**
- `resetDemo`: wipes everything for this device and reseeds
- `removeDemoData` (owner): deletes only `is_demo` rows

The browser parses .csv and .xlsx with SheetJS, installed from cdn.sheetjs.com because the npm copy is outdated.

---

## AWS now (session 0 and 1a): DemoSite stack, about $0–1 a month

- Private S3 bucket behind CloudFront (origin access control), HTTPS only, with a security-headers policy
- An ACM certificate for `petpos-demo.prismcortex.net`, checked through the existing Route 53 zone
- A Route 53 alias record (A and AAAA) pointing `petpos-demo` at CloudFront. Only this record and the certificate's check record are added.
- AWS Budgets alert at $5 a month to your email
- Session 0 uploads `docs/prototype.html` as `index.html`. Session 1a replaces it with the React demo build.

## AWS later (1f, on hold)

VPC with a t4g.nano NAT instance; RDS Postgres 17 db.t4g.micro (20 GB, 7-day backups, credentials in Secrets Manager); a migration trigger on deploy; Cognito with groups `owner`, `manager`, `cashier` and `groomer` plus a `business_id` claim; an HTTP API with a JWT authorizer; Lambdas on Node 24; and a wildcard certificate for `*.pos.prismcortex.net`. Prod gets deletion protection.

---

## Screens (from the prototype, Shopify-style admin)

- **Role picker** (demo), then the admin shell: left sidebar, page title with one primary action at top right, and a slide-over panel for editing. Register and Grooming show "Coming in Phase 2/3" placeholders.
- **Inventory:** table with SKU, product, Astro, price, margin and on hand (Out / "3 left" / OK tags), plus a low-stock filter. The slide-over uses the prototype's fields. Receive asks for a quantity per row.
- **Count mode** (phone width): scan or type a SKU, type the count, check the difference, save.
- **Customers and pets:** search by name or phone, customer cards (pet chips, birthday tags within 7 days, punch cards), and the customer form with pet rows (name, Dog / Cat / Other, breed or notes, optional birthday). The prototype's duplicate-pet-name message is kept. Delete uses the typed-"delete" panel with the prototype's wording.
- **Customer profile:** contact details, pets, vaccinations with expiry warnings, punch balances.
- **Astro programs:** as on the prototype's Astro tab. The queue comes in Phase 2.
- **Settings:** store name, tax rate, logo and color, staff, bulk import, demo data.

Copy is taken from the prototype wherever it exists.

---

## Tests (Vitest)

- **Money:** `parseMoney("12.3")` = 1230; "$1,234.56"; rejects "1.234" and "abc"; formatting; margin percent; no floats in money paths.
- **Phone:** "(555) 123-4567", "+1 555 123 4567" and "1-555-123-4567" all give `5551234567`; 7 or 12 digits is rejected; display formatting.
- **Import matching:** match on phone, then email; same customer twice in one file gives one record; pets match by name under an owner (case-insensitive); unknown program is skipped with a reason; products match on SKU or barcode; bad price is skipped; header aliases for each type.
- **Import undo:** created rows are removed; changed fields are restored; later edits are kept and reported.
- **Inventory:** on hand equals the sum of moves; a count writes the difference; moves can't be updated or deleted.
- **Permissions and audit:** a cashier can't change a price or delete a customer; every price change and customer delete writes `audit_log`.
- **Separation between businesses:** with business A set, queries never return business B's rows, even when filtering by B's id.
- **Constraints** (PGlite): duplicate phone in one business is refused; the same phone in two businesses is allowed; duplicate pet name per customer is refused.

---

## npm scripts (go into CLAUDE.md → Commands after 1a)

- `npm run dev`: web app in demo mode
- `npm test`: unit and database tests
- `npm run lint`, `npm run typecheck`
- `npm run build:demo`: static demo build
- `npx cdk deploy DemoSite`: deploy the demo site

---

## Deferred out of Phase 1

- Order-history import (Phase 2)
- Vaccination proof upload and pet photos (Phase 3)
- Back-bar consumption per service (Phase 3). Phase 1 stores the count only.
- Customer one-time-code sign-in (Phase 4)
- Purchase-order receiving (Phase 5)
- Hosted mode (1f): until the owner or a first client says yes
