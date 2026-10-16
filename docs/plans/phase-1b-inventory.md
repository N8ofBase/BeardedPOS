# Session 1b plan: products and inventory

Status: **done 2026-10-16** (built with 1c).

**Built differently from this plan:**
- Append-only is enforced by `REVOKE UPDATE, DELETE … FROM pos_app` rather than a trigger. The database owner can still delete, for removing demo data.
- `inventory_levels` can't be written by the app at all. Only the `SECURITY DEFINER` move trigger writes it.
- Count mode moves focus to the scanned item's count box, and Enter goes back to the scan field, so a USB scanner can drive it without touching the screen.

Original plan: Part of `docs/plans/phase-1-foundation.md`. Spec: Data model (products, inventory_levels, inventory_moves, astro_programs, audit_log) and Screens → Inventory. Prototype: Inventory and Astro tabs.

When it's done:
- In the demo, an Owner or Manager can add and edit products, see on hand, margin and low-stock flags, receive stock, and count stock on a phone.
- They can also add Astro frequent buyer programs and link products to them.
- A Cashier sees the same list read-only. Groomers don't see Inventory (unchanged from 1a).
- Every price or cost change is written to the audit log.

## Database

**003_astro_programs**: `astro_programs`
- name, brand, buy_count (2 or more), reward_text, astro_program_ref (empty until the live API), active, is_demo
- Unique per business: lower(name)

**004_products**
- `products`
  - sku, barcode, name, brand, category, price_cents, cost_cents, tax_class (`standard` or `exempt`), reorder_at
  - astro_program_id, astro_offer_label + astro_offer_cents (as in the prototype; both set or both empty), active, is_demo
  - Unique per business: lower(sku), and barcode where present
  - **The Astro program must belong to the same business.** A composite foreign key on (business_id, astro_program_id) enforces this, so even a bug can't link one store's product to another store's program. Deleting a program clears the link and leaves the product.
- `inventory_levels`: product_id, location_id, on_hand, back_bar_on_hand (one row per product per location)
- `inventory_moves`: product_id, location_id, qty_change (never 0), reason (sale, receive, adjust, consume, return), ref_id, staff_id, note
  - **Append-only:** a trigger refuses UPDATE and DELETE from the app role. Only the database owner can delete, for example when 1e removes demo data.
  - **On hand is kept by the database:** a trigger adds each move's qty_change to `inventory_levels` in the same transaction. On hand therefore always equals the sum of moves, and no handler has to remember to update it.

**007_audit_log**: `audit_log`
- staff_id, action, entity, entity_id, before (jsonb), after (jsonb)
- Append-only, the same way
- This session writes `product.price_change` entries. 1c adds customer deletes.

All four tables get business_id, is_demo where it applies, forced row-level security, and updated_at triggers, following 1a.

**Products are archived, not deleted.** The prototype has Delete, but a product with sales or stock history must keep it. The button reads **Archive**, asks for a second tap, and hides the product from the list. "Show archived" brings it back.

## Rules in packages/core

- `catalog.ts`: categories from the prototype (Dog food, Cat food, Treats, Supplies, Small animal, Fish, Bird), plus `stockStatus(onHand, reorderAt)` → out / low / ok, used for the tags.
- `product.ts`: `validateProduct(input)` → plain-English errors per field ("SKU is required", "Price can't be negative"), and SKU and barcode trimming.

## Handlers (services/api/src/handlers/inventory.ts, astro.ts)

| Handler | Who | What |
| --- | --- | --- |
| `listProducts {q, lowOnly, category, includeArchived}` | products.view | Rows with on hand, program name and offer; low stock first, then name, as in the prototype |
| `findByCode {code}` | products.view | SKU (any case) or barcode, for scanning |
| `getProduct {id}` | products.view | One product plus its last 20 moves |
| `saveProduct {…}` | products.edit | Create or update. On create, an optional opening on hand becomes an `adjust` move ("Opening count"). A price or cost change writes `audit_log`. A duplicate SKU or barcode gets "That SKU already exists". |
| `archiveProduct {id, archived}` | products.edit | Archive or restore |
| `receiveStock {productId, qty, note}` | inventory.adjust | A `receive` move; qty must be 1 or more |
| `saveCounts {lines: [{productId, counted}]}` | inventory.adjust | Writes an `adjust` move for each difference and skips lines that already match. Returns what changed. |
| `listPrograms` | astro.view | Programs, with how many products link to each |
| `saveProgram {…}` | astro.edit (new: owner, manager) | Create or update |

## Screens (apps/web)

- **Inventory** (`/inventory`)
  - The header has **New product**, shown only to those who can edit.
  - Filter box, category select, and a "Low stock only (3)" toggle.
  - Table columns as in the prototype: SKU, Product (name; brand · category), Astro tags, Price, Margin, On hand (Out / "4 left" / count). Each row has **Receive** (inline quantity, then Add) and **Edit**.
  - Cashiers get the table without buttons.
- **Product slide-over:** the prototype's fields plus Barcode and Tax (Taxable / Not taxed), with prices entered in dollars and stored as cents through `parseMoney`. "On hand" appears only for a new product, as the opening count; after that, stock changes only through Receive and Count. A **Stock history** list shows the last 20 moves. Save, Cancel, and Archive (asks for a second tap).
- **Count mode** (`/inventory/count`, linked from Inventory, phone-first)
  - A scan field stays focused; a USB or Bluetooth scanner types into it, then Enter.
  - It shows the product and the expected count, then you type the counted number.
  - A running list shows each line's difference (+3 / −2). **Save counts** writes them all at once, and a toast reads "Saved 4 counts · 2 changed".
- **Astro** (`/astro`)
  - The prototype's note about the connection not being linked yet.
  - The programs table with product counts, plus the add and edit form (Program name, Brand, Buy how many, Reward).
  - "To enter in Astro: comes with the register in Phase 2".
- **Toast:** a small shared component, as in the prototype.

## Demo seed

Adds the prototype's samples with "(DEMO)" names:
- Program: Sample dry food club, buy 12, reward "Next bag free"
- Products:
  - 0001 Adult Dog Food 24 lb: $64.99, cost $43.00, 14 on hand, offer $5 off
  - 0002 Cat Food 12 lb: 4 on hand, low stock
  - 0003 Freeze-Dried Treats
  - 0004 Rope Toy: 0 on hand, out of stock
- Opening stock goes in as moves, so on hand matches its history.

## Tests

- **core:** validateProduct messages; stockStatus at 0, at the reorder point and above it.
- **db:**
  - on hand equals the sum of moves after receive, adjust and return
  - the app role can't update or delete a move or an audit row
  - SKU is unique ignoring case within a business, and allowed across businesses
  - a product can't link to another business's program
  - qty_change of 0 is refused
- **api:**
  - create with opening count
  - a price edit writes one audit row with before and after; an edit without a price change writes none
  - a cashier can't edit, receive or count
  - receive adds stock
  - counts write only the differences
  - findByCode matches SKU in any case and barcode
  - the low-stock filter works
  - one business can't read or edit another's products
- **web:** a cashier sees no New product, Receive or Edit buttons; count mode shows the right difference.

## Out of scope

Purchase orders and receiving against a PO (Phase 5); back-bar use by grooming services (Phase 3); product import (1d); products on the register (Phase 2).

## Where it lands

Commits go to `main`, as in 1a, followed by a deploy to the demo site. Session 1c, if it runs at the same time, owns migrations 005–006 and the customers files, so the two don't overlap.
