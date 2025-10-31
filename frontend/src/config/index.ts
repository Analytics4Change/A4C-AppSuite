/**
 * Configuration Barrel Export
 *
 * Centralizes exports for cleaner imports throughout the application.
 * Usage: import { appConfig } from '@/config';
 */

// Application Configuration
export { appConfig } from './app.config';
export type { DevProfile, AppConfig } from './app.config';

// Authentication Configuration
export { getDevAuthConfig, DEV_USER_PROFILES } from './dev-auth.config';
export type { DevAuthConfig } from './dev-auth.config';

// Logging Configuration
export { getLoggingConfig } from './logging.config';

// MobX Configuration
// Note: mobx.config applies configuration on import, no exports needed

// OAuth Configuration
export { oauthConfig } from './oauth.config';

// Permissions Configuration
export { PERMISSIONS } from './permissions.config';
export type { Permission } from './permissions.config';

// Roles Configuration
export {
  CANONICAL_ROLES,
  ROLE_HIERARCHY,
  getRolePermissions
} from './roles.config';
export type { RoleDefinition } from './roles.config';

// Deployment Configuration
export {
  getDeploymentConfig,
  getAppMode
} from './deployment.config';
export type { AppMode, DeploymentConfig } from './deployment.config';

// Timings Configuration
export { TIMINGS } from './timings';

// Medication Search Configuration
export { API_CONFIG, INDEXED_DB_CONFIG } from './medication-search.config';
