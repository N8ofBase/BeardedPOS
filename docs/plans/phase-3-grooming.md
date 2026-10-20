# Phase 3 plan: grooming

Status: **3a and 3b done 2026-10-20** (My day folded into 3a). 3c not started.

**3a built differently from this plan:**
- **Live checks while booking:** the form asks the server (`checkAppointment`) as you fill it in, so the quote, warnings and clash message are the server's own. Nothing is saved until **Book it**.
- **"Upcoming"** for the customer profile and the delete warning means from the start of today, and only bookings not yet started (booked or checked in).
- **Removing demo data** deletes sample appointments, services and groomer hours through `remove_demo_grooming()`, because the app can't delete appointments or services directly.
- **PGlite** loads the `btree_gist` extension everywhere through `PGLITE_OPTIONS` (`packages/db/src/parsers.ts`), and the offline cache includes its `.gz` bundle.

Spec scope (Phase checklist): services, groomer schedules, calendar, check-in to POS, back-bar consumption. Spec sections: Grooming calendar; Data model (services, groomer_schedules, appointments, grooming_notes, sale_lines.appointment_id); Customers and pets (grooming notes and photos, upcoming appointments, the vaccination warning); Roles (groomers see their own schedule, add notes and photos, mark appointments done).

Prototype: the Grooming tab, with its Calendar, Services and Groomers views, the booking form, the appointment detail and "Check out at register".

Online booking, deposits and reminders are **Phase 4**. Phase 3 is everything staff do in the shop.

Like Phase 2, it's built in demo mode, in three sessions:

| Session | Delivers |
| --- | --- |
| **3a. Services, groomers and the calendar** (detailed below) | The grooming menu with price and minutes by pet size, groomer hours and time off, a day calendar with one column per groomer, booking with a quote, a rabies warning, double-booking refused by the database, and the status flow up to "ready for pickup" |
| 3b. Checkout and the pet's grooming history | "Check out at register" puts the groom on the ticket next to retail items, and paying marks it done. Grooming notes and before/after photos on the pet's profile, and back-bar items (shampoo, blades) used up per service |
| 3c. Busy-day tools | Week view, drag to reschedule, bulk move a groomer's appointments when they call out, the "ready for pickup" text (previewed like receipts), and grooming revenue by groomer on the Sales page |

---

## Session 3a: services, groomers and the calendar

When it's done:
- **Owners and managers** set up the grooming menu and each groomer's hours.
- **Owners, managers and cashiers** book appointments from the calendar or the customer's profile.
- **Everyone** sees the day at a glance and moves an appointment along: checked in, in progress, ready for pickup.
- **Groomers** open straight to their own column.

### Services (Grooming → Services)

- **What a service has:** name, type (main service or add-on), a description for customers, a **price and minutes for each pet size** (S, M, L, XL, with "Same for all sizes"), buffer minutes after, deposit (stored for Phase 4), "Customers can book this online" (also for Phase 4), and active or archived.
- **Sizes:** as in the prototype, S is under 20 lb, M 21–50 lb, L 51–90 lb and XL over 90 lb. The pet's size comes from its profile.
- **Price changes:** every price change is written to `audit_log` (`service.price_change`), like product prices.
- **Archiving:** a service that's been booked is archived rather than deleted, so old appointments keep their name.

### Groomers (Grooming → Groomers)

- **Who grooms:** staff with the Groomer role, plus anyone else the owner ticks as "Grooms". An owner who also grooms is common in small shops. This is a new `staff.grooms` flag.
- **Weekly hours:** a start and end time for each weekday. "Same hours every day they work" fills them in, and a single day can differ ("Saturdays 9–3").
- **Time off:** a day or a span of hours, with a note ("Vet appointment"). The calendar greys it out, and booking into it shows a warning.

### Booking

- **Opening the form:** tap an open time in a groomer's column, or tap **Book appointment**. It opens a slide-over.
- **Steps:**
  1. **Customer:** search by phone or name. You can also start from the customer's profile.
  2. **Pet:** one of their pets. The pet's size fills in; if the pet has no size yet, you pick it and it's saved on the pet.
  3. **Service:** a main service plus any add-ons.
  4. **Groomer:** any groomer who works that day.
  5. **Time:** date and start time, in 15-minute steps.
  6. **Notes:** for the groomer.
