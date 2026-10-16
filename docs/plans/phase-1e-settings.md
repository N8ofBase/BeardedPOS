# Session 1e plan: demo data and settings

Status: **done 2026-10-16.** Built as planned. Phase 1 is complete.

Original plan: Part of `docs/plans/phase-1-foundation.md`. This is the last Phase 1 session.

Spec: Screens ("Use the store's own name, logo and colors"), Before go-live ("Seed staging with records marked (DEMO)… with a one-step 'remove demo data' that deletes only those"). Prototype: the Settings tab (store name, tax rate, the Demo data panel and its wording).

When it's done, the owner can:
- **Rename the store,** pick its brand color, upload a logo, and set the sales tax rate. The logo and color show in the sidebar.
- **Manage staff:** add staff, change a role, and deactivate someone.
- **Clear out the sample records** with **Remove all demo data** (typed "delete"). Their own records stay, and the samples don't come back.

Managers can see Settings (as now) but can't change it. Cashiers and groomers don't see Settings.

## One change to the data: sales tax needs three decimals

Sales tax is stored in basis points today (8.25% = 825). Real US rates often have three decimals: New York City is 8.875%, and parts of Washington are 10.25% or 9.525%. Basis points can't hold 8.875% as a whole number, and money math must stay in whole numbers.

**Migration 010** replaces `locations.tax_rate_bp` with `tax_rate_mpct`, in thousandths of a percent (8.875% = 8875, 7% = 7000). Existing rows are converted (×10) and the old column is dropped. Tax math in Phase 2 multiplies cents by this whole number and rounds once.

Also in migration 010:
- `businesses.logo_data`: the logo as a small image (data URL, resized in the browser to at most 256 px, under 200 KB). In hosted mode (1f) logos move to S3 and `logo_key` is used instead. The demo has no file storage, so this keeps it free.

## Rules in packages/core

- `tax.ts`
  - `parseTaxPercent("8.875")` = 8875, `"7"` = 7000, `"8.25%"` = 8250
  - Refuses negative values, anything over 100, and more than three decimals
  - String-based, with no floats
  - `formatTaxPercent(8875)` = "8.875%"
  - `formatTaxRate` moves here from `Settings.tsx`
- `color.ts`: `isHexColor`, plus `readableOn(hex)`, which picks white or dark text so a brand color never makes the store name unreadable

## Handlers (services/api/src/handlers/settings.ts, staff.ts)

| Handler | Who | What |
| --- | --- | --- |
| `getSettings` | settings.view (owner, manager) | Store name, brand color, logo, location name, tax rate |
| `updateSettings {name, brandColor, logo, locationName, taxPercent}` | settings.edit (owner) | Validates each field. A tax-rate change writes `audit_log` (`settings.tax_rate`), since it changes prices customers pay. |
| `listStaff` | staff.view | Unchanged, plus email |
| `addStaff {name, email, role}` | staff.manage (owner) | Duplicate email gets "Someone on staff already uses that email." |
| `updateStaff {id, name, email, role, active}` | staff.manage (owner) | Refuses demoting or deactivating the **last active owner** ("The store needs at least one active owner"), and deactivating **yourself** |
| `demoDataPreview` | demo.remove (owner) | Counts of sample customers, pets, products, programs and punch balances |
| `removeDemoData` | demo.remove (owner) | Deletes `is_demo` rows only: customers (their pets, vaccinations and punches go with them), products (their stock history goes with them), and programs. Each sample customer writes `customer.delete` to the audit log, and one `demo.remove` row has the totals. Records the user created are never touched: a product the user added that was linked to a sample program just loses the link. |

`me` returns the logo, and the role picker lists every active staff member of the demo store, not only the (DEMO) ones, so newly added staff can sign in to the demo too.

### What "Remove all demo data" keeps in demo mode

In demo mode, the four "(DEMO)" logins are how people sign in, and the sample store itself is the store. So removal **keeps the store, its location and the (DEMO) logins**, and the confirmation says so. In hosted mode (1f), sign-in is real and those rows won't exist.

The sample sets are already recorded in `demo_seed_parts`, so they don't load again. **Reset demo** (wipe this device) still brings everything back.

## Screens (Settings, owner)

- **Store:** name, brand color (color picker with a preview of the sidebar header), logo (upload, preview, remove), location name, sales tax %. One Save button. The toast says "Settings saved".
- **Staff**
  - A table with name, email, role, status, and an Edit button that opens a slide-over with name, email, role and Active.
  - **Add staff** uses the same slide-over.
  - A note says that in the demo, new staff appear on the "Who's using the register?" screen, and that in the hosted version they get a sign-in invite.
- **Bulk import:** the link added in 1d.
- **Demo data,** with the prototype's wording: "Sample records are marked (DEMO). Remove them all before the store starts using the register for real. Records you added yourself are kept."
  - "N demo records", or "No demo records left"
  - **Remove all demo data** opens the typed-"delete" panel: "Deletes every record marked (DEMO): 3 customers (5 pets), 4 products, 1 Astro program and 2 punch balances. Your own records stay. The (DEMO) sign-ins stay so you can still get in."
- **Sidebar:** the logo (or the store's initial) on a brand-color header, with readable text.

## Tests

- **core:**
  - tax: 8.875 to 8875 and back; 7, 0 and 100; refuses -1, 100.001, 8.8755 and "abc"; percent sign; no floats
  - readable text color for light and dark brand colors
- **db:** migration 010 converts an existing 7% (700 bp) to 7000
- **api:**
  - updateSettings validates, and a tax change is audited
  - a manager can read settings but not change them
  - a cashier can't read them
  - logo size and type limits
  - staff: add, duplicate email, role change, the last-owner rule, and the can't-deactivate-yourself rule
  - removeDemoData deletes exactly the demo rows and keeps a user-added customer, product and program, plus a user's punches on their own program
  - removed samples don't return on the next ensureDemo
  - the (DEMO) logins still work
  - the audit rows are written
  - only the owner can remove
  - business separation (removing one store's demo data leaves another store alone)
- **web:**
  - tax field validation message
  - the Remove button is disabled when there are no demo records
  - staff Edit hides deactivate for yourself

## Out of scope

Real sign-in and staff invites (1f, Cognito); receipt or email branding (Phase 2); several locations per business (later).
