# Outputs from the Supabase module

output "project_url" {
  description = "The Supabase project URL"
  value       = "https://${var.project_ref}.supabase.co"
}

output "project_ref" {
  description = "The Supabase project reference"
  value       = var.project_ref
}

output "api_url" {
  description = "The Supabase REST API URL"
  value       = "https://${var.project_ref}.supabase.co/rest/v1"
}

output "auth_url" {
  description = "The Supabase Auth URL"
  value       = "https://${var.project_ref}.supabase.co/auth/v1"
}

output "storage_url" {
  description = "The Supabase Storage URL"
  value       = "https://${var.project_ref}.supabase.co/storage/v1"
}

output "realtime_url" {
  description = "The Supabase Realtime URL"
  value       = "wss://${var.project_ref}.supabase.co/realtime/v1"
}