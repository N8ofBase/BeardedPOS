-- Grooming: the service menu, groomer hours and time off, and appointments.
-- A groomer can't be double-booked: the database refuses overlapping appointments.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Who grooms: the Groomer role, plus anyone the owner ticks (an owner who grooms).
ALTER TABLE staff ADD COLUMN grooms boolean NOT NULL DEFAULT false;
UPDATE staff SET grooms = true WHERE role = 'groomer';

CREATE TABLE services (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  name            text NOT NULL CHECK (length(trim(name)) > 0),
  kind            text NOT NULL CHECK (kind IN ('main', 'addon')),
  description     text,
  price_s_cents   integer NOT NULL CHECK (price_s_cents >= 0),
  price_m_cents   integer NOT NULL CHECK (price_m_cents >= 0),
  price_l_cents   integer NOT NULL CHECK (price_l_cents >= 0),
  price_xl_cents  integer NOT NULL CHECK (price_xl_cents >= 0),
  minutes_s       integer NOT NULL CHECK (minutes_s >= 0 AND minutes_s <= 720),
  minutes_m       integer NOT NULL CHECK (minutes_m >= 0 AND minutes_m <= 720),
  minutes_l       integer NOT NULL CHECK (minutes_l >= 0 AND minutes_l <= 720),
  minutes_xl      integer NOT NULL CHECK (minutes_xl >= 0 AND minutes_xl <= 720),
  buffer_minutes  integer NOT NULL DEFAULT 0 CHECK (buffer_minutes >= 0 AND buffer_minutes <= 240),
  -- Phase 4 (online booking).
  deposit_cents   integer NOT NULL DEFAULT 0 CHECK (deposit_cents >= 0),
  online          boolean NOT NULL DEFAULT true,
  active          boolean NOT NULL DEFAULT true,
  archived_at     timestamptz,
  position        integer NOT NULL DEFAULT 0,
  is_demo         boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT services_business_id_id UNIQUE (business_id, id)
);
CREATE UNIQUE INDEX services_name_per_business ON services (business_id, lower(name)) WHERE archived_at IS NULL;
CREATE TRIGGER services_updated_at BEFORE UPDATE ON services
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE services ENABLE ROW LEVEL SECURITY;
ALTER TABLE services FORCE ROW LEVEL SECURITY;
CREATE POLICY services_own ON services
  USING (business_id = current_business_id())
  WITH CHECK (business_id = current_business_id());
REVOKE DELETE ON services FROM pos_app;

-- Weekly hours, one row per groomer per weekday they work (0 = Sunday).
CREATE TABLE groomer_hours (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  staff_id    uuid NOT NULL,
  weekday     smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time  time NOT NULL,
  end_time    time NOT NULL,
  is_demo     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT groomer_hours_order CHECK (end_time > start_time),
  CONSTRAINT groomer_hours_once UNIQUE (staff_id, weekday),
  FOREIGN KEY (business_id, staff_id) REFERENCES staff (business_id, id) ON DELETE CASCADE
);
CREATE TRIGGER groomer_hours_updated_at BEFORE UPDATE ON groomer_hours
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE groomer_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE groomer_hours FORCE ROW LEVEL SECURITY;
CREATE POLICY groomer_hours_own ON groomer_hours
  USING (business_id = current_business_id())
  WITH CHECK (business_id = current_business_id());

CREATE TABLE time_off (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  staff_id    uuid NOT NULL,
  starts_at   timestamptz NOT NULL,
  ends_at     timestamptz NOT NULL,
  note        text,
  is_demo     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT time_off_order CHECK (ends_at > starts_at),
  FOREIGN KEY (business_id, staff_id) REFERENCES staff (business_id, id) ON DELETE CASCADE
);
CREATE INDEX time_off_staff ON time_off (staff_id, starts_at);
CREATE TRIGGER time_off_updated_at BEFORE UPDATE ON time_off
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE time_off ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_off FORCE ROW LEVEL SECURITY;
CREATE POLICY time_off_own ON time_off
  USING (business_id = current_business_id())
  WITH CHECK (business_id = current_business_id());

