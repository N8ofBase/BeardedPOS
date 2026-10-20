# Phase 2 plan: register and checkout

Status: **2a and 2b done 2026-10-19, 2c done 2026-10-20.** 2d not started.

**2a built differently from this plan:**
- **Manager approval:** a manager picks their name on the tablet (demo), and `startCheckout` checks that the approver is an active owner or manager. A manager ringing the sale approves it themselves. There's no separate `approveDiscount` handler; hosted mode adds a PIN.
- **Ticket discounts are spread by the largest remainder method,** not "last cent to the largest line". It's the fair way to spread leftover cents.
- **Camera:**
  - Chrome on Windows has a built-in `BarcodeDetector` that can't decode. A `FallbackDetector` switches to the bundled ZXing reader the first time the built-in one says it can't.
  - `zxing-wasm` is pinned to the exact version `barcode-detector` was built with (3.1.3), and a test enforces it. A mismatch fails with "Barcode detection service unavailable".
  - Checked in the browser by decoding a generated UPC-A image through the app's own scanner code. A real phone camera is still to be tried on the live site.

Spec scope (Phase checklist): POS checkout, Square Terminal, cash drawer, receipts, refunds, Astro queue, end-of-day report. The order-history import also moved here from 1d. Spec sections: Screens → POS (register), Astro Loyalty → "Now: tracked locally", Data model (sales, sale_lines, payments, astro_queue). Prototype: the Register and Sales tabs (`calc()`, `checkout()`, `receipt()`).

**Demo mode, with a simulated card reader.** A real Square Terminal needs a server holding the store's Square access token: the browser must never see it. So the card step goes through a small `PaymentTerminal` interface. The demo version is a **Simulated Square Terminal** panel, where the person giving the demo taps **Approve**, **Decline** or **Customer canceled**. The real version comes with hosted mode (1f) and replaces only that adapter. Sales, payments, stock and Astro work the same either way.

## Sessions

| Session | Delivers |
| --- | --- |
| **2a. Register and checkout** (detailed below) | Ticket, scanning, customer lookup and quick add, Astro punches, offers and rewards, tax, cash with change, simulated card, split payment, on-screen receipt, today's sales list, **camera barcode scanning** on the register and in Inventory (count, receive, product form), **store discounts** (cash, employee, and so on) set up in Settings and applied with one tap or a code |
| 2b. Refunds, receipts and the Astro queue | Sales history and receipt reprint; print receipt; email or text receipt as a preview (sending comes with hosted mode); refund and void with manager approval above a set amount, all audited; the Astro screen's "To enter in Astro" queue with **Mark entered** |
| 2c. End of day and order history | Drawer count with card total, cash total and over/short; import past orders (one row per item, grouped by receipt number or date); customer order history and "usually buys" from imported plus new sales |
| 2d. Real Square (with or after 1f) | Square OAuth per business, Terminal API device pairing, checkouts and webhooks into Lambda, Square Sandbox testing |

Each session plans its own files before building, as CLAUDE.md says.

---

## Session 2a: register and checkout

When it's done, a cashier can:
- **Build a ticket:** scan or tap products, find or quick-add the customer by phone, and see their pets, birthday tag, punch cards and "usually buys".
- **Use Astro:** tick Astro offers, and redeem a reward when a card is full.
- **Take payment:** cash (with change due), card through the simulated Square Terminal, or split between the two.
- **Finish the sale:** see the receipt on screen. Stock goes down, punches are added or used, and sales with Astro activity land in the Astro queue for 2b.

### Money and tax rules (packages/core/sale.ts)

The register and the server use the same `priceSale()` function. The screen uses it to show totals as you go. The server reruns it with current prices at checkout and never trusts the browser's numbers.

