# Phase 3 plan: grooming

Status: **3a done 2026-10-20, with My day folded in.** 3b and 3c not started.

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
