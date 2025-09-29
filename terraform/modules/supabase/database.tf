# Database tables configuration
# Start with organizations table as our first test

# NOTE: For initial implementation, we'll use SQL scripts via Edge Functions
# The Supabase Terraform provider is still evolving and may not support
# all table operations directly. This is a placeholder structure.

# Organizations table - Core multi-tenancy table
resource "null_resource" "organizations_table" {
  # This is a placeholder - actual implementation depends on provider capabilities
  # In practice, you might need to:
  # 1. Use supabase CLI for migrations
  # 2. Use Edge Functions to run SQL
  # 3. Use the provider's table resource if available

  provisioner "local-exec" {
    command = <<-EOT
      echo "Organizations table would be created here"
      echo "For now, manually create via Supabase Dashboard SQL Editor:"
      echo ""
      cat <<-SQL
        CREATE TABLE IF NOT EXISTS organizations (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          external_id TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL,
          type TEXT NOT NULL CHECK (type IN ('healthcare_facility', 'var', 'admin')),
          metadata JSONB DEFAULT '{}',
          settings JSONB DEFAULT '{}',
          is_active BOOLEAN DEFAULT true,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE INDEX idx_organizations_external_id ON organizations(external_id);
        CREATE INDEX idx_organizations_type ON organizations(type);
        CREATE INDEX idx_organizations_is_active ON organizations(is_active);
      SQL
    EOT
  }
}

# TODO: Add remaining tables from SUPABASE-INVENTORY.md:
# - users
# - clients
# - medications
# - medication_history
# - dosage_info
# - audit_log
# - api_audit_log