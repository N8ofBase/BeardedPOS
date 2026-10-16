-- Astro frequent buyer programs the store is enrolled in (mirrors Astro's own list).

-- Lets other tables use (business_id, id) foreign keys, so a row can only point
-- at a location in the same business.
ALTER TABLE locations ADD CONSTRAINT locations_business_id_id UNIQUE (business_id, id);

CREATE TABLE astro_programs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id       uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  name              text NOT NULL CHECK (length(trim(name)) > 0),
  brand             text,
  buy_count         integer NOT NULL CHECK (buy_count >= 2),
  reward_text       text NOT NULL DEFAULT 'Reward',
  -- Astro's own id for the program, once the live API is connected.
  astro_program_ref text,
  active            boolean NOT NULL DEFAULT true,
  is_demo           boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT astro_programs_business_id_id UNIQUE (business_id, id)
);
CREATE UNIQUE INDEX astro_programs_name_per_business ON astro_programs (business_id, lower(name));
CREATE TRIGGER astro_programs_updated_at BEFORE UPDATE ON astro_programs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE astro_programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE astro_programs FORCE ROW LEVEL SECURITY;
CREATE POLICY astro_programs_own ON astro_programs
  USING (business_id = current_business_id())
  WITH CHECK (business_id = current_business_id());
