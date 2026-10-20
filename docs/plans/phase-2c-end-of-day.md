# Session 2c plan: end of day and order history

Status: **done 2026-10-20.** Part of `docs/plans/phase-2-register.md`.

**Built differently from this plan:**
- **Duplicate check without a receipt number:** an order is "already imported" when an earlier import has one for the same customer on the same date. Comparing the lines as well wasn't needed: two separate old-system orders by one customer on one day, with no numbers, can't be told apart anyway.
- **Import counts:** for past orders, New counts orders and Updated counts extra items added to an order in the same file.
- **Cash taken** counts completed cash payments by when they were taken, so cash on a sale left open still counts. That's money in the drawer.
- **Shared totals:** `services/api/src/handlers/totals.ts` (`moneyTotals`) feeds both the Sales page KPIs and end of day. The Sales KPIs now cover the whole day even while you search.
- **Undo:** the app can't delete sales, so undoing an order import goes through `delete_imported_sale()`, which deletes only imported orders in the current business.
- **Also fixed:** the punch balance import now counts punches taken back or returned by refunds (from 2b).

Spec:
- POS: "End of day: drawer count, card total, cash total, over/short".
- Customers: "full order history (imported and new) with total spent, first and last visit, and most-bought items".
- Import: "Past orders import into `sales` and `sale_lines` with `source = 'import'`, one row per item in the file; rows sharing a customer and receipt number (or a date, when there's no number) become one order. Imported orders carry no payment record and don't change inventory. They feed the customer's order history and the 'usually buys' shortcuts."

The prototype has no end-of-day screen, so the layout below follows the Sales page.

When it's done:
- **Closing the day:** at closing, a manager or the owner counts the drawer and sees the day's card total, cash total and whether the drawer is over or short. They also see how much to deposit and how much to leave for tomorrow. Past counts stay on record.
- **Past orders:** the store's past orders can be imported from the old system's export.
- **Customer profile:** shows full order history (imported and new) with total spent, first and last visit, and most-bought items.
- **Usually buys:** the register's "usually buys" shortcuts use imported history too.

## End of day

**Who:** owners and managers (new permission `drawer.count`). Cashiers can't, following the spec's roles. Like receiving stock, this is a one-line change if the store wants cashiers to close out.

**Expected cash in the drawer** = starting cash + cash taken − cash handed back, for that day.
- **Starting cash:** new owner setting "Starting cash in the drawer", default $100.00. The count screen fills it in, and you can change it for the day.
- **Cash taken:** completed cash payments. `amount_cents` already excludes change, so it's what stayed in the drawer.
- **Cash handed back:** cash refunds made that day (`refund_payments`, method cash), including refunds on older sales.
- **Voids:** cash payments on canceled sales are handed back too, so they're left out.

**Counting:**
- **Screen:** "End of day" at `/sales/close`, with a **Close the day** button on the Sales page.
- **By denomination:** a box for each of $100, $50, $20, $10, $5, $1, quarters, dimes, nickels and pennies, with a running total. Or tick "Just enter the total" and type it.
- **Results:** shown as you type:
  - **Over / short:** counted − expected. "Even", "Over $2.00" or "Short $3.50", in green, amber or red.
  - **Deposit:** counted − starting cash for tomorrow. "Take $412.35 to the bank, leave $100.00 in the drawer."
- **Card total:** card payments taken − card refunds. In the demo this comes from the simulated reader. In hosted mode the same number gets checked against Square's batch report (2d), and the screen says so.
- **Day summary:** sales count, gross sales, discounts, tax collected, refunds and net sales. These are the same numbers as the Sales page KPIs, from shared code, so they can't disagree.

**Saving:**
- **Save count:** writes a `drawer_counts` row. Saved counts can't be changed or deleted.
- **Recount:** counting again the same day adds a new row; the latest one counts, and the earlier ones stay in the history.
- **Audit:** every count writes `audit_log` `drawer.count`, including over/short.
- **Note:** a short shortage needs a note ("Short more than $5.00: add a note"). The $5.00 threshold is fixed for now.
- **History:** "Past counts" on the same screen lists date, who counted, expected, counted, over/short and note.

**Business day:** the store's local calendar day, as on the Sales page. One location for now; the table has `location_id` for later.

## Order-history import

**New import type "Past orders"** in Settings → Bulk import. It uses the same preview, chunked import and undo as the other import types.

**Columns** (flexible headers, with a downloadable template):
- **Order:** date (required), receipt or order number.
- **Customer:** customer phone, customer email, customer name (shown in the preview only).
- **Item:** SKU, barcode, item name, quantity (default 1), unit price, line total.

**How rows become orders:**
- **Customer:** matched on phone, then email, like everywhere else.
  - With no match, the row is skipped: "No customer with this phone or email. Import customers first."
  - Walk-in orders without a customer don't help history, so they're skipped too and counted in the preview.
