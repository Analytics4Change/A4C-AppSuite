-- Enable ltree extension for hierarchical data structures
-- Required for organization hierarchy management with PostgreSQL ltree
CREATE EXTENSION IF NOT EXISTS ltree;

-- Add comments for documentation
COMMENT ON EXTENSION ltree IS 'Hierarchical tree-like data type for organization paths and permission scoping';