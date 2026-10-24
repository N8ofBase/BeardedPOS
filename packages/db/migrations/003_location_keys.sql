-- Keys other tables use for (business_id, id) foreign keys.

-- Lets other tables use (business_id, id) foreign keys, so a row can only point
-- at a location in the same business.
ALTER TABLE locations ADD CONSTRAINT locations_business_id_id UNIQUE (business_id, id);
