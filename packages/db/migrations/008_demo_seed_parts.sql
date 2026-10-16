-- Which sets of sample data have been loaded for a demo business, so a set loads
-- once: deleting the sample customers doesn't bring them back on the next visit.
-- Written only by the seed (database owner).

CREATE TABLE demo_seed_parts (
  business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  part        text NOT NULL,
  seeded_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, part)
);
ALTER TABLE demo_seed_parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE demo_seed_parts FORCE ROW LEVEL SECURITY;
CREATE POLICY demo_seed_parts_own ON demo_seed_parts
  USING (business_id = current_business_id())
  WITH CHECK (business_id = current_business_id());
REVOKE INSERT, UPDATE, DELETE ON demo_seed_parts FROM pos_app;
