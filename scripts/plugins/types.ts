/**
 * Plugin system types and interfaces
 * Defines the contract for extensible validators and processors
 */

import { Logger } from '../utils/logger.js';
import { ProgressTracker } from '../utils/progress.js';

/**
 * Plugin execution context provided to all plugins
 */
export interface PluginContext {
  logger: Logger;
  progress?: ProgressTracker;
  config: Record<string, unknown>;
  workingDirectory: string;
  tempDirectory?: string;
}

/**
 * Plugin execution result
 */
export interface PluginResult {
  success: boolean;
  data?: unknown;
  errors: string[];
  warnings: string[];
  metadata: Record<string, unknown>;
}

/**
 * Plugin configuration
 */
export interface PluginConfig {
  name: string;
  enabled: boolean;
  priority: number;
  options: Record<string, unknown>;
  dependencies?: string[];
}

/**
 * Plugin lifecycle hooks
 */
export interface PluginLifecycle {
  onInit?(context: PluginContext): Promise<void>;
  onDestroy?(context: PluginContext): Promise<void>;
  onBeforeExecute?(context: PluginContext): Promise<void>;
  onAfterExecute?(context: PluginContext, result: PluginResult): Promise<void>;
}

/**
 * Base plugin interface
 */
export interface Plugin extends PluginLifecycle {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly dependencies: string[];
  
  execute(context: PluginContext): Promise<PluginResult>;
  validate?(context: PluginContext): Promise<boolean>;
}

/**
 * Validator plugin interface for documentation validation
 */
export interface ValidatorPlugin extends Plugin {
  readonly validatorType: 'syntax' | 'content' | 'structure' | 'links' | 'examples' | 'accessibility';
  readonly supportedFileTypes: string[];
  
  validateFile(filePath: string, content: string, context: PluginContext): Promise<ValidationResult>;
  validateBatch?(files: FileInfo[], context: PluginContext): Promise<ValidationResult[]>;
}

/**
 * Processor plugin interface for document processing
 */
export interface ProcessorPlugin extends Plugin {
  readonly processorType: 'transformer' | 'generator' | 'extractor' | 'formatter';
  readonly inputFormats: string[];
  readonly outputFormats: string[];
  
  processFile(filePath: string, content: string, context: PluginContext): Promise<ProcessResult>;
  processBatch?(files: FileInfo[], context: PluginContext): Promise<ProcessResult[]>;
}

/**
 * File information for batch processing
 */
export interface FileInfo {
  path: string;
  content: string;
  metadata: Record<string, unknown>;
  lastModified: Date;
  size: number;
}

/**
 * Validation result for validator plugins
 */
export interface ValidationResult {
  isValid: boolean;
  filePath: string;
  issues: ValidationIssue[];
  suggestions: string[];
  metadata: Record<string, unknown>;
}

/**
 * Validation issue details
 */
export interface ValidationIssue {
  severity: 'error' | 'warning' | 'info';
  message: string;
  line?: number;
  column?: number;
  rule?: string;
  code?: string;
  context?: string;
}

/**
 * Processing result for processor plugins
 */
export interface ProcessResult {
  success: boolean;
  filePath: string;
  outputPath?: string;
  transformedContent?: string;
  extractedData?: unknown;
  metadata: Record<string, unknown>;
}

/**
 * Plugin registry entry
 */
export interface PluginRegistryEntry {
  plugin: Plugin;
  config: PluginConfig;
  isLoaded: boolean;
  loadError?: Error;
}

/**
 * Plugin discovery result
 */
export interface PluginDiscoveryResult {
  found: string[];
  loaded: PluginRegistryEntry[];
  failed: Array<{ path: string; error: Error }>;
}

/**
 * Plugin execution plan
 */
export interface PluginExecutionPlan {
  plugins: PluginRegistryEntry[];
  dependencies: Map<string, string[]>;
  executionOrder: string[];
}

/**
 * Plugin metrics
 */
export interface PluginMetrics {
  name: string;
  executionCount: number;
  totalExecutionTime: number;
  averageExecutionTime: number;
  successCount: number;
  errorCount: number;
  lastExecuted?: Date;
  lastError?: Error;
}