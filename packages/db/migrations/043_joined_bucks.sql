-- One Beard Buddy balance everywhere. When the online store shares this database (hosted), its
-- shoppers are joined to register customers by email and their Bucks are written here, beside the
-- counter's: a balance is still the sum of one customer's loyalty_ledger rows. Website orders and
-- sales rung only in the Square app have no register sale, so they're kept by their own ids.

ALTER TABLE loyalty_ledger
  -- The online store's order (store_orders.id). No foreign key: the store's tables aren't here in the demo.
  ADD COLUMN web_order_id    uuid,
  -- A sale rung only in the Square app, matched to the customer by phone or email.
  ADD COLUMN square_order_id text CHECK (square_order_id IS NULL OR length(square_order_id) BETWEEN 1 AND 192);

ALTER TABLE loyalty_ledger DROP CONSTRAINT loyalty_ledger_kind_check;
ALTER TABLE loyalty_ledger ADD CONSTRAINT loyalty_ledger_kind_check
  CHECK (kind IN ('earn', 'birthday', 'redeem', 'take_back', 'give_back', 'adjust', 'welcome'));
ALTER TABLE loyalty_ledger DROP CONSTRAINT loyalty_ledger_sign;
ALTER TABLE loyalty_ledger ADD CONSTRAINT loyalty_ledger_sign CHECK (
  (kind IN ('earn', 'birthday', 'give_back', 'welcome') AND bucks > 0)
  OR (kind IN ('redeem', 'take_back') AND bucks < 0)
  OR kind = 'adjust'
);

-- The website's welcome gift, once per customer.
CREATE UNIQUE INDEX loyalty_ledger_welcome_once ON loyalty_ledger (business_id, customer_id)
  WHERE kind = 'welcome';
-- A website order or a Square app sale earns, redeems and gives a birthday gift at most once each.
CREATE UNIQUE INDEX loyalty_ledger_web_once ON loyalty_ledger (business_id, web_order_id, kind)
  WHERE web_order_id IS NOT NULL AND kind IN ('earn', 'birthday', 'redeem');
CREATE UNIQUE INDEX loyalty_ledger_square_once ON loyalty_ledger (business_id, square_order_id, kind)
  WHERE square_order_id IS NOT NULL AND kind IN ('earn', 'birthday');
