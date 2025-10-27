/**
 * Organization Service Interface
 *
 * Abstracts organization ID resolution for multi-tenant architecture.
 * Supports both mock (development) and production (Supabase-based) implementations.
 */

export interface IOrganizationService {
  /**
   * Get the current organization identifier
   *
   * @returns Organization ID from auth claims
   * @throws Error if no organization context available
   */
  getCurrentOrganizationId(): Promise<string>;

  /**
   * Get organization display name
   *
   * @returns Human-readable organization name
   */
  getCurrentOrganizationName(): Promise<string>;

  /**
   * Check if organization context is available
   *
   * @returns true if organization context is set, false otherwise
   */
  hasOrganizationContext(): Promise<boolean>;
}
