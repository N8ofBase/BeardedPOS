-- Store settings: sales tax with three decimals, and a small logo for the demo.

-- Sales tax in thousandths of a percent: 8.875% = 8875, 7% = 7000. Basis points
-- (hundredths) can't hold rates like New York City's 8.875% as a whole number.
ALTER TABLE locations ADD COLUMN tax_rate_mpct integer NOT NULL DEFAULT 0
  CHECK (tax_rate_mpct BETWEEN 0 AND 100000);
UPDATE locations SET tax_rate_mpct = tax_rate_bp * 10;
ALTER TABLE locations DROP COLUMN tax_rate_bp;

-- The logo as a small image (resized in the browser). Hosted mode stores logos in
-- S3 and uses logo_key instead; the demo has no file storage.
ALTER TABLE businesses ADD COLUMN logo_data text
  CHECK (logo_data IS NULL OR (logo_data LIKE 'data:image/%' AND length(logo_data) <= 300000));
