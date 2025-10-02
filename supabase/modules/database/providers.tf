# Main configuration for the Supabase module
# This module manages all Supabase resources

terraform {
  required_providers {
    supabase = {
      source  = "supabase/supabase"
      version = "~> 1.0"
    }
  }
}

# Local variables
locals {
  common_tags = {
    ManagedBy = "Terraform"
    Project   = "A4C"
  }
}