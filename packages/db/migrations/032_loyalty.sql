-- Beard Buddy loyalty: Beard Bucks earned on sales, a birthday gift, and rewards of
-- $5 off per 100 Bucks. The balance is the sum of a customer's ledger entries; entries
-- are never changed, only added (a refund adds a take-back, a void gives a reward back).

ALTER TABLE businesses ADD COLUMN loyalty_enabled boolean NOT NULL DEFAULT true;

CREATE TABLE loyalty_ledger (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  customer_id uuid NOT NULL,
  -- The sale it came from; null for adjustments.
  sale_id     uuid,
  kind        text NOT NULL
    CHECK (kind IN ('earn', 'birthday', 'redeem', 'take_back', 'give_back', 'adjust')),
  bucks       integer NOT NULL CHECK (bucks <> 0 AND bucks BETWEEN -1000000 AND 1000000),
  note        text CHECK (note IS NULL OR length(trim(note)) BETWEEN 1 AND 200),
  staff_id    uuid,
  is_demo     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT loyalty_ledger_sign CHECK (
    (kind IN ('earn', 'birthday', 'give_back') AND bucks > 0)
    OR (kind IN ('redeem', 'take_back') AND bucks < 0)
    OR kind = 'adjust'
  ),
  CONSTRAINT loyalty_ledger_adjust_note CHECK (kind <> 'adjust' OR note IS NOT NULL),
  FOREIGN KEY (business_id, customer_id) REFERENCES customers (business_id, id) ON DELETE CASCADE,
  FOREIGN KEY (business_id, sale_id) REFERENCES sales (business_id, id) ON DELETE CASCADE,
  FOREIGN KEY (business_id, staff_id) REFERENCES staff (business_id, id) ON DELETE SET NULL (staff_id)
);
CREATE INDEX loyalty_ledger_customer ON loyalty_ledger (business_id, customer_id, created_at DESC);
CREATE INDEX loyalty_ledger_sale ON loyalty_ledger (sale_id) WHERE sale_id IS NOT NULL;
ALTER TABLE loyalty_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty_ledger FORCE ROW LEVEL SECURITY;
CREATE POLICY loyalty_ledger_own ON loyalty_ledger
  USING (business_id = current_business_id())
  WITH CHECK (business_id = current_business_id());
REVOKE UPDATE, DELETE ON loyalty_ledger FROM pos_app;
