-- Grooming checkout at the register, grooming notes and photos, and back-bar supplies.

-- Many states don't tax pet grooming; some do. The owner checks theirs.
ALTER TABLE businesses ADD COLUMN grooming_taxable boolean NOT NULL DEFAULT false;

-- A sale line is a product or a groom.
ALTER TABLE sale_lines ADD CONSTRAINT sale_lines_appointment
  FOREIGN KEY (business_id, appointment_id) REFERENCES appointments (business_id, id) ON DELETE SET NULL (appointment_id);
CREATE INDEX sale_lines_appointment ON sale_lines (appointment_id) WHERE appointment_id IS NOT NULL;

-- When the groom's back-bar supplies came off stock, so they come off once.
ALTER TABLE appointments ADD COLUMN supplies_used_at timestamptz;

-- Supplies used in grooming and not sold; counted in their own unit ("oz", "each").
ALTER TABLE products ADD COLUMN back_bar boolean NOT NULL DEFAULT false;
ALTER TABLE products ADD COLUMN unit text CHECK (unit IS NULL OR length(trim(unit)) BETWEEN 1 AND 12);

-- Supplies a service uses, by pet size, in whole units of the product.
CREATE TABLE service_supplies (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  service_id  uuid NOT NULL,
  product_id  uuid NOT NULL,
  qty_s       integer NOT NULL CHECK (qty_s >= 0 AND qty_s <= 10000),
  qty_m       integer NOT NULL CHECK (qty_m >= 0 AND qty_m <= 10000),
  qty_l       integer NOT NULL CHECK (qty_l >= 0 AND qty_l <= 10000),
  qty_xl      integer NOT NULL CHECK (qty_xl >= 0 AND qty_xl <= 10000),
  is_demo     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_supplies_once UNIQUE (service_id, product_id),
  FOREIGN KEY (business_id, service_id) REFERENCES services (business_id, id) ON DELETE CASCADE,
  FOREIGN KEY (business_id, product_id) REFERENCES products (business_id, id) ON DELETE CASCADE
);
CREATE TRIGGER service_supplies_updated_at BEFORE UPDATE ON service_supplies
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE service_supplies ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_supplies FORCE ROW LEVEL SECURITY;
CREATE POLICY service_supplies_own ON service_supplies
  USING (business_id = current_business_id())
  WITH CHECK (business_id = current_business_id());

-- Notes a groomer writes about a groom, shown on the pet's grooming history.
CREATE TABLE grooming_notes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id    uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  pet_id         uuid NOT NULL,
  appointment_id uuid,
  staff_id       uuid,
  note           text NOT NULL CHECK (length(note) <= 2000),
  is_demo        boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT grooming_notes_business_id_id UNIQUE (business_id, id),
  FOREIGN KEY (business_id, pet_id) REFERENCES pets (business_id, id) ON DELETE CASCADE,
  FOREIGN KEY (business_id, appointment_id) REFERENCES appointments (business_id, id) ON DELETE SET NULL (appointment_id),
  FOREIGN KEY (business_id, staff_id) REFERENCES staff (business_id, id) ON DELETE SET NULL (staff_id)
);
CREATE INDEX grooming_notes_pet ON grooming_notes (pet_id, created_at DESC);
CREATE INDEX grooming_notes_appt ON grooming_notes (appointment_id) WHERE appointment_id IS NOT NULL;
ALTER TABLE grooming_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE grooming_notes FORCE ROW LEVEL SECURITY;
CREATE POLICY grooming_notes_own ON grooming_notes
  USING (business_id = current_business_id())
  WITH CHECK (business_id = current_business_id());
REVOKE UPDATE ON grooming_notes FROM pos_app;

-- Before and after photos. Demo mode keeps a resized JPEG in image_data; hosted mode
-- keeps it in S3 and stores only storage_key.
CREATE TABLE grooming_photos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  note_id     uuid NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('before', 'after')),
  image_data  text CHECK (image_data IS NULL OR length(image_data) <= 400000),
  storage_key text,
  width       integer NOT NULL CHECK (width > 0),
  height      integer NOT NULL CHECK (height > 0),
  bytes       integer NOT NULL CHECK (bytes > 0),
  is_demo     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT grooming_photos_stored CHECK ((image_data IS NULL) <> (storage_key IS NULL)),
  FOREIGN KEY (business_id, note_id) REFERENCES grooming_notes (business_id, id) ON DELETE CASCADE
);
CREATE INDEX grooming_photos_note ON grooming_photos (note_id);
ALTER TABLE grooming_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE grooming_photos FORCE ROW LEVEL SECURITY;
CREATE POLICY grooming_photos_own ON grooming_photos
  USING (business_id = current_business_id())
  WITH CHECK (business_id = current_business_id());
REVOKE UPDATE ON grooming_photos FROM pos_app;

-- Remove demo data also removes sample notes and supply links (the app can't
-- delete notes made under appointments it no longer has).
CREATE OR REPLACE FUNCTION remove_demo_grooming() RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
  AS $$
DECLARE
  n integer;
BEGIN
  DELETE FROM grooming_notes WHERE is_demo AND business_id = current_business_id();
  DELETE FROM service_supplies WHERE is_demo AND business_id = current_business_id();
  DELETE FROM appointments WHERE is_demo AND business_id = current_business_id();
  GET DIAGNOSTICS n = ROW_COUNT;
  UPDATE services SET archived_at = coalesce(archived_at, now()), active = false
  WHERE is_demo AND business_id = current_business_id()
    AND (id IN (SELECT service_id FROM appointments) OR id IN (SELECT service_id FROM appointment_addons));
  DELETE FROM services WHERE is_demo AND business_id = current_business_id() AND archived_at IS NULL;
  DELETE FROM groomer_hours WHERE is_demo AND business_id = current_business_id();
  DELETE FROM time_off WHERE is_demo AND business_id = current_business_id();
  RETURN n;
END
$$;
