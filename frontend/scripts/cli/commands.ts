/**
 * CLI command definitions and implementations
 * Provides a comprehensive command-line interface for documentation tools
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { promises as fs } from 'fs';

import { configManager } from '../config/manager.js';
import { getLogger } from '../utils/logger.js';
import { createProgress } from '../utils/progress.js';
import { pluginRegistry } from '../plugins/registry.js';

const logger = getLogger('cli');

/**
 * Create the main CLI program
 */
export function createCLI(): Command {
  const program = new Command();
  
  program
    .name('docs-cli')
    .description('Documentation management and validation tools')
    .version('1.0.0')
    .option('-c, --config <path>', 'Configuration file path')
    .option('-v, --verbose', 'Enable verbose logging')
    .option('--silent', 'Suppress all output except errors')
    .option('--progress <style>', 'Progress indicator style (bar|spinner|dots|none)')
    .hook('preAction', async (thisCommand) => {
      const options = thisCommand.opts();
      
      // Load external configuration if specified
      if (options.config) {
        await configManager.loadFromFile(options.config);
      }
      
      // Override logging level based on options
      if (options.verbose) {
        configManager.override({
          logging: { 
            level: 'debug',
            enableColors: true,
            enableTimestamps: true,
            format: 'simple'
          }
        });
      } else if (options.silent) {
        configManager.override({
          logging: { 
            level: 'error',
            enableColors: true,
            enableTimestamps: true,
            format: 'simple'
          }
        });
      }
      
      // Override progress style if specified
      if (options.progress) {
        configManager.override({
          progress: { 
            style: options.progress as any,
            showPercentage: true,
            showEta: true,
            refreshRate: 100
          }
        });
      }
    });
  
  // Add subcommands
  program.addCommand(createCheckCommand());
  program.addCommand(createGenerateCommand());
  program.addCommand(createValidateCommand());
  program.addCommand(createPluginCommand());
  program.addCommand(createConfigCommand());
  
  return program;
}

/**
 * Create the 'check' command
 */
function createCheckCommand(): Command {
  const command = new Command('check');
  
  command
    .description('Check documentation-code alignment')
    .option('-s, --since <timeframe>', 'Check files changed since timeframe', '7 days ago')
    .option('-r, --rules <rules...>', 'Specific alignment rules to check')
    .option('--fix', 'Attempt to fix alignment issues automatically')
    .option('--report <format>', 'Report format (console|json|html)', 'console')
    .option('--output <path>', 'Output file for report')
    .action(async (_options) => {
      const operation = logger.start('check command');
      
      try {
        console.log(chalk.bold('🔍 Checking Documentation-Code Alignment...'));
        
        // Dynamic import to avoid circular dependencies
        const { main: checkAlignment } = await import('../documentation/check-doc-alignment');
        
        // Set up progress reporting
        const progress = createProgress({
          total: 100,
          message: 'Checking alignment...'
        });
        
        progress.start();
        
        // Execute alignment check (would need to modify the main function to accept options)
        await checkAlignment();
        
        progress.complete('Alignment check completed');
        
        operation.complete('check command');
      } catch (error) {
        operation.failed('check command', error);
        console.error(chalk.red('❌ Alignment check failed:'), error);
        process.exit(1);
      }
    });
  
  return command;
}

/**
 * Create the 'generate' command
 */
function createGenerateCommand(): Command {
  const command = new Command('generate');
  
  command
    .description('Generate documentation metrics and dashboards')
    .option('-t, --type <type>', 'Generation type (metrics|dashboard|all)', 'all')
    .option('-o, --output <path>', 'Output directory', 'docs')
    .option('--format <format>', 'Output format (json|html|both)', 'both')
    .option('--template <path>', 'Custom template file')
    .action(async (_options) => {
      const operation = logger.start('generate command');
      
      try {
        console.log(chalk.bold('📊 Generating Documentation Metrics...'));
        
        // Dynamic import to avoid circular dependencies
        const { main: generateMetrics } = await import('../documentation/generate-metrics-dashboard');
        
        // Set up progress reporting
        const progress = createProgress({
          total: 100,
          message: 'Generating metrics...'
        });
        
        progress.start();
        
        // Execute metrics generation
        await generateMetrics();
        
        progress.complete('Metrics generation completed');
        
        console.log(chalk.green('✅ Documentation metrics generated successfully!'));
        
        operation.complete('generate command');
      } catch (error) {
        operation.failed('generate command', error);
        console.error(chalk.red('❌ Metrics generation failed:'), error);
        process.exit(1);
      }
    });
  
  return command;
}

/**
 * Create the 'validate' command
 */
