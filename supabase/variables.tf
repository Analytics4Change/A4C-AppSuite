# Variable definitions for the development environment
# Actual values are stored in terraform.tfvars (encrypted by git-crypt)

variable "supabase_project_ref" {
  description = "Supabase project reference ID"
  type        = string
  default     = "tmrjlswbsxmbglmaclxu"
}

variable "supabase_access_token" {
  description = "Supabase management API access token"
  type        = string
  sensitive   = true
}

variable "supabase_service_role_key" {
  description = "Supabase service role key for admin operations"
  type        = string
  sensitive   = true
}