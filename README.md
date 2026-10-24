# Bearded POS

Register, inventory, customers and an online store for Bearded Board Games, an independent board game shop.

- `docs/SPEC.md` — the full spec (exported from the spec doc)
- `docs/prototype.html` — working prototype; open it in a browser to see the screens and flows
- `CLAUDE.md` — instructions Claude Code reads at the start of every session

Status: **Phases 1, 2 (except 2d, real Square) and 3 are done** in demo mode.
- Phase 1: products and inventory, customers, bulk import, store settings, staff and demo data.
- Phase 2a, the register: cash, simulated card reader and split payments, store discounts, receipts, and camera barcode scanning.
- Phase 2b: sales history by day and search, refunds (card first, then cash, with stock put right and owner approval above the manager limit), and receipts by email or text (previewed in the demo).

- Phase 2c: end of day (drawer count by denomination, card total, over/short and deposit), past orders imported from the old system, and order history on the customer profile.

- Beard Buddy loyalty: customers earn 1 Beard Buck per dollar, trade 100 Bucks for $5 off at the register, and get 100 Bucks in their birthday month.

- Customer sign-in with a one-time code (kept from Phase 4a, the pet store's online booking) for the coming online store.

This started as a pet store POS. Grooming, online booking, the groomer role, pets and vaccinations, and Astro Loyalty have been removed for the board game shop; they're in the git history if they're ever needed. The spec and prototype in `docs/` still describe the pet store.

## Run it

```
npm install
npm run dev      # http://localhost:5173, demo mode
npm test
```

See `CLAUDE.md` for all commands and the repo layout.
