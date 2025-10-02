-- Index on rxnorm_cui
CREATE INDEX IF NOT EXISTS idx_medications_rxnorm ON medications(rxnorm_cui);