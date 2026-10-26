-- Behind the Beard's "Old site" tab: the team's call on each item copied from the Squarespace site
-- (keep, update or drop) with a note. Item ids come from oldSite in @bearded/store-core.
CREATE TABLE store_old_site_choices (
  business_id uuid NOT NULL,
  item_id     text NOT NULL CHECK (length(item_id) BETWEEN 1 AND 80),
  decision    text NOT NULL CHECK (decision IN ('keep', 'update', 'drop')),
  note        text NOT NULL DEFAULT '' CHECK (length(note) <= 1000),
  decided_by  text NOT NULL,
  is_demo     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, item_id)
);

ALTER TABLE store_old_site_choices ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_old_site_choices FORCE ROW LEVEL SECURITY;
CREATE POLICY store_old_site_choices_own ON store_old_site_choices
  USING (business_id = current_business_id()) WITH CHECK (business_id = current_business_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON store_old_site_choices TO pos_app;
CREATE TRIGGER store_old_site_choices_updated_at BEFORE UPDATE ON store_old_site_choices
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