- **Product:** matched on SKU, then barcode, including UPC-A with or without the leading 0. Unmatched items still import under their name, without a product link. The preview counts them ("12 items didn't match a product; they'll show by name").
- **Grouping:** rows with the same customer and receipt number make one order. With no receipt number, rows with the same customer and date make one order.
- **Money:**
  - The line total comes from the file; if it's missing, it's unit price × quantity.
  - Both are parsed with `parseMoney`, never floats. A row with neither is an error.
  - No tax: old exports rarely split it out reliably, and history only needs what was spent. The order total is the sum of its lines.
- **What it doesn't touch:** no payments, stock or Astro punches (punch balances have their own import).
- **Dates:** a date-only order is stored at noon local time, so it never slips to the day before.
- **Importing again:**
  - An order already imported for that customer with the same receipt number is skipped as "already imported". With no number, the same date and identical lines count as a duplicate.
  - So re-running a file, or a file that overlaps an earlier one, doesn't double the history.
- **Undo:** removes the batch's orders. It's the same typed "delete" confirmation flow as other import undos.

**Receipt numbers:** imported orders keep the old system's number as text (`external_ref`) and get no number from our counter. Our receipts keep counting from 1001 without gaps or clashes.

**Where imported orders show:**
- **They show in:** the customer's order history, total spent, first and last visit, most-bought items and "usually buys".
- **They don't show in:** the Sales page, the KPIs or end of day, since that money was taken in the old system.
- **Refunds:** they can't be refunded here.

## Customer order history

The customer profile replaces the "Order history … once the register is built" note with:
- **Summary:** total spent (net of refunds), number of orders, first visit and last visit.
- **Most bought:** the top 5 items by quantity, imported and new together.
- **Orders:** newest first, 25 at a time with "Show more". Each shows the date, receipt number (ours, or "Imported #A-1043"), items, total and a Refunded tag. Tapping one of our sales opens its receipt, as on the Sales page.

`registerCustomer` ("usually buys" and last visit) already reads paid sales. It's changed to include imported orders, and to skip lines without a product link.

## Database: migration 013_end_of_day

| Table / change | Fields |
| --- | --- |
| `drawer_counts` | location_id, business_date, staff_id, starting_cents, cash_in_cents, cash_out_cents, expected_cents, counted_cents, over_short_cents, card_cents, denominations (jsonb, null when a total was typed), note, created_at. Can't be changed or deleted by the app. |
| `businesses` | + drawer_float_cents (default 10000) |
| `sales` | + external_ref (text), + import_batch_id. receipt_number becomes nullable, with a check that register sales always have one. Unique (business_id, customer_id, external_ref) for imports. |
| `sale_lines` | + import_batch_id (for undo) |
| indexes | sales (business_id, customer_id, created_at) for history |

As always: business_id, forced row-level security and `(business_id, id)` foreign keys.

## Handlers

| Handler | Who | What |
| --- | --- | --- |
| `drawerSummary {day}` | drawer.count | The day's expected cash (with the parts), card total and sales summary, plus starting cash from settings and the day's earlier counts |
| `saveDrawerCount {day, startingCents, denominations \| countedCents, note}` | drawer.count | Recomputes expected on the server, saves, audits, returns over/short and deposit |
| `listDrawerCounts {from, to}` | drawer.count | Past counts |
| `customerHistory {id, before?}` | customers.view | Summary, most bought and a page of orders |
| Import type `orders` | import.run | Through the existing `previewImport` / `importChunk` / `undoImport` |
| Settings | settings.edit | + starting cash |

`listSales` and the KPIs gain `source = 'register'` so imports never mix in.

**Core** (`packages/core/src/drawer.ts`):
- `countTotal(denominations)`, `expectedCash(...)`, `overShortLabel(cents)`, `depositFor(counted, float)`.
- Order grouping for the import in `packages/core/src/import/orders.ts`, which is pure and tested on its own.

## Tests

- **core:**
  - denomination totals; expected cash with sales, cash refunds and voids; over/short labels; deposit
  - order grouping by receipt number, then by date; money parsing; duplicate detection
- **api:**
  - **End of day:** expected cash after cash, card and split sales, a cash refund of an older sale and a void; card total net of card refunds; recount keeps both rows; the shortage note rule; audit row; a cashier refused; separation between businesses.
  - **Import:** customer matching and skipped rows; product matching (including the UPC-A leading 0) and name-only lines; grouping; no stock, payment or punch changes; re-import skips; undo; imported orders kept out of `listSales` but included in history and "usually buys".
  - **Customer history:** totals net of refunds, first and last visit, most bought, paging.
- **web:**
  - the count form's running total, over/short colors and deposit line
  - "Just enter the total"
  - the history list's imported label

## Out of scope

- **Cash drawer hardware:** opening the drawer is part of the receipt-printer work.
- **Several drawers or shifts per day:** one drawer per location per day for now.
- **Emailing the end-of-day report:** comes with hosted mode.
- **Real Square batch totals:** 2d.