function createValidateCommand(): Command {
  const command = new Command('validate');
  
  command
    .description('Validate documentation using plugins')
    .option('-p, --plugins <plugins...>', 'Specific plugins to run')
    .option('-f, --files <patterns...>', 'File patterns to validate')
    .option('--strict', 'Use strict validation mode')
    .option('--fix', 'Attempt to fix validation issues automatically')
    .option('--report <format>', 'Report format (console|json|junit)', 'console')
    .option('--output <path>', 'Output file for report')
    .action(async (options) => {
      const operation = logger.start('validate command');
      
      try {
        console.log(chalk.bold('✅ Validating Documentation...'));
        
        // Discover and load plugins
        const pluginPaths = ['./scripts/plugins/validators'];
        await pluginRegistry.discoverPlugins(pluginPaths);
        
        // Get plugins to run
        const availablePlugins = pluginRegistry.getEnabledPlugins();
        const targetPlugins = options.plugins ? 
          availablePlugins.filter(p => options.plugins.includes(p.name)) :
          availablePlugins;
        
        if (targetPlugins.length === 0) {
          console.log(chalk.yellow('⚠️  No validation plugins found or enabled'));
          return;
        }
        
        console.log(chalk.cyan(`Running ${targetPlugins.length} validation plugins...`));
        
        // Create execution plan
        const plan = pluginRegistry.createExecutionPlan(targetPlugins.map(p => p.name));
        
        // Set up context
        const context = {
          logger,
          config: options,
          workingDirectory: process.cwd()
        };
        
        // Execute plugins
        const results = await pluginRegistry.executePlugins(plan, context);
        
        // Process results
        let totalIssues = 0;
        let hasErrors = false;
        
        for (const [pluginName, result] of results) {
          const issueCount = result.errors.length + result.warnings.length;
          totalIssues += issueCount;
          
          if (result.errors.length > 0) {
            hasErrors = true;
          }
          
          const status = result.success ? chalk.green('✅') : chalk.red('❌');
          console.log(`${status} ${pluginName}: ${issueCount} issues found`);
          
          if (result.errors.length > 0) {
            for (const error of result.errors.slice(0, 3)) {
              console.log(chalk.red(`   Error: ${error}`));
            }
            if (result.errors.length > 3) {
              console.log(chalk.red(`   ... and ${result.errors.length - 3} more errors`));
            }
          }
          
          if (result.warnings.length > 0) {
            for (const warning of result.warnings.slice(0, 2)) {
              console.log(chalk.yellow(`   Warning: ${warning}`));
            }
            if (result.warnings.length > 2) {
              console.log(chalk.yellow(`   ... and ${result.warnings.length - 2} more warnings`));
            }
          }
        }
        
        console.log(chalk.bold(`\\n📋 Summary: ${totalIssues} total issues found`));
        
        if (hasErrors) {
          console.log(chalk.red('❌ Validation failed with errors'));
          process.exit(1);
        } else if (totalIssues > 0) {
          console.log(chalk.yellow('⚠️  Validation completed with warnings'));
        } else {
          console.log(chalk.green('🎉 All documentation is valid!'));
        }
        
        operation.complete('validate command');
      } catch (error) {
        operation.failed('validate command', error);
        console.error(chalk.red('❌ Validation failed:'), error);
        process.exit(1);
      }
    });
  
  return command;
}

/**
 * Create the 'plugin' command
 */
