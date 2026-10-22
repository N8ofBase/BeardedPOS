# Phase 4 plan: online booking

Status: **4a approved and built; live on the demo. 4b and 4c waiting.**

Built differently from the plan in 4a:
- A wrong sign-in code is returned as a result (`{status: "wrong"}`), not thrown, so the try count is saved; a thrown error would roll it back.
- The public handler for open times is `openTimesFor` in code, registered as `openTimes`.

Spec scope (Phase checklist): public booking page, deposits, email and text reminders, rebook nudges. Spec sections:
- **Online booking (public):**
  - The customer picks a pet, a service, a groomer (or any) and an open slot.
  - New customers sign up by phone or email with a one-time code.
  - Deposits are collected with a Square payment link.
  - Messages: a confirmation, a day-before reminder, and a rebook nudge.
  - Customers can cancel or reschedule up to a cutoff.
- **Roles:** "Customer (public): book grooming online, manage own pets and appointments".
- **Data model:** "block booking when rabies has lapsed".

## What the demo can and can't show

The booking page runs in the same app at `/book`, with its own look and no staff menu.

- **In the demo:** you open it from the staff app (**Open booking page** in Grooming), or from a "Customer view" link on the demo banner. It's the same device and the same sample data, so a booking made there shows up on the grooming calendar straight away. That's the point of the demo.
- **Hosted mode:** customers use it from their own phones, at `<client>.pos.prismcortex.net/book`, with real codes, payments and texts.
- **What the demo fakes:** it can't send a real code by text, take a real deposit or send a real reminder. Those are previews, like the receipts and ready texts:
  - the one-time code appears on screen
  - a simulated payment page stands in for Square
  - messages land in an outbox you can read

Like Phases 2 and 3, it's built in three sessions:

| Session | Delivers |
| --- | --- |
| **4a. Booking page and customer sign-in** (detailed below) | Sign-in with a one-time code, adding pets, picking a service, groomer and open time, booking, and **My appointments** with cancel and reschedule up to the store's cutoff. Online booking settings, and "Booked online" on the staff calendar |
| 4b. Deposits | A deposit for new customers or chosen services, through a Square payment link (simulated in the demo). The deposit comes off the groom at the register; it's refunded on an in-time cancel and kept on a no-show, as the store sets it |
| 4c. Confirmations, reminders and rebook nudges | Booking confirmation, the day-before reminder, and "time for Biscuit's next groom?" after a set number of weeks. Email or text by the customer's choice, opt-out honored, and previews in the demo |

---

## Session 4a: booking page and customer sign-in

When it's done, a customer can:
- open the store's booking page
- sign in with a code sent to their phone or email, or sign up if they're new
- add a pet, or pick one of theirs
- book a groom in a free slot
- see, cancel or reschedule their appointments

The booking lands on the grooming calendar like any other, marked **Booked online**.

### Who the customer is: sign-in with a one-time code

- **Step 1:** "Enter your mobile number or email." The server sends a 6-digit code. In the demo it shows on screen: "In the demo your code is 482913. In the hosted version it's sent by text or email."
- **Step 2:** type the code.
  - **Known customer:** matched by phone, then email, as everywhere else. They're signed in.
  - **New customer:** they enter their name. A customer record is created, and their contact is the phone or email they verified.
- **Session:** stays signed in on that device for 30 days. There's a **Sign out** link.
- **Safety:**
  - **The code:** expires in 10 minutes, allows 5 tries, and is stored only as a hash. One code can be requested a minute, and 5 an hour, per phone or email.
  - **No guessing who's a customer:** a wrong code says nothing about whether the number is already a customer.
  - **Sessions:** stored as a hash too.

### Booking

1. **Pet:** their pets, or **Add a pet** (name, dog / cat / other, breed, size with the weight guide, birthday optional).
2. **Service:** main services marked "Customers can book this online", with add-ons. Prices show for the pet's size ("Full groom · $70.00 · about 2 hours").
3. **Groomer:** a groomer who takes online bookings, or **Any groomer**.
4. **Day:** the next 30 days (store setting), with days that have no openings greyed out.
5. **Time:** open start times, every 30 minutes (store setting).
   - **When a time is open:** the groom and its buffer fit inside a groomer's hours, avoiding their time off and other bookings.
   - **Notice:** nothing sooner than the minimum notice (store setting, default 2 hours).
   - **With "Any groomer":** the time goes to the groomer with the fewest bookings that day, so work is shared.
6. **Review and book:** the pet, service, groomer, day and time, price, and a notes box ("Anything we should know?"). Then **Book**.

**Rules:**
- **Rabies:** a dog or cat whose rabies has lapsed by the appointment day can't book online. "Biscuit's rabies vaccination expired on Aug 16. Please call us at (212) 555-0199 to book." A pet with no rabies date on file can book, with a reminder to bring proof.
- **Double-booking:** the server checks the slot again when **Book** is tapped (the same `checkSlot()` the staff use). The database's double-booking rule has the last word: "Sorry, that time was just taken. Pick another."
- **Prices** come from `quoteAppointment()`, as for staff bookings.

