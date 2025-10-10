#!/usr/bin/env node

/**
 * Main CLI entry point
 * Provides a comprehensive command-line interface for documentation tools
 */

import { createCLI } from './commands.js';
import { getLogger } from '../utils/logger.js';
import chalk from 'chalk';

const logger = getLogger('cli-main');

/**
 * Main CLI execution function
 */
async function main(): Promise<void> {
  try {
    const program = createCLI();
    
    // Parse command line arguments
    await program.parseAsync(process.argv);
    
  } catch (error) {
    logger.error('CLI execution failed', error);
    
    // Display user-friendly error message
    console.error(chalk.red('\\n❌ Command failed:'));
    
    if (error instanceof Error) {
      console.error(chalk.red(`   ${error.message}`));
      
      // Show stack trace in debug mode
      const isDebug = process.argv.includes('--verbose') || process.argv.includes('-v');
      if (isDebug && error.stack) {
        console.error(chalk.gray('\\nStack trace:'));
        console.error(chalk.gray(error.stack));
      }
    } else {
      console.error(chalk.red(`   ${error}`));
    }
    
    console.error(chalk.gray('\\nFor more information, run with --verbose flag'));
    process.exit(1);
  }
}

/**
 * Handle unhandled promise rejections
 */
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled promise rejection', reason, { promise });
  console.error(chalk.red('\\n❌ Unhandled error occurred'));
  console.error(chalk.red('Please report this issue with the --verbose flag output'));
  process.exit(1);
});

/**
 * Handle uncaught exceptions
 */
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', error);
  console.error(chalk.red('\\n❌ Critical error occurred'));
  console.error(chalk.red('Please report this issue with the --verbose flag output'));
  process.exit(1);
});

/**
 * Handle SIGINT (Ctrl+C) gracefully
 */
process.on('SIGINT', () => {
  console.log(chalk.yellow('\\n⏹️  Operation cancelled by user'));
  process.exit(0);
});

/**
 * Handle SIGTERM gracefully
 */
process.on('SIGTERM', () => {
  console.log(chalk.yellow('\\n⏹️  Operation terminated'));
  process.exit(0);
});

// Execute main function if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    logger.error('Unhandled error in main', error);
    process.exit(1);
  });
}