- **Line total** = unit price × quantity − the line's discounts, all in integer cents.
- **Order of discounts** (each step works on what's left after the one before):
  1. item discounts: store item discounts and Astro offers
  2. the Astro reward (the free item)
  3. whole-ticket store discounts. A percent comes off what's left, so a 20% employee discount never also discounts money already taken off. A percent result is rounded half up to the cent, and a fixed amount is capped at what's left.
- **Store discounts lower the taxable amount,** the way most states treat discounts the store pays for. Where an item is tax-exempt, a whole-ticket discount is spread across lines in proportion to their totals, with the last cent going to the largest line, so the taxable part is exact.
- **Astro offer:** one per line, when the product has one and the cashier ticks it. It's capped at the line total.
- **Astro reward:** one per full card per sale, as in the prototype. It takes off the price of the **cheapest** qualifying item in the ticket, and requires an attached customer whose balance is at least the program's buy count.
- **Punches earned:** one per qualifying item. The free item doesn't earn credit, as in the prototype.
- **Sales tax:**
  - Only `standard` products are taxed; `exempt` products aren't.
  - Rate is `tax_rate_mpct` (thousandths of a percent): `tax = round_half_up(taxable_cents × mpct / 100000)`, **rounded once per sale**, never per line. The math stays in exact integers (an amount × 100000 is far below 2^53).
- **Before or after tax:** the spec leaves open whether Astro discounts apply before or after tax, "as a setting". New setting `astro_discounts_before_tax`, default **before**, as in the prototype; Settings gets a switch.
  - **Before:** discounts reduce the taxable amount.
  - **After:** tax is worked out on the undiscounted taxable amount.
- **Change due** = cash tendered − cash portion due. Tendering less than the cash portion is refused.
- **Selling below zero stock is allowed,** as at a real counter, and the line shows "Only 2 on hand". Stock goes negative and shows as Out in Inventory.

### Database: migration 011_sales

| Table | Fields | Notes |
| --- | --- | --- |
| `sales` | location_id, customer_id, staff_id, receipt_number, status (open, paid, canceled), source (register, import), subtotal_cents, discount_cents, tax_cents, total_cents, tax_rate_mpct and discounts_before_tax (both copied at checkout), paid_at, canceled_at, is_demo | Receipt numbers count up per business from 1001 (`business_counters`). Deleting a customer clears `customer_id` and keeps the sale, as the delete warning already says. |
| `sale_lines` | sale_id, product_id, appointment_id (Phase 3), name, sku, barcode, tax_class (copied at checkout), qty, unit_price_cents, discount_cents, discount_label, line_total_cents, astro_program_id, earns_punches | The app can't change or delete lines once written: the sale is the record |
| `payments` | sale_id, method (card, cash), provider (square, cash), provider_ref, status (pending, completed, declined, canceled, refunded), amount_cents, tendered_cents, change_cents, refunded_cents, staff_id, completed_at | **No card data,** just the Square reference and amounts (CLAUDE.md rule). The demo's references start with `sim_`. |
| `astro_queue` | sale_id, payload (jsonb), status (pending, entered, sent, failed), attempts, error, entered_by, entered_at | One row per sale with Astro activity (spec Astro step 3) |
| `business_counters` | business_id, name, value | Receipt numbers; incremented under a row lock |
| `businesses.astro_discounts_before_tax` | boolean, default true | The open question from the spec, as a setting |

Every table gets business_id, forced row-level security, `(business_id, id)` foreign keys and is_demo, following Phase 1.

### Handlers (services/api/src/handlers/register.ts, sales.ts; payments/terminal.ts)

| Handler | Who | What |
| --- | --- | --- |
| `registerCustomer {id}` | register.use | Customer card plus "usually buys": top 3 products from this customer's paid sales. Imported history joins in 2c. |
| `startCheckout {ticket}` | register.use | Reprices the ticket with current prices and creates an **open** sale with lines and a receipt number. Checks each offer, reward and quantity, and returns the totals. |
| `payCash {saleId, amountCents, tenderedCents}` | register.use | Completed cash payment with change. Finishes the sale when fully paid. |
| `startCardPayment {saleId, amountCents}` | register.use | A pending payment through `PaymentTerminal.charge()`. The demo's `SimulatedTerminal` returns a `sim_…` reference. |
| `simulateTerminalResult {paymentId, outcome}` | register.use, **demo only** | Stands in for Square's webhook: approved, declined or canceled. Approved and fully paid finishes the sale. Hosted mode removes it in favor of the real webhook. |
| `cancelSale {saleId, reason}` | register.use | Open sales only. Completed payments are handed back (cash returned, card refunded through the terminal) and marked refunded. Writes `audit_log` `sale.void` (CLAUDE.md: every void is audited). |
| `getSale {id}` | register.use | Receipt data |
| `listSales {date}` | sales.view (owner, manager) | The day's sales plus totals by payment type, as in the prototype's Sales tab |

**Finishing a sale** happens in the same transaction as the payment that completes it. It runs once, guarded by the open status, so a double tap can't finish twice. It:
1. writes `sale` stock moves (negative, linked to the sale)
2. adds `earn` and `redeem` punches for the customer
3. writes one `astro_queue` row when the sale has Astro activity: customer name, phone and Astro id, items with UPC/SKU, quantity and price, punches earned, rewards and offers redeemed
4. marks the sale paid

`packages/core/astro/AstroClient.ts` gets its stub now (CLAUDE.md rule). Its `send()` does nothing until credentials exist, and queue rows stay `pending`.

### Screens

- **Register** (`/register`), the prototype's layout, full width and touch-first:
  - **Left:**
    - The scan field is always focused. A scanner types into it plus Enter. A unique match is added; several matches show "Several matches. Tap one."
    - Category tabs, and a product grid with price, stock tag and Astro tags.
  - **Right, the ticket:**
    - Customer box: phone or name lookup, results with "2 rewards ready", and quick add when no one matches ("No customer with (212) 555-0199. Add them:"). Once attached it shows pets, birthday tags, "Usually buys" buttons and **Change**.
    - Lines with − / + and remove; offer tickboxes; "Only 2 on hand" warnings.
    - The Astro box: each program's balance and what this sale adds (11/12 → 12/12), a **Redeem** tick when a card is full, and "Attach a customer so it counts" when there's none.
    - Totals: subtotal, each discount, tax at its rate, total.
    - **Card**, **Cash** and **Split** buttons, plus **Clear ticket**.
- **Cash panel:** the amount due, buttons for exact and for the next bill up ($20, $50, $100), a tendered field, "Change due $5.01", and **Complete sale**.
- **Simulated Square Terminal panel:** "Square Terminal (simulated) · $64.99 · Waiting for the customer to tap, insert or swipe", with **Approve**, **Decline** and **Customer canceled**, clearly marked *Demo only*.
  - A decline gets "Card declined. Try another card or take cash." and the sale stays open.
- **Split:** pay a cash amount first, then the rest by card (or the other way round). The ticket shows paid and remaining.
- **Receipt:** shown after payment, in the prototype's monospaced format (store name, date, receipt number, lines, discounts, tax, total, payment, change, and Astro credit earned), with **New sale** and **Print**.
- **Cancel sale:** when an open sale has a payment, "Cancel sale" warns what will be handed back.
- **Saved ticket:** the ticket in progress is kept in this browser, so a reload doesn't lose it.
- **Sales** (`/sales`): today's KPIs (sales, total, card, cash, Astro discounts) and a list of sales with time, receipt number, customer, items, payment and total. Reprint, refunds and other days come in 2b.
- **Settings:** an "Astro discounts apply" switch, before tax or after tax, owner only.

### Store discounts (added while 2a was in review)

The owner runs several discounts (cash, employee and others) and today cashiers type a separate code for each. These become a list in Settings that cashiers apply with one tap, or by typing the same short code they use now.

**Settings → Discounts** (owner and manager create and edit; cashiers only apply)

| Field | Notes |
| --- | --- |
| Name | As shown on the ticket and the receipt: "Employee discount" |
| Code | Optional and unique per store, ignoring case. Typed into the register's scan field + Enter applies it ("EMP"). |
| Kind and amount | **Percent**, stored in whole thousandths of a percent like tax (20% = 20000), or **fixed amount** in cents |
| Applies to | **Whole ticket**, or **one item** (the cashier picks the line) |
| Only when paying cash | For a cash discount. Tapping **Cash** offers to apply it; switching to card, or splitting, takes it off. |
| Needs manager approval | A manager or owner confirms on the tablet before it applies. In the demo, they pick their (DEMO) login; with hosted sign-in it becomes a PIN. |
| Ask for a note | For example which employee. The note goes on the sale. |
| Can combine | Off by default: one whole-ticket discount per sale. Turn it on for one that may stack with another. Item discounts and Astro offers always combine. |
| Active | Off hides it from the register without deleting it |

**Deleting:** a discount never used on a sale is deleted for real. One on past sales is archived instead, so it's hidden from the register and Settings, but past receipts still show its name. Both ask for a second tap.

**The demo seed adds four examples,** marked (DEMO), until the owner's real list is in:

| Name | Code | Amount | Applies to | Rules |
| --- | --- | --- | --- | --- |
| Cash discount (DEMO) | CASH | 3% | Whole ticket | Only when paying cash |
| Employee discount (DEMO) | EMP | 20% | Whole ticket | Ask for a note (employee name) |
| Senior Tuesday (DEMO) | SR10 | 10% | Whole ticket | — |
| Damaged bag (DEMO) | DMG | $5.00 | One item | Needs manager approval |

"Remove all demo data" removes these too.

**Database (part of migration 011):**
- `discounts`: name, code, kind (percent, fixed), percent_mpct, amount_cents, scope (ticket, line), cash_only, needs_approval, ask_note, combinable, active, archived_at, is_demo. Code is unique per business, ignoring case.
- `sale_discounts`: what was applied on each sale.
  - sale_id, sale_line_id (item discounts), discount_id
  - name, kind and value, copied at checkout
  - amount_cents, note, applied_by, approved_by
  - The app can't change these rows once written, like sale lines.

**Handlers:**
- `listDiscounts` (register.use: the active list for the register; Settings also sees archived)
- `saveDiscount`, `deleteDiscount` (owner and manager). `deleteDiscount` deletes or archives, as above.
- `approveDiscount {discountId, managerStaffId}`: checks the approver's role and returns an approval token that `startCheckout` accepts. Demo mode only; hosted mode uses a PIN.
- `startCheckout` checks every applied discount on the server:
  - the discount is active
  - cash-only discounts are refused unless the sale is paid fully in cash: `payCash` and `startCardPayment` look at the sale's discounts, so a card payment on a cash-only sale is refused with "Remove the cash discount to pay by card"
  - approval is present when the discount needs it
  - a note is present when it asks for one
  - no stacking of non-combinable ticket discounts
- **Audit:** every discount on a sale is saved with who applied it and who approved it. Discount setup changes (create, edit, delete) write `audit_log` `discount.change`, since they change prices customers pay.

**Register:**
- A **Discounts** button on the ticket opens the active discounts as big buttons.
- Typing a code in the scan field applies it, with "No discount with code XYZ" when it doesn't exist.
- Applied discounts show under the subtotal with an × to remove them: "Employee discount · Sam −$8.40".
- Item discounts show under their line.

**Settings:** a Discounts section with the table, **New discount**, Edit in a slide-over, and Delete.

**A note for the owner (not legal advice):** cash *discounts* are allowed everywhere. Charging card customers *extra* (a surcharge) is limited in some states and by card-network rules. This builds a straight discount for cash.

### Camera barcode scanning (added while 2a was in review)

Phones and tablets scan barcodes with their camera, as a second way in beside a USB or Bluetooth scanner. A hardware scanner is still faster at the counter. The camera is for walking the shelves.

- **One shared `CameraScanner` component** (`apps/web/src/ui/CameraScanner.tsx`):
  - It opens the rear camera in a panel with a guide box, a torch toggle where the phone supports it, and **Done**.
  - It reads UPC-A, UPC-E, EAN-13, EAN-8 and Code 128.
  - Each read gives a short beep and a vibration (where supported). The same code isn't read twice within 1.5 seconds, so holding a bag still doesn't add it five times.
  - It's either continuous (count mode) or one read and close (product form, register).
- **Library:**
  - The browser's built-in `BarcodeDetector` where it exists (Chrome and Edge on Android).
  - Otherwise the `barcode-detector` stand-in, 3.2.2: ZXing compiled to WebAssembly, for iPhone and iPad Safari and desktop. It's pinned to an August 2026 release.
  - **The WebAssembly file is bundled with the app,** not fetched from the library's default CDN. Scanning works offline, and the demo still calls nothing except Google Fonts.
  - The scanner code loads only when the camera button is tapped, so the register doesn't get heavier.
- **Privacy:** frames are read on the device and never stored or uploaded. The browser asks for camera permission once. If permission is refused, the panel says how to turn it back on, and typing or a hardware scanner still works.
- **Where it shows up:**
  - **Count stock:** a **Scan with camera** button that keeps scanning. Each read adds the item, or moves it to the top, and focuses its count box, as the scan field does now.
  - **Receive:** a camera button above the Inventory list finds the product and opens its Receive box.
  - **New / edit product:** a camera button beside the Barcode field fills it in. A scanned code that matches no product (from count, receive or the register) offers **New product** with that barcode filled in, for owners and managers.
  - **Register:** a camera button beside the scan field adds the item to the ticket. A code that matches nothing gets "No product with barcode 0123…".
- **Barcode format:** codes are matched as scanned against the `barcode` field, and also with or without the leading 0 for a UPC-A read as EAN-13 (`012345678905` and `0012345678905`), so either way of storing it works.
- **Not included:** looking up product names from a UPC database. That needs an outside paid service; the distributor price-list import already brings names and barcodes in.

### Demo seed

No sample sales. Sales should start empty, so the demo's own transactions show up clearly. The seed already has the sample customer one punch away from a reward, so the first dog-food sale fills the card and the next one can redeem it.

### Tests

- **core priceSale:**
  - subtotal, line discounts, an offer capped at the line total
  - the reward takes the cheapest qualifying item, and the free item doesn't earn
  - exempt lines aren't taxed
  - before-tax and after-tax modes
  - tax rounding: half up, once per sale, with cases like 8.875% on $0.01, $9.99 and $1,234.56, and 7% on $0.50 (= 4¢)
  - no floats
  - change due
- **api checkout:**
  - startCheckout reprices with current prices
  - a reward is refused without a full card or a customer; an offer is refused on a product without one
  - cash: exact, over (with change) and under (refused)
  - card: approve, decline and cancel
  - split: cash then card
  - paying more than what's left is refused
  - finishing: on hand drops, punches earned and redeemed, a queue row with the right payload, and no queue row when there's no Astro activity
  - a double finish is a no-op
  - receipt numbers run 1001, 1002… per business
  - cancel hands payments back and is audited
  - a groomer can't ring sales
  - sales are separated by business
  - deleting a customer keeps their sales
- **web:**
  - the ticket totals update as lines change
  - the scan field adds by SKU and barcode
  - the cash panel shows change
  - the simulated terminal's buttons drive the outcome
- **discounts:**
  - percent and fixed, on the ticket and on one item
  - the order of operations: item discounts, then the reward, then the ticket percent on what's left
  - percent rounding half up
  - a fixed amount capped at what's left
  - a ticket discount spread across taxable and exempt lines, with exact cents
  - a cash-only discount refused with card or split and accepted with cash
  - approval required, and refused when the approver is a cashier
  - a note required
  - two non-combinable ticket discounts refused; combinable ones allowed
  - a code typed in any case
  - archive when used, real delete when not
  - setup changes audited
  - sale_discounts rows written with who applied and who approved
  - a cashier can't create discounts
  - separation between businesses
- **camera:**
  - the duplicate-read window (same code within 1.5 s is ignored, a different code isn't)
  - UPC-A / EAN-13 leading-zero matching in `findByCode`
  - an unknown code offers New product with the barcode filled in
  - a refused camera permission shows the help message
  - the scanner module isn't loaded until the button is tapped
- **By hand on a real phone:** the camera itself can't run in the test browser, so before deploying I'll check the decoding with an image of a real UPC fed through the same code. Your phone is the final check, on the live site.

### Out of scope for 2a

Refunds after payment, sales history, emailed receipts (2b); drawer count and order-history import (2c); real Square (2d); grooming services on the ticket (Phase 3); manual price overrides and discounts (not in the spec; if wanted later, every override would be audited as a price change).
