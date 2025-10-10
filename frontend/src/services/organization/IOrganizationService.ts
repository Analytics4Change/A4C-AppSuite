/**
 * Organization Service Interface
 *
 * Abstracts organization ID resolution for multi-tenant architecture.
 * Supports both mock (development) and production (Zitadel-based) implementations.
 */

export interface IOrganizationService {
  /**
   * Get the current organization identifier
   *
   * @returns Organization external ID (e.g., 'mock-dev-org' or Zitadel organization ID)
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
