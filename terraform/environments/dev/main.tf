# Development Environment Configuration
# This file orchestrates the Supabase infrastructure for the dev environment

terraform {
  required_version = ">= 1.0"

  required_providers {
    supabase = {
      source  = "supabase/supabase"
      version = "~> 1.0"
    }
  }

  # TODO: Configure remote backend (S3, Terraform Cloud, etc.)
  # For now using local backend
  # backend "s3" {
  #   bucket         = "a4c-terraform-state"
  #   key            = "dev/terraform.tfstate"
  #   region         = "us-east-1"
  #   dynamodb_table = "terraform-state-lock"
  #   encrypt        = true
  # }
}

# Configure the Supabase Provider
provider "supabase" {
  access_token = var.supabase_access_token
  project_ref  = var.supabase_project_ref
}

# Import the Supabase module
module "supabase" {
  source = "../../modules/supabase"

  project_ref               = var.supabase_project_ref
  supabase_access_token     = var.supabase_access_token
  supabase_service_role_key = var.supabase_service_role_key
  environment               = "dev"

  # Feature flags
  enable_audit_logs      = true
  enable_api_rate_limits = true
  enable_hateoas         = true
}