- **Quote:** shown as you go, e.g. "Full groom + Teeth brushing · size M · $80.00 · 2 hr 10 min · ends 11:10 AM". It comes from one pure function, `quoteAppointment()`, in `packages/core/src/grooming.ts`. The price is copied onto the appointment, so a later price change doesn't change it.
- **Warnings** (each one needs "Book anyway"):
  - outside the groomer's hours, or during their time off
  - **rabies lapsed** by the appointment date: "Biscuit's rabies vaccination expired Aug 16. Ask for proof before the groom." This follows the spec's "warning on booking and check-in". Online booking (Phase 4) will refuse instead.
- **Double-booking is refused,** never just warned about:
  - **In the database:** an exclusion constraint on `(staff_id, tstzrange(starts_at, block_ends_at))` refuses an overlap even when two people book at the same moment. This is the rule in CLAUDE.md, using the `btree_gist` extension (bundled with PGlite, and available on RDS).
  - **Buffer:** `block_ends_at` = end + buffer minutes, so the buffer is blocked too.
  - **What doesn't block:** canceled appointments and no-shows don't hold the slot.
  - **On screen:** the form says plainly "Sample Groomer A already has Biscuit at 9:00 AM. Pick another time or groomer." before you tap Book, and the server says the same if the database refuses.

### The calendar (Grooming → Calendar)

- **Day view:**
  - **Getting around:** previous and next day, Today, and a date picker.
  - **Layout:** one column per groomer working that day, rows every 30 minutes from the earliest start to the latest end. Hours a groomer doesn't work, and their time off, are greyed out.
- **Appointment blocks:** pet name, time, service and size, and the customer when there's room, colored by status.
  - **Tapping a block:** opens the detail panel. It shows when, the customer and phone, the pet with a rabies warning if it applies, the price and services, the notes, and the status buttons.
- **Day summary:** appointments, in the shop now, ready for pickup, and expected grooming sales.
- **Groomer's view:** a groomer sees the whole day, but opens to **My day** (below). They can't book, edit or cancel. They can move status along.

### My day (groomers, on a phone)

- **What it is:** a phone-friendly list of today's appointments for the signed-in groomer, in time order. It replaces the calendar columns, which are cramped on a phone.
- **Each card:** time, pet, service and size, the groomer's notes, the pet's allergies and coat notes, and the rabies warning when it applies.
- **One big button** for the next step: **Start groom**, then **Ready for pickup**. Small "Undo" for a mis-tap.
- **When it shows:** groomers land on it from the Grooming menu. Anyone on a narrow screen (under 700 px) gets the list in place of the columns, with a groomer picker.
- **Demo note:** in the demo each device keeps its own data, so a phone doesn't update the counter tablet. That sharing comes with hosted mode (1f).

### Status flow

`booked → checked in → in progress → ready for pickup → done`. A booked appointment can also be marked no-show or canceled.

| From | Buttons | Who |
| --- | --- | --- |
| Booked | Check in, No-show, Edit, Cancel appointment (two taps) | owner, manager, cashier |
| Checked in | Start groom (in progress), Undo check-in | anyone, groomers included |
| In progress | Ready for pickup | anyone |
| Ready for pickup | (Check out at register: 3b) | anyone |
| No-show | Undo no-show | owner, manager, cashier |

- **Check in:** shows the rabies warning again if it applies.
- **Ready for pickup:** in 3a it shows "Text (212) 555-0100 to let them know Biscuit is ready". The text preview comes in 3c.
- **Done:** set by paying for the groom at the register in 3b. Until then "ready" is the last step, and an owner or manager can mark it done by hand if it was paid another way.
- **Timestamps:** each step records who and when (checked_in_at, started_at, ready_at, done_at).

### Customers

