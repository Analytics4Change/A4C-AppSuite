/**
 * Configuration utilities
 *
 * Exports configuration validation and resolution functions
 */

// Zod schema and validation
export {
  workflowsEnvSchema,
  validateWorkflowsEnv,
  getWorkflowsEnv,
  resetValidatedEnv,
  type WorkflowsEnv,
  type WorkflowMode,
  type DNSProvider,
  type EmailProvider,
} from './env-schema';

// Business logic validation (uses Zod internally)
export {
  validateConfiguration,
  logConfigurationStatus,
  getResolvedProviders,
  type ProviderType,
  type EmailProviderType
} from './validate-config';

export {
  workflowConfig,
  resetConfig,
  setConfig,
  type RetryConfig
} from './workflow-config';
