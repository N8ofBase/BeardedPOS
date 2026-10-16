# Session 1c plan: customers and pets

Status: **done 2026-10-16.**

**Built differently from this plan:**
- Migration **008_demo_seed_parts** records which sample sets have loaded, so deleting the demo customers doesn't bring them back on the next visit. Browsers seeded by 1a get the new products and customers once.
- PGlite returns `date` columns as "YYYY-MM-DD" strings (`packages/db/src/parsers.ts`), so birthdays never shift by a time zone.
- Pets added in the same save are listed by name, since they share a timestamp.

Original plan: Part of `docs/plans/phase-1-foundation.md`. Spec: Data model (customers, pets, vaccinations, astro_punches) and Screens → Customers and pets. Prototype: the Customers tab (form with pet rows, cards, birthday tags, typed-"delete" panel).

**Order:** build this after 1b. `astro_punches` links to 1b's `astro_programs`, and deletes use 1b's `audit_log`.

When it's done:
- Staff can find a customer by name, email, pet name or part of a phone number, and add or edit a customer with their pets in one form.
- Each customer has a profile with pets, vaccinations and Astro punch cards.
- An Owner or Manager can delete a customer after typing "delete".
- Groomers can look but not change anything.

## Database

**005_customers**
- `customers`
  - name, phone (10 digits, set through `normalizePhone`), email, street, city, state, zip, birthday, sms_opt_in, notes, astro_customer_id, is_demo
  - Unique per business: phone and lower(email), each only when present
  - A customer needs a name, plus a phone or an email (the spec's lookup keys)
- `pets`
  - customer_id, name, species (dog, cat, other), breed (or notes, for Other), size (S, M, L, XL), coat, birthday, weight_lb, temperament, allergies, vet_name, is_demo
  - Unique: (customer_id, lower(name))
  - Deleted with the customer
- `vaccinations`
  - pet_id, vaccine, expires_on, proof_file_key (empty until Phase 3)
  - Unique: (pet_id, lower(vaccine)), so each vaccine has one current expiry
  - Deleted with the pet

**006_astro_punches**: `astro_punches`
- customer_id, program_id, sale_id (Phase 2), qty (positive), kind (earn, redeem, opening_balance), is_demo
- A program must belong to the same business (composite foreign key, as in 1b)
- **Balance** = earned + opening − redeemed, per customer and program, computed in a view: `astro_balances`
- Deleted with the customer

All tables get business_id, forced row-level security and updated_at triggers, following 1a.

## Rules in packages/core

- `birthday.ts`
  - `daysUntilBirthday(iso, today)`: 0 means today. A Feb 29 birthday counts as Feb 28 in other years.
  - `birthdayTag()` text: "birthday today", "tomorrow", "in 5 days", and only within 7 days, as in the prototype.
  - `ageText()`: "8 mo", "3 yrs".
- `pets.ts`
  - `validatePets(rows)` gives the prototype's message: "Two pets have the same name. Add a last initial or nickname to tell them apart."
  - Species labels Dog / Cat / Other.
- `vaccines.ts`
  - Vaccine list (Rabies, DHPP, Bordetella, Leptospirosis, FVRCP, FeLV, Other)
  - `vaccineStatus(expiresOn, today)`: expired, due within 30 days, or ok
  - `rabiesLapsed(pet)`: the spec's "block booking when rabies has lapsed" (used in Phase 3; warned about now)
- `customer.ts`: `validateCustomer()`
  - Name is required, plus a phone or an email
  - A phone that isn't 10 digits gets "Enter a 10-digit phone number"
  - State is 2 letters; ZIP is 5 digits or ZIP+4

## Handlers (services/api/src/handlers/customers.ts)

| Handler | Who | What |
| --- | --- | --- |
| `searchCustomers {q}` | customers.view | Matches name, email or pet name; 3 or more digits also match anywhere in the phone. Returns cards: contact, pets, punch balances, birthday info. Sorted by name, first 100. |
| `lookupByPhone {phone}` | customers.view | Exact match on the normalized phone, for the register in Phase 2 |
| `getCustomer {id}` | customers.view | Profile: customer, pets with vaccinations, punch cards with program name and buy count |
| `saveCustomer {customer, pets}` | customers.edit | Create or update in one transaction. Pet rows with an id update; rows without one are added; pets left out of the list are removed. A duplicate phone or email gets "Another customer already has that phone number" (or email). |
| `savePetDetails {petId, …}` | customers.edit | Size, coat, weight, temperament, allergies, vet (on the profile) |
| `saveVaccinations {petId, rows}` | customers.edit | Replaces that pet's vaccine list |
| `deletePreview {id}` | customers.delete | Pets, punch cards and contact details that will go, for the warning text |
| `deleteCustomer {id}` | customers.delete (owner, manager) | Deletes the customer, pets, vaccinations and punches. Writes `audit_log` `customer.delete` with id, name and counts only, no contact details. |

Appointments (Phase 3) and sales and order history (Phase 2) don't exist yet. The delete warning already says past sales are kept; those phases add "upcoming appointments will be cancelled".

## Screens (apps/web)

- **Customers** (`/customers`)
  - The header has a search box ("Search name or phone") and **New customer** for those who can edit.
  - A grid of cards, as in the prototype: name, formatted phone, email, address line, birthday with tag, pet chips (name, Dog/Cat/Other · breed · age, birthday tag) and punch cards (dots).
  - Card buttons: **Profile**, **Edit**, and **Delete** for those who can delete.
  - Empty state: "No customers yet. Add one, or import a file in Settings."
- **Customer form** (slide-over)
  - The prototype's fields (Name, Phone, Email, Street address, City, State, ZIP, Birthday (optional)) plus Text messages OK (sms_opt_in) and Notes.
  - Pet rows: Pet name; Dog / Cat / Other buttons; Birthday (optional); Breed or notes, with a placeholder that changes by type ("e.g. beagle", "e.g. Maine coon", "e.g. rabbit, ferret, bird"); Remove; "+ Add another pet".
  - Saves with "Customer added" or "Customer saved".
- **Customer profile** (`/customers/:id`)
  - Contact details and notes.
  - Each pet as a panel: details form, vaccinations table with Expired (red) and Due soon (amber) tags, and a warning line "Rabies expired Mar 3; booking will be blocked until it's updated".
  - Punch cards with dots and "Reward ready" when a card is full.
  - "Order history and appointments show here once the register and grooming calendar are built."
- **Delete** (typed confirmation panel, the prototype's wording)
  - "Delete Sample Customer (DEMO)?" "This permanently removes … and their pets (Biscuit), their contact details, 1 Astro punch card … It can't be undone."
  - "Past sales stay in Sales, without a customer attached. Punch balances held in Astro itself aren't affected."
  - The Delete customer button stays disabled until "delete" is typed.
  - A reusable `ConfirmTyped` component; 1e uses it for removing demo data.

## Demo seed

The phone numbers are in the fictional 555-01xx range.

| Customer | Phone | Pet | Details |
| --- | --- | --- | --- |
| Sample Customer (DEMO) | (212) 555-0100 | Biscuit, beagle | Size M, rabies current, 11 of 12 punches as an opening balance, so the card is one away from a reward |
| Sample Cat Parent (DEMO) | (212) 555-0101 | Mo, cat | Rabies expired last month (shows the warning), customer birthday in 3 days (shows the tag) |
| Sample Family (DEMO) | (212) 555-0102 | Two dogs and a rabbit (Other) | Shows several pets on one card |

Birthdays and expiry dates are computed from the day the demo is set up, so the tags always appear.

## Tests

- **core:**
  - birthday distance (today, tomorrow, year wrap, Feb 29)
  - age text
  - vaccine status edges (expires today, in 30 days, yesterday)
  - validateCustomer messages
  - duplicate pet names in any letter case
- **db:**
  - phone unique in a business, and the same phone allowed in two
  - email unique ignoring case
  - pet name unique per customer, and the same name allowed for different customers
  - deleting a customer removes pets, vaccinations and punches
  - a punch can't use another business's program
  - astro_balances adds up earn, opening and redeem
- **api:**
  - save normalizes the phone
  - a bad phone is refused with the message
  - editing pets adds, updates and removes the right rows
  - search by name, pet name, email and 3 digits of phone
  - lookupByPhone in any format
  - a cashier can save but not delete
  - a groomer can't save
  - delete writes one audit row with no phone, email or address in it
  - one business can't see another's customers
- **web:**
  - the Delete button stays disabled until "delete" is typed (any case)
  - a groomer sees no New customer, Edit or Delete
  - the pet-row placeholder changes with the type

## Out of scope

Order history and "usually buys" (Phase 2, with sales); appointments (Phase 3); vaccine proof upload and pet photos (Phase 3); import (1d); one-time-code customer accounts (Phase 4).

## Where it lands

Commits go to `main` after 1b, followed by a deploy to the demo site.
