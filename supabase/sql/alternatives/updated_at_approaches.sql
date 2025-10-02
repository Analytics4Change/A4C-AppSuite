-- Alternative approaches for handling updated_at timestamps

-- OPTION 1: Traditional trigger approach (what we currently have)
-- Pros: Works on all PostgreSQL versions, very explicit
-- Cons: Requires separate trigger for each table
CREATE TRIGGER update_table_updated_at
  BEFORE UPDATE ON table_name
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- OPTION 2: Using DEFAULT for both created and updated
-- Pros: Simple, no triggers needed for creation
-- Cons: Still needs trigger for updates, updated_at not automatically updated
CREATE TABLE example_option2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- OPTION 3: Using a single statement trigger with RETURNING
-- Pros: Can handle in application layer
-- Cons: Requires application logic, not database-enforced
-- Application would need to always include: SET updated_at = NOW()

-- OPTION 4: Create a domain with default (reusable)
CREATE DOMAIN timestamp_auto AS TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE example_option4 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamp_auto,
  updated_at timestamp_auto  -- Still needs trigger for updates
);

-- OPTION 5: Using rules (not recommended, but possible)
-- Pros: Automatic
-- Cons: Rules are deprecated in favor of triggers, can have unexpected behavior
CREATE RULE update_timestamp AS
  ON UPDATE TO table_name
  DO INSTEAD
  UPDATE table_name
  SET updated_at = NOW(),
      -- copy all other columns
  WHERE id = NEW.id;

-- OPTION 6: Computed columns (PostgreSQL 12+ with STORED)
-- Note: This doesn't work for updated_at as it can't reference system time on update
-- GENERATED columns can't use volatile functions like NOW()

-- CONCLUSION: For updated_at that changes on every update,
-- triggers are still the cleanest, most reliable approach in PostgreSQL.
-- However, we can eliminate the trigger function by using inline trigger bodies
-- in PostgreSQL 14+:

-- OPTION 7: Inline trigger body (PostgreSQL 14+)
CREATE TABLE example_modern (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- PostgreSQL 14+ allows inline trigger functions
CREATE TRIGGER update_example_modern_updated_at
  BEFORE UPDATE ON example_modern
  FOR EACH ROW
  EXECUTE FUNCTION (
    BEGIN
      NEW.updated_at = CURRENT_TIMESTAMP;
      RETURN NEW;
    END
  );