- **Customer profile:** "Upcoming appointments" (date, time, pet, service and groomer) and **Book appointment** replace the "once the grooming calendar is built" note.
- **Deleting a customer:** the delete preview counts upcoming appointments, and deleting cancels them, as the spec says. Past ones keep a blank customer, like sales.

### Database: migration 014_grooming

| Table / change | Fields |
| --- | --- |
| extension | `btree_gist` |
| `services` | name, kind (main, addon), description, price_s/m/l/xl_cents, minutes_s/m/l/xl, buffer_minutes, deposit_cents, online, active, archived_at, position |
| `groomer_hours` | staff_id, weekday (0–6), start_time, end_time; unique per staff and weekday |
| `time_off` | staff_id, starts_at, ends_at, note |
| `appointments` | customer_id, pet_id, staff_id, service_id, size, starts_at, ends_at, block_ends_at, status, price_cents, notes, created_by, checked_in_at, started_at, ready_at, done_at, canceled_at, sale_id (3b), deposit_payment_id (Phase 4). Plus the exclusion constraint where status isn't canceled or no-show. |
| `appointment_addons` | appointment_id, service_id, name, price_cents, minutes (copied, like sale lines) |
| `staff` | + grooms (true for the Groomer role) |

As always: business_id, is_demo, forced row-level security, `(business_id, id)` foreign keys and updated_at triggers. Money is integer cents and minutes are whole numbers.

**Times:** stored as `timestamptz`. The calendar shows the store's local time, the browser's in the demo. Hosted mode adds a store time-zone setting.

### Handlers

| Handler | Who | What |
| --- | --- | --- |
| `listServices {all?}`, `saveService`, `archiveService` | view: grooming.view; change: grooming.manage (owner, manager) | Menu; price changes audited |
| `listGroomers`, `saveGroomerHours`, `addTimeOff`, `removeTimeOff` | view: grooming.view; change: grooming.manage | Hours and time off |
| `groomingDay {day}` | grooming.view | Groomers working, their hours and time off, appointments with customer, pet and rabies flag, and the day summary |
| `bookAppointment`, `updateAppointment` | grooming.book (owner, manager, cashier) | Reprices with `quoteAppointment()` on the server, checks hours, time off and rabies (needs `override` for warnings), and turns the exclusion constraint into a plain message |
| `setAppointmentStatus {id, status}` | grooming.view, with groomers limited to in progress / ready, and no-show / undo for booking roles | Only the allowed steps |
| `cancelAppointment` | grooming.book | Status canceled; frees the slot |
| `customerAppointments {customerId}` | customers.view | Upcoming ones, for the profile |

New permissions: `grooming.book` (owner, manager, cashier) and `grooming.manage` (owner, manager).

### Demo data (a new `once()` part)

- **Services:** Sample Full groom, Sample Bath & brush, and the Sample Teeth brushing add-on, with the prototype's prices and minutes.
- **Groomers:** the existing Sample Groomer (DEMO) plus Sample Groomer B (DEMO), with the prototype's hours.
- **Appointments:** a few today, one in each status (Biscuit checked in at 9:00, and so on), so the calendar isn't empty on first look.
- **Removal:** Remove demo data removes all of these too.

### Tests

- **core:**
  - quotes by size with add-ons
  - duration and end-time text
  - slots and the hours check
  - allowed status steps by role
- **api:**
  - **Booking:** booking and repricing; outside hours and time off need an override; rabies lapsed needs an override.
  - **Double-booking:** refused, including the buffer and including two bookings at once. Canceled appointments and no-shows free the slot. Editing an appointment into a clash is refused.
  - **Status flow:** a groomer can't book but can mark ready.
  - **Services:** price change audited; archive keeps old appointments.
  - **Customers:** deleting one cancels upcoming appointments.
  - **Businesses:** separation between them.
- **web:**
  - the booking form's quote and warnings
  - the calendar placing blocks by time and greying off-hours
  - the status buttons by role

### Out of scope for 3a

Checkout, notes and photos, and back-bar (3b); week view, drag, bulk move and the ready text (3c); online booking, deposits and reminders (Phase 4).

