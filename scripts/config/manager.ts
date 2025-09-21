/**
 * Configuration manager for documentation scripts
 * Handles loading, merging, and accessing configuration values
 */

import { readFile } from 'fs/promises';
import { join, resolve } from 'path';
import { ScriptConfig, EnvironmentConfig, LogLevel } from './types.js';
import { defaultConfig, environmentConfig } from './defaults.js';

export class ConfigManager {
  private config: ScriptConfig;
  private environment: string;
  
  constructor(environment?: string) {
    this.environment = environment || process.env.NODE_ENV || 'development';
    this.config = this.createConfig();
  }
  
  /**
   * Get the current complete configuration
   */
  getConfig(): ScriptConfig {
    return this.config;
  }
  
  /**
   * Get a specific configuration section
   */
  get<K extends keyof ScriptConfig>(section: K): ScriptConfig[K] {
    return this.config[section];
  }
  
  /**
   * Get the current environment
   */
  getEnvironment(): string {
    return this.environment;
  }
  
  /**
   * Check if running in development mode
   */
  isDevelopment(): boolean {
    return this.environment === 'development';
  }
  
  /**
   * Check if running in test mode
   */
  isTest(): boolean {
    return this.environment === 'test';
  }
  
  /**
   * Check if running in production mode
   */
  isProduction(): boolean {
    return this.environment === 'production';
  }
  
  /**
   * Check if running in CI mode
   */
  isCI(): boolean {
    return this.environment === 'ci' || process.env.CI === 'true';
  }
  
  /**
   * Load external configuration from file
   */
  async loadFromFile(configPath: string): Promise<void> {
    try {
      const absolutePath = resolve(configPath);
      const configContent = await readFile(absolutePath, 'utf-8');
      const externalConfig = JSON.parse(configContent);
      
      this.config = this.mergeConfigs(this.config, externalConfig);
    } catch (error) {
      // Silently fail if config file doesn't exist or is invalid
      // This allows the system to work with defaults
      if (this.config.logging.level === 'debug') {
        console.warn(`Could not load config from ${configPath}:`, error);
      }
    }
  }
  
  /**
   * Override specific configuration values
   */
  override(overrides: Partial<ScriptConfig>): void {
    this.config = this.mergeConfigs(this.config, overrides);
  }
  
  /**
   * Create the initial configuration by merging defaults with environment overrides
   */
  private createConfig(): ScriptConfig {
    const envOverrides = environmentConfig[this.environment as keyof EnvironmentConfig];
    
    if (!envOverrides) {
      return { ...defaultConfig };
    }
    
    return this.mergeConfigs(defaultConfig, envOverrides);
  }
  
  /**
   * Deep merge configuration objects
   */
  private mergeConfigs(base: ScriptConfig, overrides: Partial<ScriptConfig>): ScriptConfig {
    const result = { ...base };
    
    for (const key in overrides) {
      const value = overrides[key as keyof ScriptConfig];
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        result[key as keyof ScriptConfig] = {
          ...result[key as keyof ScriptConfig],
          ...value
        } as any;
      } else if (value !== undefined) {
        result[key as keyof ScriptConfig] = value as any;
      }
    }
    
    return result;
  }
  
  /**
   * Validate configuration values
   */
  validate(): string[] {
    const errors: string[] = [];
    
    // Validate logging level
    const validLogLevels: LogLevel[] = ['error', 'warn', 'info', 'debug'];
    if (!validLogLevels.includes(this.config.logging.level)) {
      errors.push(`Invalid log level: ${this.config.logging.level}`);
    }
    
    // Validate performance settings
    if (this.config.performance.concurrency < 1) {
      errors.push('Concurrency must be at least 1');
    }
    
    if (this.config.performance.timeoutMs < 1000) {
      errors.push('Timeout must be at least 1000ms');
    }
    
    // Validate paths
    if (!this.config.documentation.baseDir) {
      errors.push('Documentation base directory must be specified');
    }
    
    return errors;
  }
  
  /**
   * Get configuration as JSON string for debugging
   */
  toJSON(): string {
    return JSON.stringify(this.config, null, 2);
  }
}

// Create a singleton instance for global use
export const configManager = new ConfigManager();