/**
 * Core configuration types for documentation scripts
 */

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

export interface LoggingConfig {
  level: LogLevel;
  enableColors: boolean;
  enableTimestamps: boolean;
  format: 'simple' | 'json' | 'structured';
}

export interface PerformanceConfig {
  concurrency: number;
  timeoutMs: number;
  retryAttempts: number;
  retryDelayMs: number;
}

export interface SecurityConfig {
  allowedPaths: string[];
  maxPathDepth: number;
  enablePathValidation: boolean;
  sanitizeCommands: boolean;
}

export interface ProgressConfig {
  style: 'bar' | 'spinner' | 'dots' | 'none';
  showPercentage: boolean;
  showEta: boolean;
  refreshRate: number;
}

export interface CacheConfig {
  enabled: boolean;
  ttlMs: number;
  maxSize: number;
  persistToDisk: boolean;
}

export interface ValidationConfig {
  enabled: boolean;
  strictMode: boolean;
  customRules: string[];
  excludePatterns: string[];
}

export interface DocumentationConfig {
  baseDir: string;
  outputDir: string;
  templatesDir: string;
  includePatterns: string[];
  excludePatterns: string[];
  generateMetrics: boolean;
  validateLinks: boolean;
}

/**
 * Main configuration interface that combines all subsystems
 */
export interface ScriptConfig {
  logging: LoggingConfig;
  performance: PerformanceConfig;
  security: SecurityConfig;
  progress: ProgressConfig;
  cache: CacheConfig;
  validation: ValidationConfig;
  documentation: DocumentationConfig;
}

/**
 * Environment-specific configuration overrides
 */
export interface EnvironmentConfig {
  development?: Partial<ScriptConfig>;
  test?: Partial<ScriptConfig>;
  production?: Partial<ScriptConfig>;
  ci?: Partial<ScriptConfig>;
}

/**
 * Plugin configuration interface
 */
export interface PluginConfig {
  name: string;
  enabled: boolean;
  priority: number;
  options: Record<string, unknown>;
}

/**
 * Configuration for the plugin system
 */
export interface PluginSystemConfig {
  plugins: PluginConfig[];
  autoLoad: boolean;
  pluginPaths: string[];
}