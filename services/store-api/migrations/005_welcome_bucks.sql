-- Beard Buddy replaces the VIP list: joining online gives a welcome gift of Bucks, once per shopper.

ALTER TABLE store_loyalty_ledger DROP CONSTRAINT store_loyalty_ledger_kind_check;
ALTER TABLE store_loyalty_ledger ADD CONSTRAINT store_loyalty_ledger_kind_check
  CHECK (kind IN ('earn', 'birthday', 'redeem', 'take_back', 'give_back', 'adjust', 'welcome'));

CREATE UNIQUE INDEX store_loyalty_ledger_welcome_once ON store_loyalty_ledger (business_id, customer_id)
  WHERE kind = 'welcome';
