-- Game pricing and royalties: the price stores pay, who earns a royalty and at what
-- rate, and what each unit cost us at the moment it sold, so profit never shifts later.

-- What a retailer pays per unit. Blank when the game isn't sold wholesale.
ALTER TABLE products ADD COLUMN wholesale_cents integer CHECK (wholesale_cents IS NULL OR wholesale_cents >= 0);
-- Royalty on net profit, in thousandths of a percent like tax rates: 7.5% = 7500.
ALTER TABLE products ADD COLUMN royalty_mpct integer NOT NULL DEFAULT 0
  CHECK (royalty_mpct BETWEEN 0 AND 100000);
ALTER TABLE products ADD COLUMN royalty_payee text
  CHECK (royalty_payee IS NULL OR length(trim(royalty_payee)) BETWEEN 1 AND 100);

-- Our cost per unit when the line was rung. Null for lines rung before this
-- migration; reports use the product's current cost for those.
ALTER TABLE sale_lines ADD COLUMN unit_cost_cents integer CHECK (unit_cost_cents IS NULL OR unit_cost_cents >= 0);
