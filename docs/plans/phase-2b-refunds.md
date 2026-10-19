# Session 2b plan: refunds, receipts and the Astro queue

Status: **done 2026-10-19** (approved and built as written). Part of `docs/plans/phase-2-register.md`.

Spec:
- Roles: Owner can do refunds; Manager "refunds up to a limit"; Cashier isn't listed.
- POS: "Refund and void, manager approval above a set amount, every one written to the audit log"; "Receipt by email or text".
- Astro: "Staff enter each one in the Astro retailer portal, then tap Mark entered"; after 5 failed sends a row goes to `failed`.

Prototype: the Astro tab's "To enter in Astro" queue.

When it's done:
- **Sales history:** owners and managers find any past sale by date, receipt number or customer.
- **Receipts:** they can reprint one, or "send" it by email or text. The demo shows exactly what would be sent; real sending comes with hosted mode.
- **Refunds:** whole sales or some items, back to the card or in cash, with stock and Astro punches put right. A manager refunding more than the store's limit needs the owner's OK.
- **Astro queue:** the Astro screen lists every sale (and refund) to enter in the Astro portal, each with **Mark entered**.

## How refunds work

**Who:** owners refund anything. Managers refund up to the store's **refund limit** (a new owner setting, default $50.00); above it, an owner approves on the tablet, the same way as discount approval in 2a. Cashiers can't refund. All of this follows the spec's roles.

**What:** a whole sale, or chosen quantities of chosen lines. A line can be refunded in several goes until all its units are back.

**Money:**
- **Exact cents.** Each line is refunded at what was actually paid for it: its net total after discounts, plus its share of the sale's tax. Partial quantities use running totals, so refunding 1 then 2 of 3 units adds up to exactly the line's total, never a cent more or less.
  - Refunding 1 of 3 units of a $10.00 line gives back `floor(1000 × 1/3)` = $3.33.
  - Refunding the other 2 then gives back `floor(1000 × 3/3) − 333` = $6.67.
- **Free items refund $0.** A free Astro reward item was paid $0, so refunding it returns nothing.
- **Tax shares.** New sales store each line's share of the sale's tax (`sale_lines.tax_cents`, spread by the 2a largest-remainder method), so the tax refunded is exact. For sales rung before this session, the share is worked out the same way when the refund happens.
- **Where the money goes:** back to the card payments first (refunded through `PaymentTerminal`, simulated in the demo), then cash for the rest. The screen says plainly: "Refund $43.21 to the card · Hand back $10.00 cash".
- **Never more than paid.** A sale can't be refunded beyond what was paid, and no payment beyond its own amount.

**Stock:** "Put the items back in stock", ticked by default, writes `return` moves. Untick it for damaged goods.

**Astro:**
- **Punches earned are taken back.** A refund removes the punches earned on the refunded units.
- **A returned free item gives the reward back.** If the refund includes the item that was the free reward, the customer's punches for that reward are given back.
- **Punches never go below zero.** If the customer has already spent the punches, the refund removes only what's there, and the queue row says so.
- **Queued for the portal.** A refund that changes Astro credit writes its own `astro_queue` row (kind `refund`), so staff reverse it in the Astro portal too.

**Audit:** every refund writes `audit_log` `sale.refund`: amounts, lines, reason, who refunded it and who approved it.

**Reasons:** Damaged, Wrong item, Changed mind, Price adjustment, Other (Other requires a note). They're shown in the refund history and on the receipt.

## How receipts are sent

- **Email or text:** a receipt goes by email or by text. The register's done screen and the sale's slide-over both get **Email receipt** and **Text receipt**, filled in with the customer's email or phone and editable.
- **Shared format:** the receipt text moves from the web app to `packages/core/receipt.ts`, so the server builds exactly what's sent and printed.
- **Demo mode:** the message is saved in `receipt_outbox` with status `preview` and shown on screen: "In the demo, receipts aren't sent. In the hosted version this goes by email (Amazon SES) or text (Amazon SMS)."
- **Hosted mode:** an SQS worker will send `queued` rows. Not built here.
- **Text receipts:** a text receipt the customer asks for at the counter is a transactional message, so it doesn't need marketing opt-in. The text is short: store name, total, and a line saying a full receipt link comes with hosted mode.

## The Astro queue

- **List:** the Astro screen's "To enter in Astro" shows **Pending** and **Entered** tabs.
  - Each row shows: time, receipt #, customer name and phone, and what to enter, written out plainly: "+2 Sample dry food club", "Redeemed: Next bag free (−$38.99)", "Offer: $5 off 24 lb bag", "Refund: −1 punch".
