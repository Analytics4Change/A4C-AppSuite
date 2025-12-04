/**
 * Plugin registry and management system
 * Handles plugin discovery, loading, and execution coordination
 */

import { readdir } from 'fs/promises';
import { join, extname } from 'path';
import { Plugin, PluginConfig, PluginRegistryEntry, PluginDiscoveryResult, PluginExecutionPlan, PluginContext, PluginResult, PluginMetrics } from './types.js';
import { getLogger } from '../utils/logger.js';

export class PluginRegistry {
  private plugins = new Map<string, PluginRegistryEntry>();
  private metrics = new Map<string, PluginMetrics>();
  private logger = getLogger('plugin-registry');
  
  /**
   * Discover plugins in specified directories
   */
  async discoverPlugins(searchPaths: string[]): Promise<PluginDiscoveryResult> {
    const operation = this.logger.start('discoverPlugins', { searchPaths });
    
    const found: string[] = [];
    const loaded: PluginRegistryEntry[] = [];
    const failed: Array<{ path: string; error: Error }> = [];
    
    try {
      for (const searchPath of searchPaths) {
        try {
          const files = await this.findPluginFiles(searchPath);
          found.push(...files);
          
          for (const file of files) {
            try {
              const entry = await this.loadPlugin(file);
              if (entry) {
                loaded.push(entry);
                this.plugins.set(entry.plugin.name, entry);
                this.initializeMetrics(entry.plugin.name);
              }
            } catch (error) {
              this.logger.warn('Failed to load plugin', { file, error });
              failed.push({ path: file, error: error as Error });
            }
          }
        } catch (error) {
          this.logger.warn('Failed to search plugin directory', { searchPath, error });
        }
      }
      
      operation.complete('discoverPlugins', { found: found.length, loaded: loaded.length, failed: failed.length });
      return { found, loaded, failed };
    } catch (error) {
      operation.failed('discoverPlugins', error);
      throw error;
    }
  }
  
  /**
   * Register a plugin manually
   */
  registerPlugin(plugin: Plugin, config: PluginConfig): void {
    const entry: PluginRegistryEntry = {
      plugin,
      config,
      isLoaded: true
    };
    
    this.plugins.set(plugin.name, entry);
    this.initializeMetrics(plugin.name);
    
    this.logger.info('Plugin registered manually', { name: plugin.name, version: plugin.version });
  }
  
  /**
   * Unregister a plugin
   */
  unregisterPlugin(name: string): boolean {
    const entry = this.plugins.get(name);
    if (!entry) {
      return false;
    }
    
    this.plugins.delete(name);
    this.metrics.delete(name);
    
    this.logger.info('Plugin unregistered', { name });
    return true;
  }
  
  /**
   * Get a registered plugin
   */
  getPlugin(name: string): Plugin | undefined {
    const entry = this.plugins.get(name);
    return entry?.isLoaded ? entry.plugin : undefined;
  }
  
  /**
   * Get all registered plugins
   */
  getAllPlugins(): Plugin[] {
    return Array.from(this.plugins.values())
      .filter(entry => entry.isLoaded)
      .map(entry => entry.plugin);
  }
  
  /**
   * Get plugins by type
   */
  getPluginsByType<T extends Plugin>(type: string): T[] {
    return this.getAllPlugins().filter(plugin => {
      // Type checking based on plugin properties
      if (type === 'validator' && 'validatorType' in plugin) {
        return true;
      }
      if (type === 'processor' && 'processorType' in plugin) {
        return true;
      }
      return false;
    }) as T[];
  }
  
  /**
   * Get enabled plugins
   */
  getEnabledPlugins(): Plugin[] {
    return Array.from(this.plugins.values())
      .filter(entry => entry.isLoaded && entry.config.enabled)
      .map(entry => entry.plugin);
  }
  
