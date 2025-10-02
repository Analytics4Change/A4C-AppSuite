# Input variables for the Supabase module

variable "project_ref" {
  description = "Supabase project reference ID"
  type        = string
}

variable "supabase_access_token" {
  description = "Supabase management API access token"
  type        = string
  sensitive   = true
}

variable "supabase_service_role_key" {
  description = "Supabase service role key"
  type        = string
  sensitive   = true
}

variable "enable_audit_logs" {
  description = "Enable comprehensive audit logging"
  type        = bool
  default     = true
}

variable "enable_api_rate_limits" {
  description = "Enable API rate limiting"
  type        = bool
  default     = true
}

variable "enable_hateoas" {
  description = "Enable HATEOAS REST implementation"
  type        = bool
  default     = false
}