- **Mark entered** records who and when. **Undo** (owner or manager) puts a row back to pending if it was marked by mistake.
- **Live API later:** `services/api/src/astro/sender.ts` sends pending rows through `AstroClient`.
  - Sent rows are marked `sent`; a failure raises `attempts`, and after 5 it's `failed` and shown on the screen.
  - With today's not-connected client it does nothing, so rows stay `pending`.
  - Tests use a fake connected client, so it's ready for the Phase 5 live API.

## Database: migration 012_refunds

| Table / change | Fields |
| --- | --- |
| `refunds` | sale_id, staff_id, approved_by, reason, note, restock, amount_cents, tax_cents, created_at |
| `refund_lines` | refund_id, sale_line_id, qty, amount_cents, tax_cents (can't be changed or deleted by the app) |
| `refund_payments` | refund_id, payment_id, method, amount_cents, provider_ref |
| `sales` | + refunded_cents (≤ total), to list sales as "Refunded $12.99" or "Fully refunded" |
| `sale_lines` | + tax_cents (the line's share of the sale's tax) |
| `businesses` | + refund_approval_cents (default 5000) |
| `astro_punches` | + refund_id; new kinds `refund_reversal` (takes away) and `reward_return` (gives back); `astro_balances` updated to match |
| `astro_queue` | + kind (sale, refund), + refund_id; still one row per sale, plus one per refund |
| `receipt_outbox` | sale_id, channel (email, sms), to_address, subject, body, status (preview, queued, sent, failed), created_by |

Every table gets business_id, forced row-level security and `(business_id, id)` foreign keys, as before.

## Handlers

| Handler | Who | What |
| --- | --- | --- |
| `listSales {from, to, q}` | sales.view | Now any date range, searching receipt number or customer name; includes refunded amounts |
| `getSale` | register.use | Now also lists refunds (what, how much, why, who) |
| `refundPreview {saleId, lines, restock}` | sales.refund (owner, manager) | Money back per line, tax, the split between card and cash, Astro effects, and whether approval is needed. Nothing is saved. |
| `refundSale {saleId, lines, restock, reason, note, approvedBy}` | sales.refund | Does it all in one transaction, using the same math as the preview |
| `sendReceipt {saleId, channel, to}` | register.use | Validates the email or 10-digit phone, builds the message, and saves an outbox row (preview in demo) |
| `listAstroQueue {status}` | astro.view | Rows with sale info and the payload, written out |
| `markAstroEntered {id, entered}` | astro.view to mark; astro.edit to undo | Records who and when |
| Settings `updateSettings` | settings.edit | + refund approval limit |

## Screens

- **Sales** (`/sales`):
  - **Header:** a date picker (Today, Yesterday, a chosen day) and search.
  - **List:** a Refunded tag on refunded sales; KPIs for the day net of refunds, plus a "Refunds" KPI.
  - **Sale slide-over:** the receipt, refunds listed under it, and **Print**, **Email receipt**, **Text receipt** and **Refund** (owners and managers).
- **Refund panel** (slide-over):
  - each line with a quantity stepper (up to what's left to refund), or **Refund everything**
  - Reason (with a note for Other), and "Put the items back in stock"
  - a live breakdown: items, tax, total, card vs cash, and what changes in Astro
  - owner approval when a manager is over the limit
  - **Refund $X**, behind a second tap
- **Receipt preview panel:** shows the email (subject and body) or text exactly as it would go, with the demo note.
- **Astro** (`/astro`): the "To enter in Astro" section replaces the "comes with the register" note.
- **Settings:** "Managers can refund up to ($)" field, owner only.

## Tests

- **core:**
  - refund cents for 1 of 3, 2 of 3 and all, adding up exactly
  - tax shares that add up to the sale's tax
  - receipt text including refunds
- **api:**
  - full and partial refunds, then a refund of what's left
  - over-refund refused
  - card first, then cash
  - restock on and off
  - punches reversed; reward returned with the free item; never below zero
  - refund queue row written
  - the manager limit and owner approval
  - a cashier refused
  - audit rows
  - older sales with no stored tax share
  - sendReceipt validation and outbox row
  - queue: listing, mark entered and undo
  - the sender with a fake connected client: sent, a failure, then failed after 5
  - separation between businesses
- **web:**
  - the refund panel's stepper limits and breakdown
  - approval appears only when over the limit
  - the receipt preview text
  - the Astro queue's readable lines

## Out of scope

End-of-day drawer count and order-history import (2c); real email and text sending, and real Square refunds (hosted mode / 2d); exchanges (a refund plus a new sale does the same job for now).
