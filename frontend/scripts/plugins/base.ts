/**
 * Base plugin classes and abstract implementations
 * Provides common functionality for all plugin types
 */

import { Plugin, ValidatorPlugin, ProcessorPlugin, PluginContext, PluginResult, ValidationResult, ProcessResult, ValidationIssue, FileInfo } from './types.js';
import { getLogger } from '../utils/logger.js';

/**
 * Abstract base class for all plugins
 * Provides common functionality and lifecycle management
 */
export abstract class BasePlugin implements Plugin {
  abstract readonly name: string;
  abstract readonly version: string;
  abstract readonly description: string;
  
  readonly dependencies: string[] = [];
  
  protected logger = getLogger('plugin');
  
  /**
   * Initialize the plugin
   */
  async onInit(context: PluginContext): Promise<void> {
    this.logger = context.logger.child({ plugin: this.name });
    this.logger.info('Plugin initialized', { version: this.version });
  }
  
  /**
   * Cleanup plugin resources
   */
  async onDestroy(_context: PluginContext): Promise<void> {
    this.logger.info('Plugin destroyed');
  }
  
  /**
   * Called before plugin execution
   */
  async onBeforeExecute(_context: PluginContext): Promise<void> {
    this.logger.debug('Plugin execution starting');
  }
  
  /**
   * Called after plugin execution
   */
  async onAfterExecute(context: PluginContext, result: PluginResult): Promise<void> {
    this.logger.debug('Plugin execution completed', { 
      success: result.success, 
      errorCount: result.errors.length,
      warningCount: result.warnings.length 
    });
  }
  
  /**
   * Validate plugin configuration and environment
   */
  async validate(context: PluginContext): Promise<boolean> {
    try {
      // Basic validation - override in subclasses for specific checks
      if (!this.name || !this.version) {
        this.logger.error('Plugin missing required name or version');
        return false;
      }
      
      // Validate dependencies
      for (const dependency of this.dependencies) {
        if (!this.isDependencyAvailable(dependency, context)) {
          this.logger.error('Plugin dependency not available', { dependency });
          return false;
        }
      }
      
      return true;
    } catch (error) {
      this.logger.error('Plugin validation failed', error);
      return false;
    }
  }
  
  /**
   * Execute the plugin
   */
  abstract execute(context: PluginContext): Promise<PluginResult>;
  
  /**
   * Check if a dependency is available
   */
  protected isDependencyAvailable(_dependency: string, _context: PluginContext): boolean {
    // Implementation would check for plugin availability in registry
    // For now, assume all dependencies are available
    return true;
  }
  
  /**
   * Create a successful result
   */
  protected createSuccessResult(data?: unknown, metadata: Record<string, unknown> = {}): PluginResult {
    return {
      success: true,
      data,
      errors: [],
      warnings: [],
      metadata
    };
  }
  
  /**
   * Create a failed result
   */
  protected createFailureResult(errors: string[], warnings: string[] = [], metadata: Record<string, unknown> = {}): PluginResult {
    return {
      success: false,
      errors,
      warnings,
      metadata
    };
  }
  
  /**
   * Wrap execution with timing and error handling
   */
  protected async executeWithTiming<T>(operation: string, fn: () => Promise<T>): Promise<T> {
    return this.logger.time(operation, fn);
  }
}

/**
 * Abstract base class for validator plugins
 */
export abstract class BaseValidatorPlugin extends BasePlugin implements ValidatorPlugin {
  abstract readonly validatorType: 'syntax' | 'content' | 'structure' | 'links' | 'examples' | 'accessibility';
  abstract readonly supportedFileTypes: string[];
  
  /**
   * Execute validation on a context (may contain multiple files)
   */
  async execute(context: PluginContext): Promise<PluginResult> {
    try {
      const files = this.extractFilesFromContext(context);
      
      if (files.length === 0) {
        return this.createSuccessResult([], { message: 'No files to validate' });
      }
      
      const results = await this.validateBatch(files, context);
      const allValid = results.every(r => r.isValid);
      const allErrors = results.flatMap(r => r.issues.filter(i => i.severity === 'error').map(i => i.message));
      const allWarnings = results.flatMap(r => r.issues.filter(i => i.severity === 'warning').map(i => i.message));
      
      return {
        success: allValid,
        data: results,
        errors: allErrors,
        warnings: allWarnings,
        metadata: {
          filesValidated: files.length,
          validFiles: results.filter(r => r.isValid).length,
          totalIssues: results.reduce((sum, r) => sum + r.issues.length, 0)
        }
      };
    } catch (error) {
      this.logger.error('Validation execution failed', error);
      return this.createFailureResult([`Validation failed: ${error}`]);
    }
  }
  
  /**
   * Validate a single file
   */
  abstract validateFile(filePath: string, content: string, context: PluginContext): Promise<ValidationResult>;
  