### My appointments

- **The list:** upcoming grooms, with the pet, service, groomer, day, time and price.
- **Cancel / Reschedule:** allowed until the store's cutoff (default 24 hours before).
  - **Reschedule:** goes back through the day and time steps, keeping the pet and service.
  - **After the cutoff:** "It's less than 24 hours away. Please call us to change it."
- **Past grooms:** the last few, with **Book again** (same pet and service).
- **My pets:** name, breed and size. Customers can add pets and fix the breed or size. Notes and vaccinations stay staff-only.

### Staff side

- **Calendar:** an online booking shows a small **Online** tag on the calendar block and in the appointment panel ("Booked online by the customer").
- **Settings → Online booking** (owner and manager):
  - **On / off.** When off, the page says "Online booking isn't available. Call us at …"
  - **How far ahead:** 30 days.
  - **Minimum notice:** 2 hours.
  - **Cancel cutoff:** 24 hours.
  - **Times offered every:** 30 minutes.
  - **A short welcome message** for the top of the page.
  - **The store's phone number** to show customers.
- **Groomers:** a "Takes online bookings" tick per groomer, on by default.
- **Services:** the existing "Customers can book this online" tick.

### Keeping customers and staff apart

- **Separate handlers:** customers reach a separate, small set of public handlers through `invokePublic`, never the staff registry. Every public handler works only on the signed-in customer's own pets and appointments.
- **The customer context** carries the business id and customer id. Row-level security still limits every query to the store.
- **What customers never see:** other customers, staff notes, prices other than the menu's, or any staff screen.
- **Hosted mode:** these become their own Lambda behind the public API, with rate limits at API Gateway.

### Database: migration 017_online_booking

| Table / change | Fields |
| --- | --- |
| `businesses` | + booking_enabled (default true in the demo), booking_days_ahead (30), booking_notice_minutes (120), booking_cutoff_hours (24), booking_step_minutes (30), booking_message, public_phone |
| `staff` | + books_online (default true) |
| `appointments` | + source (staff, online), + booked_by_customer |
| `customer_login_codes` | contact (phone or email), code_hash, expires_at, attempts, used_at, created_at |
| `customer_sessions` | customer_id, token_hash, expires_at, last_seen_at, created_at |

As always: business_id, forced row-level security and `(business_id, id)` foreign keys. Codes and sessions are never sent back to the browser, except the session token itself, once.

### Handlers (public, through `invokePublic`)

| Handler | What |
| --- | --- |
| `bookingPage {}` | Store name, logo, welcome message, phone, whether booking is on, online services with prices by size, groomers who take online bookings |
| `requestCode {contact}` | Sends (or in the demo, returns) a code; rate-limited |
| `verifyCode {contact, code, name?}` | Signs in or signs up; returns a session token |
| `signOut {}` | Ends the session |
| `myAccount {}` | The customer's name, pets, upcoming and recent appointments |
| `savePet {…}` | Adds a pet or fixes the breed or size, on their own pets only |
| `openTimes {petId, serviceId, addonIds, staffId?, from, to}` | Open start times by day, from the availability engine |
| `bookOnline {…}` | Books after rechecking the slot and the rabies rule |
| `cancelMine {id}`, `rescheduleMine {id, day, start}` | Allowed up to the cutoff |

Staff handlers: `updateSettings` + online booking settings; `saveGroomer` + takes online bookings.

**Core** (`packages/core/src/booking.ts`):
- `openTimes()`: the availability engine. A pure function of hours, time off, bookings, length, buffer, step, notice and "now".
- `pickGroomer()` for "Any groomer".
- `canChange()` for the cutoff.
- The code and session rules: expiry, tries, rate limits.

### Demo data

The sample store has online booking on. The sample services and both sample groomers are open to it, so you can book right away.

### Tests

- **core:**
  - open times around hours, time off, bookings, buffer and notice
  - "Any groomer" spreading the work
  - the cutoff
  - code expiry and tries
- **api:**
  - **Sign-in:** sign-in and sign-up by phone and by email; a wrong code, an expired code and too many tries; rate limits.
  - **Booking:** open times match what can actually be booked; booking rechecks the slot (two customers, one slot); lapsed rabies refused; only online services and groomers.
  - **Changing:** cancel and reschedule before and after the cutoff.
  - **Privacy:** a customer can't see or change another customer's pets or appointments, or reach any staff handler.
  - **Separation** between businesses.
- **web:**
  - the sign-in steps
  - the booking steps with greyed days and open times
  - the review screen
  - My appointments with the cutoff message
  - the Online tag on the staff calendar

### Out of scope for 4a

- **4b and 4c:** deposits (4b); confirmations, reminders and rebook nudges (4c).
- **Customer-uploaded documents:** proof of vaccination uploads come with hosted mode (S3).
- **Waitlists and repeat bookings:** not planned yet.
