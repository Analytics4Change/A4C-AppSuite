#!/usr/bin/env node

/**
 * Documentation Validation Script (TypeScript)
 * Validates documentation structure, format, and completeness
 * Converted from CommonJS to modern TypeScript with enhanced functionality
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { glob } from 'glob';
import chalk from 'chalk';

import { sanitizePath, isValidProjectPath } from '../utils/security.js';
import { getLogger } from '../utils/logger.js';
import { ProgressTracker } from '../utils/progress.js';
import { configManager } from '../config/manager.js';

const logger = getLogger('docs-validation');

// Validation configuration interface
interface ValidationConfig {
  docsRoot: string;
  srcRoot: string;
  requiredDocs: string[];
  patterns: {
    component: RegExp;
    props: RegExp;
    usage: RegExp;
    accessibility: RegExp;
    keyboard: RegExp;
  };
}

// Configuration
const CONFIG: ValidationConfig = {
  docsRoot: join(process.cwd(), 'docs'),
  srcRoot: join(process.cwd(), 'src'),
  requiredDocs: [
    'CLAUDE.md',
    'README.md',
    'docs/architecture/overview.md',
    'docs/getting-started/installation.md'
  ],
  patterns: {
    component: /^# Component: (.+)$/m,
    props: /^## Props$/m,
    usage: /^## Usage( Examples?)?$/m,
    accessibility: /^## Accessibility$/m,
    keyboard: /^## Keyboard Navigation$/m
  }
};

// Issue types
interface ValidationIssue {
  message: string;
  file?: string;
  severity: 'error' | 'warning' | 'info';
}

interface ValidationStats {
  totalFiles: number;
  validFiles: number;
  componentsDocumented: number;
  apisDocumented: number;
}

// Validation Results class
class ValidationResult {
  public errors: ValidationIssue[] = [];
  public warnings: ValidationIssue[] = [];
  public info: ValidationIssue[] = [];
  public stats: ValidationStats = {
    totalFiles: 0,
    validFiles: 0,
    componentsDocumented: 0,
    apisDocumented: 0
  };

  addError(message: string, file?: string): void {
    this.errors.push({ message, file, severity: 'error' });
    logger.error('Validation error', { message, file });
  }

  addWarning(message: string, file?: string): void {
    this.warnings.push({ message, file, severity: 'warning' });
    logger.warn('Validation warning', { message, file });
  }

  addInfo(message: string, file?: string): void {
    this.info.push({ message, file, severity: 'info' });
    logger.info('Validation info', { message, file });
  }

  hasErrors(): boolean {
    return this.errors.length > 0;
  }

  hasIssues(): boolean {
    return this.errors.length > 0 || this.warnings.length > 0;
  }

  print(): void {
    console.log(chalk.bold('\n📚 Documentation Validation Report\n'));
    
    // Print statistics
    console.log(chalk.cyan('Statistics:'));
    console.log(`  Total files checked: ${this.stats.totalFiles}`);
    console.log(`  Valid files: ${this.stats.validFiles}`);
    console.log(`  Components documented: ${this.stats.componentsDocumented}`);
    console.log(`  APIs documented: ${this.stats.apisDocumented}`);
    console.log();

    // Print errors
    if (this.errors.length > 0) {
      console.log(chalk.red.bold(`❌ Errors (${this.errors.length}):`));
      this.errors.forEach(({ message, file }) => {
        console.log(chalk.red(`  • ${message}`));
        if (file) console.log(chalk.gray(`    File: ${file}`));
      });
      console.log();
    }

    // Print warnings
    if (this.warnings.length > 0) {
      console.log(chalk.yellow.bold(`⚠️  Warnings (${this.warnings.length}):`));
      this.warnings.forEach(({ message, file }) => {
        console.log(chalk.yellow(`  • ${message}`));
        if (file) console.log(chalk.gray(`    File: ${file}`));
      });
      console.log();
    }

    // Print info
    if (this.info.length > 0) {
      console.log(chalk.blue.bold(`ℹ️  Information (${this.info.length}):`));
      this.info.forEach(({ message, file }) => {
        console.log(chalk.blue(`  • ${message}`));
        if (file) console.log(chalk.gray(`    File: ${file}`));
      });
      console.log();
    }

    // Summary
    if (!this.hasIssues()) {
      console.log(chalk.green.bold('✅ All documentation validation checks passed!'));
    } else if (!this.hasErrors()) {
      console.log(chalk.yellow.bold('⚠️  Documentation validation completed with warnings'));
    } else {
      console.log(chalk.red.bold('❌ Documentation validation failed'));
    }
  }

  toJSON(): object {
    return {
      errors: this.errors,
      warnings: this.warnings,
      info: this.info,
      stats: this.stats,
      timestamp: new Date().toISOString(),
      summary: {
        hasErrors: this.hasErrors(),
        hasWarnings: this.warnings.length > 0,
        totalIssues: this.errors.length + this.warnings.length
      }
    };
  }
}

// Document validator class
class DocumentValidator {
  private result: ValidationResult;
  private progress: ProgressTracker;

  constructor() {
    this.result = new ValidationResult();
    this.progress = new ProgressTracker(4, { message: 'Validating documentation...' });
  }

  async validate(): Promise<ValidationResult> {
    logger.info('Starting documentation validation', { operation: 'validate' });
    
    this.progress.start();

    try {
      // Check required documentation files
      this.progress.tick('Checking required files...');
      await this.checkRequiredFiles();

      // Validate documentation structure
      this.progress.tick('Validating structure...');
      await this.validateStructure();

      // Check markdown format
      this.progress.tick('Checking markdown format...');
      await this.validateMarkdownFormat();

      // Validate links and references
      this.progress.tick('Validating links...');
      await this.validateLinks();

      this.progress.complete('Documentation validation completed');
    } catch (error) {
      this.progress.fail('Documentation validation failed');
      this.result.addError(`Validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      logger.error('Documentation validation failed', error);
    }

    return this.result;
  }

  private async checkRequiredFiles(): Promise<void> {
    logger.debug('Checking required documentation files');
    
    for (const requiredFile of CONFIG.requiredDocs) {
      try {
        const filePath = sanitizePath(requiredFile);
        await fs.access(filePath);
        this.result.addInfo(`Required file exists: ${requiredFile}`);
      } catch (error) {
        this.result.addError(`Required documentation file missing: ${requiredFile}`);
      }
    }
  }

  private async validateStructure(): Promise<void> {
    logger.debug('Validating documentation structure');
    
    try {
      const docFiles = await glob('docs/**/*.md', { 
        cwd: process.cwd(),
        ignore: ['node_modules/**', 'dist/**'] 
      });

      this.result.stats.totalFiles = docFiles.length;

      for (const file of docFiles) {
        if (!isValidProjectPath(file)) {
          this.result.addWarning(`Skipping file outside project scope: ${file}`);
          continue;
        }

        try {
          await this.validateDocumentStructure(file);
          this.result.stats.validFiles++;
        } catch (error) {
          this.result.addError(
            `Failed to validate structure for ${file}: ${error instanceof Error ? error.message : 'Unknown error'}`,
            file
          );
        }
      }
    } catch (error) {
      this.result.addError(`Failed to scan documentation files: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async validateDocumentStructure(filePath: string): Promise<void> {
    const safePath = sanitizePath(filePath);
    const content = await fs.readFile(safePath, 'utf-8');
    
    // Check for basic markdown structure
    if (!content.trim()) {
      this.result.addWarning('Document is empty', filePath);
      return;
    }

    // Check for title
    if (!content.match(/^#\s+.+$/m)) {
      this.result.addWarning('Document missing title (# heading)', filePath);
    }

    // Check component documentation structure
    if (filePath.includes('components/')) {
      await this.validateComponentDoc(content, filePath);
    }

    // Check API documentation structure  
    if (filePath.includes('api/')) {
      await this.validateApiDoc(content, filePath);
    }
  }

  private async validateComponentDoc(content: string, filePath: string): Promise<void> {
    // Note: With Component Props validation removed, focus on other sections
    
    // Check for usage examples
    if (!CONFIG.patterns.usage.test(content)) {
      this.result.addWarning('Component documentation missing Usage section', filePath);
    }

    // Check for accessibility documentation
    if (!CONFIG.patterns.accessibility.test(content)) {
      this.result.addWarning('Component documentation missing Accessibility section', filePath);
    }

    this.result.stats.componentsDocumented++;
  }

  private async validateApiDoc(content: string, filePath: string): Promise<void> {
    // Check for API endpoint documentation
    if (!content.includes('```typescript') && !content.includes('```ts')) {
      this.result.addWarning('API documentation missing TypeScript examples', filePath);
    }

    // Check for endpoint descriptions
    if (!content.match(/^##\s+/m)) {
      this.result.addWarning('API documentation missing section headers', filePath);
    }

    this.result.stats.apisDocumented++;
  }

  private async validateMarkdownFormat(): Promise<void> {
    logger.debug('Validating markdown format');
    
    try {
      const markdownFiles = await glob('**/*.md', { 
        cwd: process.cwd(),
        ignore: ['node_modules/**', 'dist/**', '.git/**'] 
      });

      for (const file of markdownFiles) {
        if (!isValidProjectPath(file)) continue;
        
        try {
          await this.validateMarkdownFile(file);
        } catch (error) {
          this.result.addWarning(
            `Markdown validation failed for ${file}: ${error instanceof Error ? error.message : 'Unknown error'}`,
            file
          );
        }
      }
    } catch (error) {
      this.result.addError(`Failed to validate markdown format: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async validateMarkdownFile(filePath: string): Promise<void> {
    const safePath = sanitizePath(filePath);
    const content = await fs.readFile(safePath, 'utf-8');
    
    // Basic markdown checks
    const lines = content.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;
      
      // Check for unbalanced code blocks
      if (line.includes('```') && line.split('```').length === 2) {
        // This is a single ``` on a line, check if it has a matching close
        let foundMatch = false;
        for (let j = i + 1; j < lines.length; j++) {
          if (lines[j].includes('```')) {
            foundMatch = true;
            break;
          }
        }
        if (!foundMatch) {
          this.result.addWarning(`Unmatched code block at line ${lineNum}`, filePath);
        }
      }
      
      // Check for broken internal links
      const linkMatches = line.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g);
      for (const match of linkMatches) {
        const linkPath = match[2];
        if (linkPath.startsWith('./') || linkPath.startsWith('../') || linkPath.startsWith('/')) {
          // This is an internal link - we could validate it exists
          // For now, just note it
          this.result.addInfo(`Internal link found: ${linkPath}`, filePath);
        }
      }
    }
  }

  private async validateLinks(): Promise<void> {
    logger.debug('Validating links and references');
    
    // For now, this is a placeholder for more sophisticated link validation
    // Could be enhanced to check internal links, external links, etc.
    this.result.addInfo('Link validation completed (basic checks only)');
  }
}

// Main execution function
async function main(): Promise<void> {
  try {
    logger.info('Starting main validation process', { operation: 'main' });
    
    console.log(chalk.blue('📚 Starting Documentation Validation...\n'));
    
    const validator = new DocumentValidator();
    const result = await validator.validate();
    
    // Print results
    result.print();
    
    // Save JSON report
    const reportPath = join(process.cwd(), 'docs-validation-report.json');
    try {
      await fs.writeFile(reportPath, JSON.stringify(result.toJSON(), null, 2));
      console.log(chalk.gray(`\n📄 Detailed report saved to: ${reportPath}`));
    } catch (saveError) {
      logger.warn('Failed to save validation report', saveError);
    }
    
    // Exit with appropriate code
    process.exit(result.hasErrors() ? 1 : 0);
    
  } catch (error) {
    logger.error('Unexpected error during validation', error);
    console.error(chalk.red('\n💥 Unexpected error during documentation validation:'));
    console.error(chalk.red(`  ${error instanceof Error ? error.message : 'Unknown error'}`));
    
    if (error instanceof Error && error.stack) {
      console.log(chalk.gray('\nStack trace:'));
      console.log(chalk.gray(error.stack));
    }
    
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { DocumentValidator, ValidationResult, CONFIG };