  /**
   * Validate multiple files (default implementation calls validateFile for each)
   */
  async validateBatch(files: FileInfo[], context: PluginContext): Promise<ValidationResult[]> {
    const results: ValidationResult[] = [];
    
    for (const file of files) {
      try {
        const result = await this.validateFile(file.path, file.content, context);
        results.push(result);
      } catch (error) {
        this.logger.error('File validation failed', { file: file.path, error });
        results.push({
          isValid: false,
          filePath: file.path,
          issues: [{
            severity: 'error',
            message: `Validation failed: ${error}`,
            rule: 'execution-error'
          }],
          suggestions: [],
          metadata: {}
        });
      }
    }
    
    return results;
  }
  
  /**
   * Check if file type is supported
   */
  protected isFileSupported(filePath: string): boolean {
    const extension = filePath.toLowerCase().split('.').pop() || '';
    return this.supportedFileTypes.includes(`.${extension}`) || this.supportedFileTypes.includes('*');
  }
  
  /**
   * Create a validation issue
   */
  protected createIssue(
    severity: 'error' | 'warning' | 'info',
    message: string,
    options: {
      line?: number;
      column?: number;
      rule?: string;
      code?: string;
      context?: string;
    } = {}
  ): ValidationIssue {
    return {
      severity,
      message,
      ...options
    };
  }
  
  /**
   * Create a validation result
   */
  protected createValidationResult(
    filePath: string,
    issues: ValidationIssue[],
    suggestions: string[] = [],
    metadata: Record<string, unknown> = {}
  ): ValidationResult {
    return {
      isValid: issues.filter(i => i.severity === 'error').length === 0,
      filePath,
      issues,
      suggestions,
      metadata
    };
  }
  
  /**
   * Extract files from plugin context
   */
  protected extractFilesFromContext(_context: PluginContext): FileInfo[] {
    // This would be implemented based on how files are passed to the context
    // For now, return empty array
    return [];
  }
}

/**
 * Abstract base class for processor plugins
 */
export abstract class BaseProcessorPlugin extends BasePlugin implements ProcessorPlugin {
  abstract readonly processorType: 'transformer' | 'generator' | 'extractor' | 'formatter';
  abstract readonly inputFormats: string[];
  abstract readonly outputFormats: string[];
  
  /**
   * Execute processing on a context (may contain multiple files)
   */
  async execute(context: PluginContext): Promise<PluginResult> {
    try {
      const files = this.extractFilesFromContext(context);
      
      if (files.length === 0) {
        return this.createSuccessResult([], { message: 'No files to process' });
      }
      
      const results = await this.processBatch(files, context);
      const allSuccessful = results.every(r => r.success);
      const errors = results.filter(r => !r.success).map(r => `Processing failed for ${r.filePath}`);
      
      return {
        success: allSuccessful,
        data: results,
        errors,
        warnings: [],
        metadata: {
          filesProcessed: files.length,
          successfulFiles: results.filter(r => r.success).length,
          outputFiles: results.filter(r => r.outputPath).length
        }
      };
    } catch (error) {
      this.logger.error('Processing execution failed', error);
      return this.createFailureResult([`Processing failed: ${error}`]);
    }
  }
  
  /**
   * Process a single file
   */
  abstract processFile(filePath: string, content: string, context: PluginContext): Promise<ProcessResult>;
  
  /**
   * Process multiple files (default implementation calls processFile for each)
   */
  async processBatch(files: FileInfo[], context: PluginContext): Promise<ProcessResult[]> {
    const results: ProcessResult[] = [];
    
    for (const file of files) {
      try {
        const result = await this.processFile(file.path, file.content, context);
        results.push(result);
      } catch (error) {
        this.logger.error('File processing failed', { file: file.path, error });
        results.push({
          success: false,
          filePath: file.path,
          metadata: { error: error instanceof Error ? error.toString() : String(error) }
        });
      }
    }
    
    return results;
  }
  
  /**
   * Check if input format is supported
   */
  protected isInputFormatSupported(filePath: string): boolean {
    const extension = filePath.toLowerCase().split('.').pop() || '';
    return this.inputFormats.includes(`.${extension}`) || this.inputFormats.includes('*');
  }
  
  /**
   * Create a processing result
   */
  protected createProcessResult(
    filePath: string,
    success: boolean = true,
    options: {
      outputPath?: string;
      transformedContent?: string;
      extractedData?: unknown;
      metadata?: Record<string, unknown>;
    } = {}
  ): ProcessResult {
    return {
      success,
      filePath,
      outputPath: options.outputPath,
      transformedContent: options.transformedContent,
      extractedData: options.extractedData,
      metadata: options.metadata || {}
    };
  }
  
  /**
   * Extract files from plugin context
   */
  protected extractFilesFromContext(_context: PluginContext): FileInfo[] {
    // This would be implemented based on how files are passed to the context
    // For now, return empty array
    return [];
  }
}