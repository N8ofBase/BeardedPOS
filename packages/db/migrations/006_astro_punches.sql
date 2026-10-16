-- Astro frequent buyer punches per customer per program. The balance is the
-- running total: earned + opening balance − redeemed.

CREATE TABLE astro_punches (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  customer_id uuid NOT NULL,
  program_id  uuid NOT NULL,
  -- The sale that earned or redeemed it (Phase 2). Empty for opening balances.
  sale_id     uuid,
  qty         integer NOT NULL CHECK (qty > 0),
  -- opening_balance: credit carried over from before this system (import or demo).
  kind        text NOT NULL CHECK (kind IN ('earn', 'redeem', 'opening_balance')),
  is_demo     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (business_id, customer_id) REFERENCES customers (business_id, id) ON DELETE CASCADE,
  FOREIGN KEY (business_id, program_id) REFERENCES astro_programs (business_id, id) ON DELETE CASCADE
);
CREATE INDEX astro_punches_customer ON astro_punches (customer_id, program_id);
ALTER TABLE astro_punches ENABLE ROW LEVEL SECURITY;
ALTER TABLE astro_punches FORCE ROW LEVEL SECURITY;
CREATE POLICY astro_punches_own ON astro_punches
  USING (business_id = current_business_id())
  WITH CHECK (business_id = current_business_id());

-- security_invoker: the caller's row-level security applies through the view.
CREATE VIEW astro_balances WITH (security_invoker = true) AS
  SELECT business_id,
         customer_id,
         program_id,
         sum(CASE WHEN kind = 'redeem' THEN -qty ELSE qty END)::integer AS balance
  FROM astro_punches
  GROUP BY business_id, customer_id, program_id;
GRANT SELECT ON astro_balances TO pos_app;
