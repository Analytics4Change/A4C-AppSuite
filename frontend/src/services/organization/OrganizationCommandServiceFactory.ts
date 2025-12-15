/**
 * Organization Command Service Factory
 *
 * Factory for creating organization command service instances based on
 * the current application mode (mock, integration, production).
 *
 * Pattern: Factory pattern for dependency injection.
 */

import type { IOrganizationCommandService } from './IOrganizationCommandService';
import { SupabaseOrganizationCommandService } from './SupabaseOrganizationCommandService';
import { MockOrganizationCommandService } from './MockOrganizationCommandService';

/**
 * Creates an organization command service based on application mode
 *
 * @returns IOrganizationCommandService implementation
 *
 * Mode selection:
 * - 'mock': MockOrganizationCommandService (logs only, no network)
 * - 'integration': SupabaseOrganizationCommandService (real Supabase)
 * - 'production': SupabaseOrganizationCommandService (real Supabase)
 */
export function createOrganizationCommandService(): IOrganizationCommandService {
  const authMode = import.meta.env.VITE_AUTH_MODE || 'mock';

  if (authMode === 'mock') {
    return new MockOrganizationCommandService();
  }

  return new SupabaseOrganizationCommandService();
}

// Singleton instance for convenience
let _instance: IOrganizationCommandService | null = null;

/**
 * Gets the singleton organization command service instance
 *
 * Uses lazy initialization - service is created on first access.
 */
export function getOrganizationCommandService(): IOrganizationCommandService {
  if (!_instance) {
    _instance = createOrganizationCommandService();
  }
  return _instance;
}

/**
 * Resets the singleton instance (useful for testing)
 */
export function resetOrganizationCommandService(): void {
  _instance = null;
}
