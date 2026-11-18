-- PIN sign-in for the hosted register. An owner or manager sets up a counter tablet once (after an email
-- code); on that tablet, staff tap their name and enter a PIN. PINs work only on a set-up tablet, so they
-- can't be guessed from anywhere else. Only hashes are kept.

CREATE TABLE staff_pins (
  business_id  uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  staff_id     uuid NOT NULL,
  -- scrypt$<salt>$<hash>, both base64url.
  pin_hash     text NOT NULL,
  failed_tries integer NOT NULL DEFAULT 0 CHECK (failed_tries >= 0),
  locked_until timestamptz,
  is_demo      boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, staff_id),
  FOREIGN KEY (business_id, staff_id) REFERENCES staff (business_id, id) ON DELETE CASCADE
);

CREATE TABLE pos_tablets (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  name         text NOT NULL CHECK (length(trim(name)) > 0),
  token_hash   text NOT NULL UNIQUE,
  set_up_by    uuid NOT NULL,
  expires_at   timestamptz NOT NULL,
  last_used_at timestamptz,
  is_demo      boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, id),
  FOREIGN KEY (business_id, set_up_by) REFERENCES staff (business_id, id) ON DELETE CASCADE
);
CREATE INDEX pos_tablets_business ON pos_tablets (business_id);

-- A PIN session belongs to its tablet: removing the tablet signs out whoever is on it.
ALTER TABLE pos_staff_sessions ADD COLUMN tablet_id uuid;
ALTER TABLE pos_staff_sessions ADD FOREIGN KEY (business_id, tablet_id)
  REFERENCES pos_tablets (business_id, id) ON DELETE CASCADE;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['staff_pins', 'pos_tablets'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (business_id = current_business_id()) WITH CHECK (business_id = current_business_id())', t || '_own', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t || '_updated_at', t);
  END LOOP;
END
$$;
GRANT SELECT, INSERT, UPDATE, DELETE ON staff_pins, pos_tablets TO pos_app;
