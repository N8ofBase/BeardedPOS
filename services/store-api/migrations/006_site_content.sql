-- Site content staff edit in Behind the Beard: a draft, the published version shoppers see, every
-- earlier publish (append-only, so any version can come back), and uploaded pictures.
-- Content is only the fields staff changed (see siteContent in @bearded/store-core).

CREATE TABLE store_site_content (
  business_id uuid NOT NULL,
  version     text NOT NULL CHECK (version IN ('draft', 'published')),
  content     jsonb NOT NULL DEFAULT '{}'::jsonb,
  saved_by    text NOT NULL,
  is_demo     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, version)
);

CREATE TABLE store_site_publishes (
  id           uuid NOT NULL DEFAULT gen_random_uuid(),
  business_id  uuid NOT NULL,
  content      jsonb NOT NULL,
  changes      integer NOT NULL CHECK (changes >= 0),
  published_by text NOT NULL,
  is_demo      boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, id)
);
CREATE INDEX store_site_publishes_recent ON store_site_publishes (business_id, created_at DESC);

CREATE TABLE store_site_images (
  id           uuid NOT NULL DEFAULT gen_random_uuid(),
  business_id  uuid NOT NULL,
  content_type text NOT NULL CHECK (content_type IN ('image/webp', 'image/jpeg', 'image/png')),
  bytes        bytea NOT NULL CHECK (octet_length(bytes) BETWEEN 1 AND 2097152),
  uploaded_by  text NOT NULL,
  is_demo      boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, id)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['store_site_content', 'store_site_publishes', 'store_site_images'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (business_id = current_business_id()) WITH CHECK (business_id = current_business_id())', t || '_own', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO pos_app', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t || '_updated_at', t);
  END LOOP;
END
$$;

-- Publishes and pictures are never changed once written: a new picture is a new row.
REVOKE UPDATE, DELETE ON store_site_publishes FROM pos_app;
REVOKE UPDATE, DELETE ON store_site_images FROM pos_app;
