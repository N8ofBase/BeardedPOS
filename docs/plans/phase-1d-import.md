# Session 1d plan: bulk import

Status: **done 2026-10-16.**

**Built differently from this plan:**
- **Matching by barcode keeps our SKU.** A product found by barcode keeps its own SKU, and the row gets a warning ("Matched by barcode to SKU 0001; SKU left as it was"). Distributor files list our products under their own item codes, and those shouldn't rename our SKUs.
- **`undoPreview` handler.** Added so the typed confirmation can say exactly what undo deletes and puts back.
- **Error boundary.** Each screen now sits inside an error boundary, so one broken screen shows "This screen hit a problem" instead of blanking the whole app.
- **Encoding guard.** `services/api/test/encoding.test.ts` catches text saved with the wrong encoding, after a PowerShell edit corrupted "·" in two files during this session.

Original plan: Part of `docs/plans/phase-1-foundation.md`. Spec: Bulk import. Prototype: Settings → Bulk import (`IMP` column aliases, `buildPlan`, the preview with skip reasons).

When it's done:
- An Owner or Manager opens **Settings → Import**, picks what the file holds, and uploads a .csv or .xlsx.
- They check the matched columns and see a preview of what will be new, updated or skipped, with a reason for each skip. Nothing is saved until they tap Import.
- The import runs in batches of 500 with a progress line.
- Any past import can be **undone**: rows it created are deleted, and fields it changed are put back.

## File types

Header names are matched loosely (case, spaces and punctuation are ignored), using the prototype's aliases plus the spec's columns. Every column can be changed from a dropdown. Each type has a downloadable template CSV.

| Type | Columns | Matches existing records on |
| --- | --- | --- |
| **Customers and pets** | name, or first name + last name; phone, email, street address, city, state, zip, birthday, sms opt-in, notes. Pets can come in either layout: a "pets" column (`Biscuit (beagle), Mo (cat)`, as in the prototype) or numbered columns (`pet 1 name`, `pet 1 breed`, `pet 1 type`, `pet 1 birthday`, `pet 2 name`, …) | Phone (normalized to 10 digits), then email. Pets: same name under the same owner, ignoring case. |
| **Pets** | owner phone or owner email, pet name, species, breed, size, birthday, allergies, vet, rabies expires | Owner by phone, then email; pet by name under that owner |
| **Products** | sku, barcode, name, brand, category, price, cost, on hand, reorder at, astro program | SKU (ignoring case), then barcode |
| **Astro programs** | program name, brand, buy count, reward | Name, ignoring case |
| **Astro punch balances** | customer phone or email, program name, current punches | Customer by phone, then email; program by name |

**Order history moves to Phase 2** (approved in the Phase 1 plan).

### Rules for each row

- **Blank cells don't erase anything.** When a row updates an existing record, only the filled-in cells change it, as in the prototype.
- **Skipped rows**, each with a plain reason:
  - "No name"
  - "No phone or email"
  - "Phone isn't 10 digits"
  - "No customer with that phone or email"
  - "Phone and email belong to two different customers"
  - "Unknown program "Brand X club""
  - "Buy count missing or under 2"
  - "Price isn't an amount like 12.99"
  - "Needs both SKU and name"
  - "Two pets named Max in this row"
  - …and any database refusal (such as a barcode already used), shown as a skip rather than failing the whole file.
- **Warnings**: the row still imports, and the problem cell is ignored.
  - "Birthday "13/45/90" isn't a date, left blank"
  - "SMS opt-in "maybe" isn't yes or no, left as it was"
  - "Unknown program, imported without it" (products, as in the prototype)
- **Values:**
  - Money goes through `parseMoney`, phones through `normalizePhone`, and the state is upper-cased.
  - Dates can be `2024-03-07`, `3/7/2024` or `3/7/24`. A two-digit year counts as this century unless that would put it in the future, so `85` means 1985.
  - Yes/no accepts yes, y, true, 1 or x, and no, n, false, 0 or blank.
  - Species: dog or puppy, cat or kitten, anything else is Other, with the animal kept in "breed".
- **Same record twice in one file:** the second row updates what the first created. The preview counts it as an update.
- **Stock:** "on hand" for a new product is an opening-count move. For an existing product, it's an adjustment move to the file's count, so on hand still equals the sum of moves.
- **Price changes** to existing products write `audit_log` (CLAUDE.md rule).
- **Punch balances:** the file's number becomes the customer's balance for that program. The import replaces earlier `opening_balance` rows with one new row, so the balance comes out at the file's number. Phase 1 has no earned punches yet; when there are some, the opening amount is reduced by them.

## Database: 009_imports

