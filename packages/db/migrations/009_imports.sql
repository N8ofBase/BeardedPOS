-- Bulk import batches and every change each one made, so a batch can be undone.

CREATE TABLE import_batches (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  type        text NOT NULL CHECK (type IN ('customers', 'products')),
  file_name   text NOT NULL,
  staff_id    uuid REFERENCES staff (id) ON DELETE SET NULL,
  status      text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done', 'undone')),
  total_rows  integer NOT NULL DEFAULT 0 CHECK (total_rows >= 0),
  created     integer NOT NULL DEFAULT 0 CHECK (created >= 0),
  updated     integer NOT NULL DEFAULT 0 CHECK (updated >= 0),
  skipped     integer NOT NULL DEFAULT 0 CHECK (skipped >= 0),
  is_demo     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  undone_at   timestamptz,
  CONSTRAINT import_batches_business_id_id UNIQUE (business_id, id)
);
CREATE INDEX import_batches_recent ON import_batches (business_id, created_at DESC);
CREATE TRIGGER import_batches_updated_at BEFORE UPDATE ON import_batches
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_batches FORCE ROW LEVEL SECURITY;
CREATE POLICY import_batches_own ON import_batches
  USING (business_id = current_business_id())
  WITH CHECK (business_id = current_business_id());

-- One row per change, in order. before/after hold only the columns that changed
-- (or the whole row for created/deleted), so undo can put them back.
CREATE TABLE import_changes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  batch_id    uuid NOT NULL,
  seq         bigint GENERATED ALWAYS AS IDENTITY,
  entity      text NOT NULL CHECK (entity IN ('customer', 'product', 'stock')),
  entity_id   uuid NOT NULL,
  op          text NOT NULL CHECK (op IN ('created', 'updated', 'moved')),
  before      jsonb,
  after       jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (business_id, batch_id) REFERENCES import_batches (business_id, id) ON DELETE CASCADE
);
CREATE INDEX import_changes_batch ON import_changes (batch_id, seq);
ALTER TABLE import_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_changes FORCE ROW LEVEL SECURITY;
CREATE POLICY import_changes_own ON import_changes
  USING (business_id = current_business_id())
  WITH CHECK (business_id = current_business_id());
REVOKE UPDATE, DELETE ON import_changes FROM pos_app;

-- The batch that created a row (spec: Bulk import → data model additions).
ALTER TABLE customers ADD COLUMN import_batch_id uuid REFERENCES import_batches (id) ON DELETE SET NULL;
ALTER TABLE products ADD COLUMN import_batch_id uuid REFERENCES import_batches (id) ON DELETE SET NULL;
