-- The register and the store's Square account kept in step. Square is the home for items, prices
-- and stock: a sync copies them in, and each register stock change is queued here to send back to
-- Square's Inventory API. Customers are matched on phone, then email, and linked by Square's id.

ALTER TABLE products ADD COLUMN square_variation_id text;
-- Only variations Square counts get stock changes sent: an adjustment would turn counting on.
ALTER TABLE products ADD COLUMN square_tracks_stock boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX products_square_variation ON products (business_id, square_variation_id)
  WHERE square_variation_id IS NOT NULL;

ALTER TABLE customers ADD COLUMN square_customer_id text;
CREATE UNIQUE INDEX customers_square_customer ON customers (business_id, square_customer_id)
  WHERE square_customer_id IS NOT NULL;

-- Moves Square already has: counts copied from Square, and website orders Square itself took off.
ALTER TABLE inventory_moves ADD COLUMN from_square boolean NOT NULL DEFAULT false;

-- Register stock changes waiting to go to Square, oldest first. Each is sent once (its id is the
-- idempotency key), retried on failure, and given up on after 10 tries.
CREATE TABLE square_stock_sends (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id         uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  move_id             uuid NOT NULL UNIQUE REFERENCES inventory_moves (id) ON DELETE CASCADE,
  product_id          uuid NOT NULL,
  square_variation_id text NOT NULL,
  qty_change          integer NOT NULL CHECK (qty_change <> 0),
  status              text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'sent', 'failed')),
  tries               integer NOT NULL DEFAULT 0 CHECK (tries >= 0),
  last_error          text,
  sent_at             timestamptz,
  is_demo             boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (business_id, product_id) REFERENCES products (business_id, id) ON DELETE CASCADE
);
CREATE INDEX square_stock_sends_waiting ON square_stock_sends (business_id, created_at)
  WHERE status = 'waiting';

-- Each sync that changed the register: who ran it and what it did.
CREATE TABLE square_sync_runs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  staff_id    uuid,
  summary     jsonb NOT NULL,
  is_demo     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (business_id, staff_id) REFERENCES staff (business_id, id) ON DELETE SET NULL (staff_id)
);
CREATE INDEX square_sync_runs_recent ON square_sync_runs (business_id, created_at DESC);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['square_stock_sends', 'square_sync_runs'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (business_id = current_business_id()) WITH CHECK (business_id = current_business_id())', t || '_own', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t || '_updated_at', t);
  END LOOP;
END
$$;
REVOKE UPDATE, DELETE ON square_sync_runs FROM pos_app;

-- Queues every register stock change of a product linked to Square, in the same transaction, so
-- none is missed. Moves Square already has (from_square) aren't sent back.
CREATE FUNCTION queue_square_stock_send() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
  AS $$
DECLARE v text;
BEGIN
  IF NEW.from_square THEN
    RETURN NEW;
  END IF;
  SELECT square_variation_id INTO v FROM products
    WHERE id = NEW.product_id AND business_id = NEW.business_id AND square_tracks_stock;
  IF v IS NOT NULL THEN
    INSERT INTO square_stock_sends (business_id, move_id, product_id, square_variation_id, qty_change, is_demo)
    VALUES (NEW.business_id, NEW.id, NEW.product_id, v, NEW.qty_change, NEW.is_demo);
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER inventory_moves_square AFTER INSERT ON inventory_moves
  FOR EACH ROW EXECUTE FUNCTION queue_square_stock_send();