- `import_batches`
  - type, file_name, staff_id, status (running, done, undone), total_rows, created, updated, skipped, finished_at, undone_at
  - business_id, with row-level security like every table
- `import_changes`: batch_id, seq, entity (customer, pet, vaccination, product, program, punch, stock), entity_id, op (created, updated, deleted, moved), before (jsonb), after (jsonb)
  - Append-only for the app
- `import_batch_id` on customers, pets, products and astro_punches (the spec's addition), set on the rows a batch created

## Handlers (services/api/src/handlers/import.ts, logic in services/api/src/import/)

| Handler | What |
| --- | --- |
| `previewImport {type, rows}` | Runs the real import inside a savepoint, then rolls back, so the preview always matches the result. Returns new, updated and skipped counts, skips and warnings with spreadsheet row numbers, and the first 20 rows with what will happen to each. |
| `startImport {type, fileName, totalRows}` | Creates the batch and returns its id |
| `importChunk {batchId, offset, rows}` | Up to 500 rows in their own transaction. Each row gets its own savepoint, so one bad row is a skip, not a failed chunk. Records every change in `import_changes`. |
| `finishImport {batchId}` | Marks the batch done and returns the totals |
| `listImports` | Recent batches with counts and who ran them |
| `undoImport {batchId}` | Goes through the batch's changes newest-first. An update gets each field the import changed put back, unless someone has edited that field since; those are kept and listed in the result. Created rows are deleted. Stock moves are reversed with a new move. Each deleted customer writes a `customer.delete` audit row; one `import.undo` row is written too. A batch can only be undone once. |

All six need `import.run` (owner, manager).

Files are limited to 20,000 rows and 10 MB. Preview sends all mapped rows at once, which is fine in demo mode. In hosted mode (1f), preview will have to send rows in chunks too, because Lambda caps a request at 6 MB. That's noted for 1f.

## Rules in packages/core/import

- `types.ts`: the five file types, their fields (key, label, aliases, required), help text, and template headers with a sample row
- `columns.ts`: `normalizeHeader`, `autoMatch(headers, type)` (including the numbered pet columns), and `mapRows(rows, mapping)`
- `values.ts`: `parseLooseDate`, `parseYesNo`, `parseSpecies`, `parseSize`, `parseCount`, `parsePetsCell` (the prototype's "Biscuit (beagle), Mo (cat)" format)

## Screen: Settings → Import (`/settings/import`)

1. **What's in the file:** five choices, the help line, **Download template**, and a file box (.csv, .xlsx, .xls).
2. **Match columns:** each field next to a dropdown of the file's columns (or "Not in the file"), with two sample values. Required fields are marked.
3. **Preview**
   - Counts: Rows in file, New, Updated, Skipped.
   - A table of skipped rows and their reasons (first 50, then "and 120 more").
   - Warnings.
   - The first 20 rows with New, Update or Skip.
4. **Import 1,234 rows:** progress reads "Saved 500 of 1,234", then a summary.
5. **Past imports**
   - Date, type, file name, staff, new, updated, skipped, status.
   - **Undo**, behind a typed-"delete" confirmation, because undo deletes the customers and products the batch created: "This deletes 212 customers and 4 products this import created, and puts back 37 records it changed."

The file is parsed in the browser with SheetJS, installed from cdn.sheetjs.com as the plan says, because the npm copy is outdated. Excel dates come through as `YYYY-MM-DD`.

The Settings page gets a "Bulk import" panel linking here. The rest of Settings stays for 1e.

## Tests

- **core:**
  - header matching for every alias, including the numbered pet columns
  - first + last name
  - the pets cell format
  - each value parser (date formats and the two-digit year pivot, yes/no, species, size, bad values)
  - the templates
- **api:**
  - customers match on phone, then email, with the conflicting-match skip
  - a second row in the same file updates instead of duplicating
  - pets match by owner and name in both layouts
  - products match on SKU in any case, then barcode
  - on hand becomes moves, and a price change is audited
  - programs match by name in any case
  - an unknown program is skipped (punches) or warned about (products)
  - punch balances end at the file's number
  - every skip reason
  - preview saves nothing and its counts equal the real import's
  - a 1,200-row file in three chunks gives the same result as one pass
  - a bad row doesn't stop its chunk
  - undo deletes created rows, restores updated fields, keeps fields edited since and reports them, reverses stock, and can't run twice
  - a cashier is refused
  - imports are separated by business
- **web:** the column-matching screen auto-selects matches and lets one be changed; the preview shows skip reasons.

## Out of scope

Order-history import (Phase 2); saved column presets for Astro's export format (later, once there's a sample file, as the spec suggests); importing staff.