function createPluginCommand(): Command {
  const command = new Command('plugin');
  
  command.description('Manage documentation plugins');
  
  // List plugins
  command
    .command('list')
    .description('List available plugins')
    .option('--enabled', 'Show only enabled plugins')
    .option('--type <type>', 'Filter by plugin type (validator|processor)')
    .action(async (options) => {
      try {
        // Discover plugins
        const pluginPaths = ['./scripts/plugins/validators', './scripts/plugins/processors'];
        const discovery = await pluginRegistry.discoverPlugins(pluginPaths);
        
        console.log(chalk.bold('📦 Available Plugins:'));
        console.log(chalk.gray('=' .repeat(50)));
        
        const plugins = options.enabled ? 
          pluginRegistry.getEnabledPlugins() :
          pluginRegistry.getAllPlugins();
        
        const filteredPlugins = options.type ?
          plugins.filter(p => (options.type === 'validator' && 'validatorType' in p) ||
                             (options.type === 'processor' && 'processorType' in p)) :
          plugins;
        
        if (filteredPlugins.length === 0) {
          console.log(chalk.yellow('No plugins found'));
          return;
        }
        
        for (const plugin of filteredPlugins) {
          const enabled = pluginRegistry.getEnabledPlugins().includes(plugin);
          const status = enabled ? chalk.green('✅ Enabled') : chalk.gray('⏸️  Disabled');
          
          console.log(`\\n${status} ${chalk.bold(plugin.name)} v${plugin.version}`);
          console.log(`   ${plugin.description}`);
          
          if ('validatorType' in plugin) {
            console.log(`   Type: Validator (${(plugin as any).validatorType})`);
          } else if ('processorType' in plugin) {
            console.log(`   Type: Processor (${(plugin as any).processorType})`);
          }
          
          if (plugin.dependencies.length > 0) {
            console.log(`   Dependencies: ${plugin.dependencies.join(', ')}`);
          }
        }
        
        console.log(chalk.gray('\\n' + '=' .repeat(50)));
        console.log(`Total: ${filteredPlugins.length} plugins`);
        
        if (discovery.failed.length > 0) {
          console.log(chalk.yellow(`\\n⚠️  ${discovery.failed.length} plugins failed to load`));
        }
      } catch (error) {
        console.error(chalk.red('❌ Failed to list plugins:'), error);
        process.exit(1);
      }
    });
  
  // Plugin metrics
  command
    .command('metrics')
    .description('Show plugin execution metrics')
    .option('-p, --plugin <name>', 'Show metrics for specific plugin')
    .action(async (options) => {
      try {
        const metrics = pluginRegistry.getMetrics(options.plugin);
        
        if (options.plugin) {
          if (!metrics) {
            console.log(chalk.yellow(`No metrics found for plugin: ${options.plugin}`));
            return;
          }
          
          console.log(chalk.bold(`📈 Metrics for ${options.plugin}:`));
          console.log(`   Executions: ${(metrics as any).executionCount}`);
          console.log(`   Success Rate: ${Math.round(((metrics as any).successCount / (metrics as any).executionCount) * 100)}%`);
          console.log(`   Average Time: ${(metrics as any).averageExecutionTime}ms`);
          console.log(`   Last Executed: ${(metrics as any).lastExecuted || 'Never'}`);
        } else {
          console.log(chalk.bold('📈 Plugin Metrics:'));
          console.log(chalk.gray('=' .repeat(60)));
          
          for (const [name, metric] of (metrics as Map<string, any>)) {
            const successRate = metric.executionCount > 0 ? 
              Math.round((metric.successCount / metric.executionCount) * 100) : 0;
            
            console.log(`\\n${chalk.bold(name)}`);
            console.log(`   Executions: ${metric.executionCount} | Success: ${successRate}% | Avg: ${metric.averageExecutionTime}ms`);
          }
        }
      } catch (error) {
        console.error(chalk.red('❌ Failed to show metrics:'), error);
        process.exit(1);
      }
    });
  
  return command;
}

/**
 * Create the 'config' command
 */
function createConfigCommand(): Command {
  const command = new Command('config');
  
  command.description('Manage configuration');
  
  // Show current configuration
  command
    .command('show')
    .description('Show current configuration')
    .option('-s, --section <section>', 'Show specific configuration section')
    .action((options) => {
      try {
        const config = options.section ? 
          configManager.get(options.section as any) :
          configManager.getConfig();
        
        console.log(chalk.bold('⚙️  Current Configuration:'));
        console.log(chalk.gray('=' .repeat(40)));
        console.log(JSON.stringify(config, null, 2));
      } catch (error) {
        console.error(chalk.red('❌ Failed to show configuration:'), error);
        process.exit(1);
      }
    });
  
  // Validate configuration
  command
    .command('validate')
    .description('Validate current configuration')
    .action(() => {
      try {
        const errors = configManager.validate();
        
        if (errors.length === 0) {
          console.log(chalk.green('✅ Configuration is valid'));
        } else {
          console.log(chalk.red('❌ Configuration validation failed:'));
          for (const error of errors) {
            console.log(chalk.red(`   • ${error}`));
          }
          process.exit(1);
        }
      } catch (error) {
        console.error(chalk.red('❌ Failed to validate configuration:'), error);
        process.exit(1);
      }
    });
  
  // Generate sample configuration
  command
    .command('init')
    .description('Generate sample configuration file')
    .option('-o, --output <path>', 'Output file path', 'docs-config.json')
    .action(async (options) => {
      try {
        const sampleConfig = {
          logging: {
            level: 'info',
            enableColors: true,
            enableTimestamps: true,
            format: 'structured'
          },
          performance: {
            concurrency: 4,
            timeoutMs: 30000
          },
          progress: {
            style: 'bar',
            showPercentage: true,
            showEta: true
          },
          plugins: {
            autoLoad: true,
            pluginPaths: ['./scripts/plugins']
          }
        };
        
        await fs.writeFile(options.output, JSON.stringify(sampleConfig, null, 2));
        console.log(chalk.green(`✅ Sample configuration written to ${options.output}`));
      } catch (error) {
        console.error(chalk.red('❌ Failed to generate configuration:'), error);
        process.exit(1);
      }
    });
  
  return command;
}