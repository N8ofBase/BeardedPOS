-- End-of-day drawer counts, and past orders imported from the old system.

-- Starting cash left in the drawer each morning.
ALTER TABLE businesses ADD COLUMN drawer_float_cents integer NOT NULL DEFAULT 10000
  CHECK (drawer_float_cents >= 0);

CREATE TABLE drawer_counts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id      uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  location_id      uuid NOT NULL,
  business_date    date NOT NULL,
  staff_id         uuid,
  starting_cents   integer NOT NULL CHECK (starting_cents >= 0),
  cash_in_cents    integer NOT NULL CHECK (cash_in_cents >= 0),
  cash_out_cents   integer NOT NULL CHECK (cash_out_cents >= 0),
  expected_cents   integer NOT NULL,
  counted_cents    integer NOT NULL CHECK (counted_cents >= 0),
  over_short_cents integer NOT NULL,
  card_cents       integer NOT NULL,
  -- Count per denomination in cents ({"2000": 7, "25": 12}); null when a total was typed.
  denominations    jsonb,
  note             text,
  is_demo          boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT drawer_counts_business_id_id UNIQUE (business_id, id),
  CONSTRAINT drawer_counts_math CHECK (
    expected_cents = starting_cents + cash_in_cents - cash_out_cents
    AND over_short_cents = counted_cents - expected_cents
  ),
  FOREIGN KEY (business_id, location_id) REFERENCES locations (business_id, id),
  FOREIGN KEY (business_id, staff_id) REFERENCES staff (business_id, id) ON DELETE SET NULL (staff_id)
);
CREATE INDEX drawer_counts_day ON drawer_counts (business_id, business_date DESC, created_at DESC);
ALTER TABLE drawer_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE drawer_counts FORCE ROW LEVEL SECURITY;
CREATE POLICY drawer_counts_own ON drawer_counts
  USING (business_id = current_business_id())
  WITH CHECK (business_id = current_business_id());
REVOKE UPDATE, DELETE ON drawer_counts FROM pos_app;

-- Imported orders keep the old system's receipt number (or "date:YYYY-MM-DD" when the
-- file has none) as import_key, and take no number from our receipt counter.
ALTER TABLE sales ALTER COLUMN receipt_number DROP NOT NULL;
ALTER TABLE sales ADD CONSTRAINT sales_register_numbered
  CHECK (source = 'import' OR receipt_number IS NOT NULL);
ALTER TABLE sales ADD COLUMN import_key text;
ALTER TABLE sales ADD CONSTRAINT sales_import_key
  CHECK ((source = 'import') = (import_key IS NOT NULL));
ALTER TABLE sales ADD COLUMN import_batch_id uuid REFERENCES import_batches (id) ON DELETE SET NULL;
CREATE UNIQUE INDEX sales_import_once ON sales (business_id, customer_id, import_key)
  WHERE source = 'import';
CREATE INDEX sales_customer_history ON sales (business_id, customer_id, created_at DESC)
  WHERE customer_id IS NOT NULL;

ALTER TABLE import_batches DROP CONSTRAINT import_batches_type_check;
ALTER TABLE import_batches ADD CONSTRAINT import_batches_type_check
  CHECK (type IN ('customers', 'pets', 'products', 'programs', 'punches', 'orders'));
ALTER TABLE import_changes DROP CONSTRAINT import_changes_entity_check;
ALTER TABLE import_changes ADD CONSTRAINT import_changes_entity_check
  CHECK (entity IN ('customer', 'pet', 'vaccination', 'product', 'program', 'punch', 'stock', 'sale'));

-- The app role can't delete sales. Undoing an order import may delete only imported
-- orders, in the current business; their lines go with them.
CREATE FUNCTION delete_imported_sale(p_id uuid) RETURNS boolean
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = public
  AS $$
  WITH d AS (
    DELETE FROM sales
    WHERE id = p_id AND source = 'import' AND business_id = current_business_id()
    RETURNING 1
  )
  SELECT count(*) > 0 FROM d
$$;