  /**
   * Create execution plan for plugins with dependency resolution
   */
  createExecutionPlan(pluginNames?: string[]): PluginExecutionPlan {
    const operation = this.logger.start('createExecutionPlan', { pluginNames });
    
    try {
      // Get plugins to execute
      const targetPlugins = pluginNames ? 
        pluginNames.map(name => this.plugins.get(name)).filter(Boolean) as PluginRegistryEntry[] :
        Array.from(this.plugins.values()).filter(entry => entry.isLoaded && entry.config.enabled);
      
      // Build dependency map
      const dependencies = new Map<string, string[]>();
      for (const entry of targetPlugins) {
        dependencies.set(entry.plugin.name, entry.plugin.dependencies);
      }
      
      // Resolve execution order using topological sort
      const executionOrder = this.topologicalSort(targetPlugins.map(e => e.plugin.name), dependencies);
      
      // Filter to only include available plugins
      const availableOrder = executionOrder.filter(name => this.plugins.has(name));
      const finalPlugins = availableOrder.map(name => this.plugins.get(name)!);
      
      const plan: PluginExecutionPlan = {
        plugins: finalPlugins,
        dependencies,
        executionOrder: availableOrder
      };
      
      operation.complete('createExecutionPlan', { 
        totalPlugins: finalPlugins.length, 
        executionOrder: availableOrder 
      });
      
      return plan;
    } catch (error) {
      operation.failed('createExecutionPlan', error);
      throw error;
    }
  }
  
  /**
   * Execute plugins according to execution plan
   */
  async executePlugins(plan: PluginExecutionPlan, context: PluginContext): Promise<Map<string, PluginResult>> {
    const operation = this.logger.start('executePlugins', { pluginCount: plan.plugins.length });
    
    const results = new Map<string, PluginResult>();
    
    try {
      // Initialize all plugins
      for (const entry of plan.plugins) {
        try {
          await entry.plugin.onInit?.(context);
        } catch (error) {
          this.logger.warn('Plugin initialization failed', { plugin: entry.plugin.name, error });
        }
      }
      
      // Execute plugins in dependency order
      for (const pluginName of plan.executionOrder) {
        const entry = plan.plugins.find(p => p.plugin.name === pluginName);
        if (!entry) continue;
        
        try {
          const pluginResult = await this.executePlugin(entry, context);
          results.set(pluginName, pluginResult);
          
          // Update metrics
          this.updateMetrics(pluginName, pluginResult, true);
          
        } catch (error) {
          this.logger.error('Plugin execution failed', { plugin: pluginName, error });
          
          const failureResult: PluginResult = {
            success: false,
            errors: [`Plugin execution failed: ${error}`],
            warnings: [],
            metadata: { executionError: true }
          };
          
          results.set(pluginName, failureResult);
          this.updateMetrics(pluginName, failureResult, false);
        }
      }
      
      // Cleanup all plugins
      for (const entry of plan.plugins) {
        try {
          await entry.plugin.onDestroy?.(context);
        } catch (error) {
          this.logger.warn('Plugin cleanup failed', { plugin: entry.plugin.name, error });
        }
      }
      
      operation.complete('executePlugins', { 
        executedCount: results.size,
        successCount: Array.from(results.values()).filter(r => r.success).length
      });
      
      return results;
    } catch (error) {
      operation.failed('executePlugins', error);
      throw error;
    }
  }
  
  /**
   * Get plugin metrics
   */
  getMetrics(pluginName?: string): PluginMetrics | Map<string, PluginMetrics> | undefined {
    if (pluginName) {
      return this.metrics.get(pluginName);
    }
    return new Map(this.metrics);
  }
  
  /**
   * Reset plugin metrics
   */
  resetMetrics(pluginName?: string): void {
    if (pluginName) {
      this.initializeMetrics(pluginName);
    } else {
      this.metrics.clear();
      for (const plugin of this.getAllPlugins()) {
        this.initializeMetrics(plugin.name);
      }
    }
  }
  
  /**
   * Find plugin files in a directory
   */
  private async findPluginFiles(searchPath: string): Promise<string[]> {
    const files: string[] = [];
    
    try {
      const entries = await readdir(searchPath, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = join(searchPath, entry.name);
        
        if (entry.isFile() && this.isPluginFile(entry.name)) {
          files.push(fullPath);
        } else if (entry.isDirectory()) {
          // Recursively search subdirectories
          const subFiles = await this.findPluginFiles(fullPath);
          files.push(...subFiles);
        }
      }
    } catch (error) {
      this.logger.debug('Could not read directory', { searchPath, error });
    }
    
    return files;
  }
  
  /**
   * Check if file is a potential plugin file
   */
  private isPluginFile(filename: string): boolean {
    const ext = extname(filename);
    return ['.js', '.ts'].includes(ext) && 
           !filename.includes('.test.') && 
           !filename.includes('.spec.') &&
           (filename.includes('plugin') || filename.includes('validator') || filename.includes('processor'));
  }
  