---

## Session 3b: checkout, grooming history and back-bar

Status: **done 2026-10-20.**

**Built differently from this plan:**
- **Item discounts on a groom line** aren't offered on the register yet. The discount picker lists retail lines only. Whole-ticket discounts (employee, senior) do cover grooming.
- **The pet's grooming history** lists grooms from check-in on (booked ones are upcoming, not history), by status rather than by time of day.
- **The sample photos** in the demo are simple pictures (SVG) made by the seed. Real photos are JPEGs resized in the browser.
- **The camera:** on a phone, "Add before photo" / "Add after photo" opens it directly.

When it's done:
- **Checkout:** a finished groom goes onto the register ticket next to any retail items. Paying for it marks the appointment done and links it to the sale.
- **Grooming history:** groomers write notes and take before and after photos on their phone. The pet's profile shows each past groom with its notes and photos.
- **Back-bar:** the shampoo, conditioner and blades a service uses come off stock automatically when the groom is finished.

### Checking out a groom

- **Putting it on the ticket:**
  - **Check out at register** on the appointment (booked, checked in, in progress or ready) opens the register with the groom on the ticket and the customer attached. Groomers don't see this button, since they don't use the register.
  - **On the register:** once a customer is attached, the customer box shows their grooms from today that haven't been paid ("Biscuit · Full groom · ready for pickup"), each with **Add**.
- **The line:** "Full groom + Teeth brushing · Biscuit". The price is the appointment's booked price (add-ons included), quantity 1, no stepper.
- **One sale per groom:**
  - A groom can be on only one open sale at a time; adding it to a second ticket is refused.
  - A ticket whose customer doesn't match the groom is refused: "This groom is for Sample Customer. Change the customer or remove the groom."
- **Discounts and tax:**
  - **Store discounts** work as usual. An item discount can go on the groom line, and whole-ticket discounts (employee, senior) cover grooming too.
  - **Astro:** grooming doesn't earn punches.
  - **Tax:** new store setting **"Charge sales tax on grooming"**, off by default. Many states don't tax pet grooming, but some do; the owner checks theirs.
- **Paying:** finishing the sale (cash, card or split) sets the appointment to **done**, records done_at and sale_id, and the receipt shows the groom line.
- **Afterwards:**
  - **Canceling the sale** before payment leaves the appointment as it was.
  - **Refunding the groom line** refunds the money (2b). The appointment stays done, with "Refunded" shown on it.
- **Manual "Mark done (paid elsewhere)"** from 3a stays, for owners and managers.
- **On the calendar,** a done appointment shows "Paid · receipt #1043" with a link to the receipt.

### Grooming notes and photos

- **Writing a note:** **Add note** on the appointment panel and on My day cards. A short text ("Matted behind ears, shaved short") plus up to 6 photos marked Before or After.
- **Photos:**
  - On a phone, the photo button opens the camera, and the photo is resized in the browser (longest side 1280 px, JPEG).
  - **Demo:** photos are saved in the demo database, each under about 250 KB.
  - **Hosted:** photos go to S3 and only the key is stored.
- **Who:**
  - **Writing:** groomers, managers and owners (new permission `grooming.notes`).
  - **Reading:** everyone who can see customers.
  - **Deleting:** a note's author can delete their own on the same day; owners and managers can delete any note.
- **Where they show:**
  - the appointment panel
  - a new **Grooming history** on each pet on the customer profile: date, service, groomer, price, notes and photo thumbnails, newest first, with a photo opening full size
  - My day's card for that pet (the last groom's note, so the groomer sees "last time: short summer cut")

### Back-bar supplies

- **Products:**
  - **Back-bar supply:** a new flag for supplies used in grooming and not sold. They're hidden from the register grid and search, and still show in Inventory with stock, reorder points and low-stock alerts.
  - **Unit:** an optional label ("oz", "bottle", "each") shown next to on-hand counts, so a gallon of shampoo can be counted in ounces.
