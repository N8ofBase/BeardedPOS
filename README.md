# Pet store POS & grooming system

Register, inventory, customers, and Astro Loyalty tracking for an independent pet store.

- `docs/SPEC.md` — the full spec (exported from the spec doc)
- `docs/prototype.html` — working prototype; open it in a browser to see the screens and flows
- `CLAUDE.md` — instructions Claude Code reads at the start of every session

Status: **Phases 1, 2 (except 2d, real Square) and 3 are done** in demo mode.
- Phase 1: products and inventory, customers, bulk import, store settings, staff and demo data.
- Phase 2a, the register: cash, simulated card reader and split payments, store discounts, Astro punches, rewards and offers, receipts, and camera barcode scanning.
- Phase 2b: sales history by day and search, refunds (card first, then cash, with stock and Astro punches put right and owner approval above the manager limit), receipts by email or text (previewed in the demo), and the "To enter in Astro" queue.

- Phase 2c: end of day (drawer count by denomination, card total, over/short and deposit), past orders imported from the old system, and order history on the customer profile.

- Customer sign-in with a one-time code (kept from Phase 4a, the pet store's online booking) for the coming online store.

Grooming, online booking and the groomer role came from the pet store this started as and have been removed for the board game shop. They're in the git history before this change if they're ever needed.

## Run it

```
npm install
npm run dev      # http://localhost:5173, demo mode
npm test
```

See `CLAUDE.md` for all commands and the repo layout.
