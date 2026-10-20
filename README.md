# Pet store POS & grooming system

Register, inventory, customers and pets, grooming calendar and booking, and Astro Loyalty tracking for an independent pet store.

- `docs/SPEC.md` — the full spec (exported from the spec doc)
- `docs/prototype.html` — working prototype; open it in a browser to see the screens and flows
- `CLAUDE.md` — instructions Claude Code reads at the start of every session

Status: **Phase 1, 2a–2c, 3a and 3b are done** in demo mode.
- Phase 1: products and inventory, customers and pets, bulk import, store settings, staff and demo data.
- Phase 2a, the register: cash, simulated card reader and split payments, store discounts, Astro punches, rewards and offers, receipts, and camera barcode scanning.
- Phase 2b: sales history by day and search, refunds (card first, then cash, with stock and Astro punches put right and owner approval above the manager limit), receipts by email or text (previewed in the demo), and the "To enter in Astro" queue.

- Phase 2c: end of day (drawer count by denomination, card total, over/short and deposit), past orders imported from the old system, and order history on the customer profile.

- Phase 3a, grooming: the service menu by pet size, groomer hours and time off, a day calendar per groomer, booking with a quote and warnings (outside hours, time off, lapsed rabies), double-booking refused by the database, the status flow to ready for pickup, and a phone-friendly My day for groomers.

- Phase 3b: checking out a groom at the register next to retail items (grooming tax as a store setting), grooming notes with before/after photos and a grooming history per pet, and back-bar supplies used per service.

The demo is live at https://petpos-demo.prismcortex.net. Next: 3c (week view, drag to reschedule, bulk move, the ready text and grooming revenue by groomer).

## Run it

```
npm install
npm run dev      # http://localhost:5173, demo mode
npm test
```

See `CLAUDE.md` for all commands and the repo layout.
