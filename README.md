# Pet store POS & grooming system

Register, inventory, customers and pets, grooming calendar and booking, and Astro Loyalty tracking for an independent pet store.

- `docs/SPEC.md` — the full spec (exported from the spec doc)
- `docs/prototype.html` — working prototype; open it in a browser to see the screens and flows
- `CLAUDE.md` — instructions Claude Code reads at the start of every session

Status: **Phase 1, 2a and 2b are done** in demo mode.
- Phase 1: products and inventory, customers and pets, bulk import, store settings, staff and demo data.
- Phase 2a, the register: cash, simulated card reader and split payments, store discounts, Astro punches, rewards and offers, receipts, and camera barcode scanning.
- Phase 2b: sales history by day and search, refunds (card first, then cash, with stock and Astro punches put right and owner approval above the manager limit), receipts by email or text (previewed in the demo), and the "To enter in Astro" queue.

The demo is live at https://petpos-demo.prismcortex.net. Next: 2c (end-of-day drawer count and order-history import).

## Run it

```
npm install
npm run dev      # http://localhost:5173, demo mode
npm test
```

See `CLAUDE.md` for all commands and the repo layout.