CREATE TABLE appointments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  location_id   uuid NOT NULL,
  customer_id   uuid,
  pet_id        uuid,
  staff_id      uuid NOT NULL,
  service_id    uuid NOT NULL,
  -- Copied when booked, so a later menu change doesn't change the appointment.
  service_name  text NOT NULL,
  pet_name      text NOT NULL,
  size          text NOT NULL CHECK (size IN ('S', 'M', 'L', 'XL')),
  starts_at     timestamptz NOT NULL,
  ends_at       timestamptz NOT NULL,
  -- ends_at plus the service's buffer: the groomer is busy until then.
  block_ends_at timestamptz NOT NULL,
  status        text NOT NULL DEFAULT 'booked'
    CHECK (status IN ('booked', 'checked_in', 'in_progress', 'ready', 'done', 'no_show', 'canceled')),
  price_cents   integer NOT NULL CHECK (price_cents >= 0),
  notes         text,
  created_by    uuid,
  checked_in_at timestamptz,
  started_at    timestamptz,
  ready_at      timestamptz,
  done_at       timestamptz,
  canceled_at   timestamptz,
  -- The sale that paid for it (3b) and the deposit (Phase 4).
  sale_id       uuid,
  deposit_payment_id uuid,
  is_demo       boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT appointments_business_id_id UNIQUE (business_id, id),
  CONSTRAINT appointments_order CHECK (ends_at > starts_at AND block_ends_at >= ends_at),
  CONSTRAINT appointments_no_double_booking EXCLUDE USING gist (
    staff_id WITH =,
    tstzrange(starts_at, block_ends_at) WITH &&
  ) WHERE (status NOT IN ('canceled', 'no_show')),
  FOREIGN KEY (business_id, location_id) REFERENCES locations (business_id, id),
  -- Deleting a customer cancels upcoming appointments; past ones keep a blank customer.
  FOREIGN KEY (business_id, customer_id) REFERENCES customers (business_id, id) ON DELETE SET NULL (customer_id),
  FOREIGN KEY (business_id, pet_id) REFERENCES pets (business_id, id) ON DELETE SET NULL (pet_id),
  FOREIGN KEY (business_id, staff_id) REFERENCES staff (business_id, id),
  FOREIGN KEY (business_id, service_id) REFERENCES services (business_id, id),
  FOREIGN KEY (business_id, created_by) REFERENCES staff (business_id, id) ON DELETE SET NULL (created_by),
  FOREIGN KEY (business_id, sale_id) REFERENCES sales (business_id, id) ON DELETE SET NULL (sale_id)
);
CREATE INDEX appointments_day ON appointments (business_id, starts_at);
CREATE INDEX appointments_customer ON appointments (customer_id, starts_at) WHERE customer_id IS NOT NULL;
CREATE TRIGGER appointments_updated_at BEFORE UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments FORCE ROW LEVEL SECURITY;
CREATE POLICY appointments_own ON appointments
  USING (business_id = current_business_id())
  WITH CHECK (business_id = current_business_id());
REVOKE DELETE ON appointments FROM pos_app;

-- Add-ons on an appointment, copied like sale lines.
CREATE TABLE appointment_addons (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id    uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  appointment_id uuid NOT NULL,
  service_id     uuid NOT NULL,
  name           text NOT NULL,
  price_cents    integer NOT NULL CHECK (price_cents >= 0),
  minutes        integer NOT NULL CHECK (minutes >= 0),
  is_demo        boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (business_id, appointment_id) REFERENCES appointments (business_id, id) ON DELETE CASCADE,
  FOREIGN KEY (business_id, service_id) REFERENCES services (business_id, id)
);
CREATE INDEX appointment_addons_appt ON appointment_addons (appointment_id);
ALTER TABLE appointment_addons ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointment_addons FORCE ROW LEVEL SECURITY;
CREATE POLICY appointment_addons_own ON appointment_addons
  USING (business_id = current_business_id())
  WITH CHECK (business_id = current_business_id());

-- "Remove demo data": the app role can't delete appointments or services, so this
-- removes only the sample ones (is_demo) in the current business. A sample service
-- someone booked for real is archived instead, so that appointment keeps its service.
CREATE FUNCTION remove_demo_grooming() RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
  AS $$
DECLARE
  n integer;
BEGIN
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