- **Supplies per service:** each service (and add-on) gets **Supplies used**: a product and an amount by pet size, e.g. "Oatmeal shampoo: 2 · 3 · 4 · 6 oz", with "Same for all sizes".
  - Any product can be listed, including a retail product the shop also uses on grooms.
- **When stock comes off:** when the groom is marked **ready for pickup**, the groom is finished and the supplies are used.
  - **Stock moves:** `consume` moves for the main service and each add-on, at the appointment's size, referencing the appointment.
  - **Undo ready:** puts them back with a matching move, so a mis-tap doesn't lose stock.
  - **Done by hand:** for an appointment marked done without passing through ready, the supplies come off then.
- **Price:** back-bar use doesn't change the groom's price.
- **The 1b column:** `inventory_levels.back_bar_on_hand` from 1b isn't needed and stays unused. One on-hand count per product is simpler for a small shop.

### Database: migration 015_grooming_checkout

| Table / change | Fields |
| --- | --- |
| `businesses` | + grooming_taxable (default false) |
| `sale_lines` | appointment_id gets a `(business_id, id)` foreign key to appointments, and a check that a line has a product or an appointment |
| `appointments` | + supplies_used_at (so supplies come off once) |
| `products` | + back_bar (default false), + unit |
| `service_supplies` | service_id, product_id, qty_s, qty_m, qty_l, qty_xl (whole numbers in the product's unit) |
| `grooming_notes` | pet_id, appointment_id, staff_id, note, created_at |
| `grooming_photos` | note_id, kind (before, after), image_data (demo), storage_key (hosted), width, height, bytes |

As always: business_id, is_demo, forced row-level security and `(business_id, id)` foreign keys. Notes and photos can't be changed by the app, only added or deleted by the rules above.

### Handlers

| Handler | Who | What |
| --- | --- | --- |
| `startCheckout` | register.use | Ticket lines can be `{appointmentId}`. The server prices them from the appointment, checks the customer and that the groom isn't on another open sale, and applies the grooming tax setting |
| finishing a sale | (internal) | Marks the sale's appointments done |
| `groomsToCheckOut {customerId}` | register.use | Today's unpaid grooms for the register's customer box |
| `addGroomingNote {appointmentId, note, photos}`, `deleteGroomingNote` | grooming.notes | Photo size and type checked on the server |
| `petGroomingHistory {petId, before?}` | customers.view | Past grooms with notes and photos, 10 at a time |
| `saveServiceSupplies {serviceId, supplies}` | grooming.manage | Supplies per service |
| `setAppointmentStatus` | as 3a | + uses or returns supplies on ready / undo ready |
| `saveProduct` | products.edit | + back-bar, unit |
| `updateSettings` | settings.edit | + grooming taxable |

### Demo data (a new `once()` part)

- **Supplies:** Sample Oatmeal shampoo (oz), Sample Conditioner (oz) and Sample Clipper blade (each) as back-bar supplies, linked to the sample services.
- **History:** a past groom for Biscuit with a note and two small sample photos, so the pet's grooming history isn't empty.

### Tests

- **core:**
  - supply amounts by size, for the main service and add-ons
  - the ticket's groom line (price, quantity 1, no stepper)
- **api:**
  - **Checkout:** a groom plus retail items; tax on or off; an employee discount covering grooming; paying marks it done with sale_id; canceling the sale leaves it as it was.
  - **Refusals:** a groom already on another open sale; the wrong customer; a canceled appointment.
  - **Refunds:** refunding the groom line.
  - **Back-bar:** supplies used once on ready and put back on undo; back-bar products hidden from the register's product search.
  - **Notes:** the rules for who adds and deletes; the photo size limit.
  - **History:** paging.
  - **Separation** between businesses.
- **web:**
  - the groom line on the ticket
  - "grooms waiting" in the customer box
  - the note form's photo picker
  - the pet's grooming history

### Out of scope for 3b

- **3c:** week view, drag, bulk move, the ready text and grooming revenue by groomer.
- **Phase 4:** deposits.
- **Not yet planned:**
  - **Tips for groomers:** common in grooming shops, and worth a small session of its own.
  - **No-show fees.**