  /**
   * Load a plugin from file
   */
  private async loadPlugin(filePath: string): Promise<PluginRegistryEntry | undefined> {
    try {
      // Dynamic import the plugin module
      const module = await import(filePath);
      
      // Look for plugin export (could be default export or named export)
      const plugin = module.default || module.plugin || module;
      
      if (!plugin || typeof plugin.execute !== 'function') {
        this.logger.debug('File does not export a valid plugin', { filePath });
        return undefined;
      }
      
      // Create default config if not provided
      const config: PluginConfig = {
        name: plugin.name || 'unknown',
        enabled: true,
        priority: 100,
        options: {},
        dependencies: plugin.dependencies || []
      };
      
      const entry: PluginRegistryEntry = {
        plugin,
        config,
        isLoaded: true
      };
      
      this.logger.debug('Plugin loaded successfully', { 
        name: plugin.name, 
        version: plugin.version,
        filePath 
      });
      
      return entry;
    } catch (error) {
      this.logger.warn('Failed to load plugin file', { filePath, error });
      return {
        plugin: {} as Plugin,
        config: { name: 'failed', enabled: false, priority: 0, options: {} },
        isLoaded: false,
        loadError: error as Error
      };
    }
  }
  
  /**
   * Execute a single plugin
   */
  private async executePlugin(entry: PluginRegistryEntry, context: PluginContext): Promise<PluginResult> {
    const startTime = Date.now();
    
    try {
      // Validate plugin before execution
      const isValid = await entry.plugin.validate?.(context) ?? true;
      if (!isValid) {
        throw new Error('Plugin validation failed');
      }
      
      // Execute plugin lifecycle hooks
      await entry.plugin.onBeforeExecute?.(context);
      
      // Execute the plugin
      const result = await entry.plugin.execute(context);

      // Execute post-execution hook
      await entry.plugin.onAfterExecute?.(context, result);

      return result;
    } finally {
      const executionTime = Date.now() - startTime;
      this.updateExecutionTime(entry.plugin.name, executionTime);
    }
  }
  
  /**
   * Topological sort for dependency resolution
   */
  private topologicalSort(nodes: string[], dependencies: Map<string, string[]>): string[] {
    const visited = new Set<string>();
    const temp = new Set<string>();
    const result: string[] = [];
    
    const visit = (node: string) => {
      if (temp.has(node)) {
        throw new Error(`Circular dependency detected involving ${node}`);
      }
      if (visited.has(node)) {
        return;
      }
      
      temp.add(node);
      
      const deps = dependencies.get(node) || [];
      for (const dep of deps) {
        if (nodes.includes(dep)) {
          visit(dep);
        }
      }
      
      temp.delete(node);
      visited.add(node);
      result.push(node);
    };
    
    for (const node of nodes) {
      if (!visited.has(node)) {
        visit(node);
      }
    }
    
    return result;
  }
  
  /**
   * Initialize metrics for a plugin
   */
  private initializeMetrics(pluginName: string): void {
    this.metrics.set(pluginName, {
      name: pluginName,
      executionCount: 0,
      totalExecutionTime: 0,
      averageExecutionTime: 0,
      successCount: 0,
      errorCount: 0
    });
  }
  
  /**
   * Update plugin metrics after execution
   */
  private updateMetrics(pluginName: string, result: PluginResult, success: boolean): void {
    const metrics = this.metrics.get(pluginName);
    if (!metrics) return;
    
    metrics.executionCount++;
    metrics.lastExecuted = new Date();
    
    if (success && result.success) {
      metrics.successCount++;
    } else {
      metrics.errorCount++;
      if (!result.success) {
        metrics.lastError = new Error(result.errors.join('; '));
      }
    }
    
    // Update average execution time
    if (metrics.totalExecutionTime > 0) {
      metrics.averageExecutionTime = metrics.totalExecutionTime / metrics.executionCount;
    }
  }
  
  /**
   * Update execution time metrics
   */
  private updateExecutionTime(pluginName: string, executionTime: number): void {
    const metrics = this.metrics.get(pluginName);
    if (!metrics) return;
    
    metrics.totalExecutionTime += executionTime;
    metrics.averageExecutionTime = metrics.totalExecutionTime / Math.max(metrics.executionCount, 1);
  }
}

// Create singleton instance
export const pluginRegistry = new PluginRegistry();