-- Customers, their pets and the pets' vaccinations.

CREATE TABLE customers (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id       uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  name              text NOT NULL CHECK (length(trim(name)) > 0),
  -- Always 10 digits; formatted only for display.
  phone             text CHECK (phone ~ '^[0-9]{10}$'),
  email             text CHECK (email IS NULL OR email ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
  street            text,
  city              text,
  state             text CHECK (state IS NULL OR state ~ '^[A-Z]{2}$'),
  zip               text CHECK (zip IS NULL OR zip ~ '^[0-9]{5}(-[0-9]{4})?$'),
  birthday          date,
  sms_opt_in        boolean NOT NULL DEFAULT false,
  notes             text,
  astro_customer_id text,
  is_demo           boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  -- Phone is the counter's lookup key, email the fallback; a customer needs one.
  CONSTRAINT customers_contact CHECK (phone IS NOT NULL OR email IS NOT NULL),
  CONSTRAINT customers_business_id_id UNIQUE (business_id, id)
);
CREATE UNIQUE INDEX customers_phone_per_business ON customers (business_id, phone) WHERE phone IS NOT NULL;
CREATE UNIQUE INDEX customers_email_per_business ON customers (business_id, lower(email)) WHERE email IS NOT NULL;
CREATE INDEX customers_name ON customers (business_id, lower(name));
CREATE TRIGGER customers_updated_at BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers FORCE ROW LEVEL SECURITY;
CREATE POLICY customers_own ON customers
  USING (business_id = current_business_id())
  WITH CHECK (business_id = current_business_id());

CREATE TABLE pets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  customer_id uuid NOT NULL,
  name        text NOT NULL CHECK (length(trim(name)) > 0),
  species     text NOT NULL DEFAULT 'dog' CHECK (species IN ('dog', 'cat', 'other')),
  -- Breed for dogs and cats; for Other, what the animal is ("rabbit", "ferret").
  breed       text,
  size        text CHECK (size IN ('S', 'M', 'L', 'XL')),
  coat        text,
  birthday    date,
  weight_lb   numeric(5, 1) CHECK (weight_lb > 0),
  temperament text,
  allergies   text,
  vet_name    text,
  is_demo     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pets_business_id_id UNIQUE (business_id, id),
  FOREIGN KEY (business_id, customer_id) REFERENCES customers (business_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX pets_name_per_customer ON pets (customer_id, lower(name));
CREATE TRIGGER pets_updated_at BEFORE UPDATE ON pets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE pets ENABLE ROW LEVEL SECURITY;
ALTER TABLE pets FORCE ROW LEVEL SECURITY;
CREATE POLICY pets_own ON pets
  USING (business_id = current_business_id())
  WITH CHECK (business_id = current_business_id());

CREATE TABLE vaccinations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id    uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  pet_id         uuid NOT NULL,
  vaccine        text NOT NULL CHECK (length(trim(vaccine)) > 0),
  expires_on     date NOT NULL,
  -- S3 key of the uploaded certificate (Phase 3).
  proof_file_key text,
  is_demo        boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (business_id, pet_id) REFERENCES pets (business_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX vaccinations_one_per_vaccine ON vaccinations (pet_id, lower(vaccine));
CREATE TRIGGER vaccinations_updated_at BEFORE UPDATE ON vaccinations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE vaccinations ENABLE ROW LEVEL SECURITY;
ALTER TABLE vaccinations FORCE ROW LEVEL SECURITY;
CREATE POLICY vaccinations_own ON vaccinations
  USING (business_id = current_business_id())
  WITH CHECK (business_id = current_business_id());
