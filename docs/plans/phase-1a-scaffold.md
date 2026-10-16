# Session 1a plan: scaffold and demo mode

Status: **done 2026-10-16.** Part of `docs/plans/phase-1-foundation.md`. Live at https://petpos-demo.prismcortex.net; the prototype is at `/prototype.html`.

**Built differently from this plan:**
- The database runs in a plain dedicated worker (`apps/web/src/demo/db.worker.ts`), and a Web Lock limits the demo to **one tab**. A second tab shows "The register is already open in another tab…". This avoids two tabs writing the same IndexedDB store, and is simpler than PGlite's multi-tab worker.
- `listDemoStaff` lives in `packages/db/seed/demo.ts` and runs as the owner (demo only). It isn't a handler: the role picker needs it before anyone has a role.
- Reset demo is in the web demo runtime (it deletes this browser's database), not a handler.
- First load downloads about 4 MB compressed (PGlite). The service worker then caches it for offline use.

When it's done: `npm run dev` opens the app in demo mode; you pick a role (Owner, Manager, Cashier or Groomer, all (DEMO)) and land in the admin shell with the sidebar; `npm test` passes; and the React demo replaces the prototype at https://petpos-demo.prismcortex.net. The prototype stays in `docs/` as the reference.

Products, customers, import and the rest come in 1b–1e. This session builds the parts they plug into.

## Libraries (current versions)

| Purpose | Library |
| --- | --- |
| UI | React 19.3, React Router 8, TanStack Query 5 |
| Build | Vite 8, @vitejs/plugin-react 6, vite-plugin-pwa 2 |
| Database | PGlite 0.5 (Postgres in WebAssembly), Kysely 0.29 |
| Tests | Vitest 5 |
| Lint and format | ESLint 10, typescript-eslint 8, Prettier 3 |
| Language | TypeScript 6.0.3 (typescript-eslint doesn't support TypeScript 7 yet, so `infra` moves to 6.0.3 too) |

Kysely's community PGlite adapter only supports PGlite up to 0.4, so `packages/db` has its own small adapter (about 50 lines, with tests).

## Two changes from the Phase 1 plan

1. **Where the database runs.** The plan put the handlers in a Web Worker. Instead, the **database** runs in PGlite's own multi-tab worker, and the handlers run on the page. If the owner opens two tabs, they share one database safely; two separate workers writing to the same browser storage can corrupt it. Handlers are still plain `(ctx, input)` functions, so nothing changes for 1f.
2. **How row-level security is enforced.** Postgres lets a superuser skip row-level security, and PGlite runs as a superuser. So every transaction switches to a restricted role first: `SET LOCAL ROLE pos_app`, then `set_config('app.business_id', …, true)`. The same code works on RDS later, and a test proves business A can't see business B's rows.

## Files

```
package.json                     workspaces + scripts (dev, test, lint, typecheck, build:demo, deploy:demo)
tsconfig.base.json               shared strict settings
eslint.config.js, .prettierrc    flat config, typescript-eslint, react-hooks
vitest.workspace.ts              runs every package's tests
.github/workflows/ci.yml         npm ci → lint → typecheck → test → build:demo on every push and PR

packages/core/
  src/money.ts                   parseMoney("12.30") → 1230 (string-based), formatMoney, marginPercent
  src/phone.ts                   normalizePhone → 10 digits or null, formatPhone
  src/auth.ts                    Role type, permission table, can(role, action), assertCan
  src/context.ts                 Ctx { businessId, staffId, role, db }
  src/errors.ts                  AppError (forbidden, not_found, invalid) with plain user-facing messages
  test/money.test.ts, phone.test.ts, auth.test.ts

packages/db/
  migrations/001_businesses.sql  pos_app role, updated_at trigger, businesses, locations, row-level security policies
  migrations/002_staff.sql       staff (role check, unique lower(email) per business, is_demo), row-level security
  src/migrate.ts                 runs pending .sql files in order and records them in schema_migrations
  src/pglite-dialect.ts          Kysely dialect over PGlite (PGlite or PGliteWorker)
  src/schema.ts                  Kysely table types
  src/tx.ts                      withBusiness(db, businessId, fn): transaction + SET LOCAL ROLE + set_config
  seed/demo.ts                   1 business "Sample Pet Store (DEMO)", 1 location, 4 staff (DEMO)
  src/test-db.ts                 fresh in-memory PGlite, migrated, for each test file
  test/migrate.test.ts           migrations apply once; a rerun is a no-op
  test/rls.test.ts               A can't read or update B's rows; without a business set, nothing is visible
  test/constraints.test.ts       duplicate staff email in one business refused; allowed across two businesses

services/api/
  src/handlers/staff.ts          me(ctx), listStaffForPicker(db) (demo only)
  src/handlers/demo.ts           resetDemo
  src/registry.ts                name → handler map (shared by the demo transport and, later, Lambda)
  test/staff.test.ts

apps/web/
  index.html, vite.config.ts     PWA manifest "Pet Store POS", icons, Google Fonts as in the prototype
  src/main.tsx, App.tsx          router, query client
  src/styles/tokens.css          colors, type and spacing from the prototype (light and dark)
  src/api/client.ts              call(name, input); picks the demo transport (hosted comes in 1f)
  src/api/demo-transport.ts      builds Ctx from the picked role; runs the handler inside withBusiness
  src/demo/db.worker.ts          PGlite multi-tab worker, idb://petpos-demo; migrates and seeds on first load
  src/auth/RolePicker.tsx        "Who's using the register?": four role cards
  src/layout/AdminShell.tsx      sidebar (Register, Inventory, Customers, Grooming, Sales, Astro, Settings), page header with one primary action, slide-over slot
  src/layout/DemoBanner.tsx      "Demo · data stays on this device"; Reset demo (typed confirm is not needed: demo data only)
  src/pages/ComingSoon.tsx       "Coming in Phase 2: ringing sales" and similar, per tab
  src/pages/Settings.tsx         store name shown, "Switch role"
  test/RolePicker.test.tsx       picking Cashier hides owner-only nav items

infra/
  bin/app.ts                     siteDir context → apps/web/dist
  package.json                   deploy:demo (build web, then cdk deploy DemoSite); TypeScript 6.0.3
```

## Tables in this session

- `businesses`: id, name, slug (unique), brand_color, logo_key, modules jsonb, is_demo
- `locations`: business_id, name, timezone, tax_rate_bp, is_demo
- `staff`: business_id, name, email, role (owner, manager, cashier, groomer), cognito_sub, active, is_demo

All three have row-level security turned on and forced, with a policy on `business_id` (on `id` for businesses). The other Phase 1 tables come with their sessions.

## Handlers in this session

`me`, `listStaffForPicker` (demo only; reads the four seeded staff), `resetDemo`. Each one checks `can()` first.

## Tests

- **Money:** "12.3" = 1230; "$1,234.56" = 123456; "0.1" + "0.2" = 30 exactly; "1.234", "abc", "-1" and "" are rejected; formatting and margin percent.
- **Phone:** "(555) 123-4567", "+1 555 123 4567", "1-555-123-4567" and "555.123.4567" all give 5551234567; 7 digits, 12 digits, and 11 digits not starting with 1 are rejected; display formatting.
- **Permissions:** each role against the permission table, and owner-only items are hidden from a cashier.
- **Separation between businesses:** reading, updating and inserting across businesses is refused; nothing is visible with no business set.
- **Migrations:** they apply in order, and a rerun does nothing.

## Deploy and CI

- `ci.yml` runs on GitHub's free minutes and needs no AWS access.
- `npm run deploy:demo` builds the web app and deploys DemoSite. I'll run it after the tests pass; you've already approved deploying that stack.
- **Not in this session:** automatic deploys on merge. They need a new IAM role in your account that GitHub can sign in to. That's a security-sensitive change, so it gets its own small step with its own approval, whenever you want it.

## Out of scope

Products, inventory, customers, pets, import, real settings editing, and anything AWS beyond DemoSite.
