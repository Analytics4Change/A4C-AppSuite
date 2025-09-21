#!/usr/bin/env node

/**
 * Documentation Validation Script
 * Validates documentation structure, format, and completeness
 */

const fs = require('fs').promises;
const path = require('path');
const glob = require('glob');
const chalk = require('chalk');

// Configuration
const CONFIG = {
  docsRoot: path.join(process.cwd(), 'docs'),
  srcRoot: path.join(process.cwd(), 'src'),
  requiredDocs: [
    'CLAUDE.md',
    'README.md',
    'docs/architecture/overview.md',
    'docs/getting-started/installation.md'
  ],
  patterns: {
    component: /^# Component: (.+)$/m,
    props: /^## Props$/m,
    usage: /^## Usage$/m,
    accessibility: /^## Accessibility$/m,
    keyboard: /^## Keyboard Navigation$/m
  }
};

// Validation Results
class ValidationResult {
  constructor() {
    this.errors = [];
    this.warnings = [];
    this.info = [];
    this.stats = {
      totalFiles: 0,
      validFiles: 0,
      componentsDocumented: 0,
      apisDocumented: 0
    };
  }

  addError(message, file = null) {
    this.errors.push({ message, file, severity: 'error' });
  }

  addWarning(message, file = null) {
    this.warnings.push({ message, file, severity: 'warning' });
  }

  addInfo(message, file = null) {
    this.info.push({ message, file, severity: 'info' });
  }

  hasErrors() {
    return this.errors.length > 0;
  }

  print() {
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
    if (this.hasErrors()) {
      console.log(chalk.red.bold('✗ Documentation validation failed'));
      console.log(chalk.gray('Please fix the errors above before proceeding.'));
    } else if (this.warnings.length > 0) {
      console.log(chalk.yellow.bold('✓ Documentation validation passed with warnings'));
      console.log(chalk.gray('Consider addressing the warnings for better documentation quality.'));
    } else {
      console.log(chalk.green.bold('✓ Documentation validation passed'));
      console.log(chalk.gray('All documentation checks completed successfully.'));
    }
  }

  toJSON() {
    return {
      errors: this.errors,
      warnings: this.warnings,
      info: this.info,
      stats: this.stats,
      success: !this.hasErrors()
    };
  }
}

// Validators
class DocumentationValidator {
  constructor() {
    this.result = new ValidationResult();
  }

  async validate() {
    console.log(chalk.cyan('Starting documentation validation...\n'));
    
    await this.checkRequiredFiles();
    await this.validateMarkdownFiles();
    await this.checkComponentDocumentation();
    await this.checkApiDocumentation();
    await this.checkBrokenLinks();
    await this.validateCodeExamples();
    
    return this.result;
  }

  async checkRequiredFiles() {
    console.log(chalk.gray('Checking required documentation files...'));
    
    for (const file of CONFIG.requiredDocs) {
      const filePath = path.join(process.cwd(), file);
      try {
        await fs.access(filePath);
        this.result.stats.totalFiles++;
      } catch (error) {
        this.result.addError(`Required documentation file missing: ${file}`);
      }
    }
  }

  async validateMarkdownFiles() {
    console.log(chalk.gray('Validating markdown files...'));
    
    const mdFiles = glob.sync('**/*.md', {
      cwd: CONFIG.docsRoot,
      ignore: ['node_modules/**', '**/api/**']
    });

    for (const file of mdFiles) {
      const filePath = path.join(CONFIG.docsRoot, file);
      const content = await fs.readFile(filePath, 'utf-8');
      
      this.result.stats.totalFiles++;
      
      // Check for basic structure
      if (!content.includes('#')) {
        this.result.addWarning('Markdown file missing headers', file);
      }
      
      // Check for code blocks
      const codeBlocks = content.match(/```[\s\S]*?```/g) || [];
      if (codeBlocks.length === 0 && file.includes('components/')) {
        this.result.addWarning('Component documentation missing code examples', file);
      }
      
      // Check component documentation structure
      if (file.includes('components/')) {
        this.validateComponentDoc(content, file);
      }
      
      this.result.stats.validFiles++;
    }
  }

  validateComponentDoc(content, file) {
    const requiredSections = ['Props', 'Usage', 'Accessibility', 'Keyboard Navigation'];
    
    for (const section of requiredSections) {
      const pattern = new RegExp(`^## ${section}`, 'm');
      if (!pattern.test(content)) {
        this.result.addWarning(`Missing section: ${section}`, file);
      }
    }
    
    this.result.stats.componentsDocumented++;
  }

  async checkComponentDocumentation() {
    console.log(chalk.gray('Checking component documentation coverage...'));
    
    const componentFiles = glob.sync('**/*.tsx', {
      cwd: path.join(CONFIG.srcRoot, 'components'),
      ignore: ['**/*.test.tsx', '**/*.spec.tsx']
    });

    for (const component of componentFiles) {
      const componentName = path.basename(component, '.tsx');
      const docPath = `components/${componentName}.md`;
      const fullDocPath = path.join(CONFIG.docsRoot, docPath);
      
      try {
        await fs.access(fullDocPath);
      } catch (error) {
        // Check if it's a UI component that might be documented collectively
        if (!component.includes('/ui/')) {
          this.result.addWarning(`Missing documentation for component: ${componentName}`, component);
        }
      }
    }
  }

  async checkApiDocumentation() {
    console.log(chalk.gray('Checking API documentation...'));
    
    const apiFiles = glob.sync('**/api/**/*.ts', {
      cwd: CONFIG.srcRoot,
      ignore: ['**/*.test.ts', '**/*.spec.ts']
    });

    for (const apiFile of apiFiles) {
      const apiName = path.basename(apiFile, '.ts');
      const docPath = `api/${apiName}.md`;
      const fullDocPath = path.join(CONFIG.docsRoot, docPath);
      
      try {
        await fs.access(fullDocPath);
        this.result.stats.apisDocumented++;
      } catch (error) {
        this.result.addInfo(`Consider adding documentation for API: ${apiName}`, apiFile);
      }
    }
  }

  async checkBrokenLinks() {
    console.log(chalk.gray('Checking for broken links...'));
    
    const mdFiles = glob.sync('**/*.md', {
      cwd: CONFIG.docsRoot,
      ignore: ['node_modules/**']
    });

    for (const file of mdFiles) {
      const filePath = path.join(CONFIG.docsRoot, file);
      const content = await fs.readFile(filePath, 'utf-8');
      
      // Check internal links
      const internalLinks = content.match(/\[.*?\]\((\/[^)]+)\)/g) || [];
      for (const link of internalLinks) {
        const linkPath = link.match(/\((\/[^)]+)\)/)[1];
        const resolvedPath = path.join(process.cwd(), linkPath);
        
        try {
          await fs.access(resolvedPath);
        } catch (error) {
          this.result.addError(`Broken internal link: ${linkPath}`, file);
        }
      }
      
      // Check relative documentation links
      const relativeLinks = content.match(/\[.*?\]\((?!http)([^/)][^)]+)\)/g) || [];
      for (const link of relativeLinks) {
        const linkPath = link.match(/\(([^)]+)\)/)[1];
        const resolvedPath = path.join(path.dirname(filePath), linkPath);
        
        try {
          await fs.access(resolvedPath);
        } catch (error) {
          this.result.addWarning(`Potentially broken relative link: ${linkPath}`, file);
        }
      }
    }
  }

  async validateCodeExamples() {
    console.log(chalk.gray('Validating code examples...'));
    
    const mdFiles = glob.sync('**/*.md', {
      cwd: CONFIG.docsRoot,
      ignore: ['node_modules/**']
    });

    for (const file of mdFiles) {
      const filePath = path.join(CONFIG.docsRoot, file);
      const content = await fs.readFile(filePath, 'utf-8');
      
      // Extract TypeScript/JavaScript code blocks
      const codeBlocks = content.match(/```(?:tsx?|jsx?|javascript|typescript)[\s\S]*?```/g) || [];
      
      for (const block of codeBlocks) {
        // Basic syntax validation
        const code = block.replace(/```(?:tsx?|jsx?|javascript|typescript)?/g, '');
        
        // Check for common issues
        if (code.includes('// TODO') || code.includes('// FIXME')) {
          this.result.addWarning('Code example contains TODO/FIXME comments', file);
        }
        
        // Check for console.log statements
        if (code.includes('console.log')) {
          this.result.addInfo('Code example contains console.log statement', file);
        }
        
        // Check for proper imports in examples
        if (code.includes('<') && !code.includes('import')) {
          this.result.addWarning('React code example might be missing imports', file);
        }
      }
    }
  }
}

// Main execution
async function main() {
  try {
    const validator = new DocumentationValidator();
    const result = await validator.validate();
    
    // Save JSON report
    const reportPath = path.join(process.cwd(), 'doc-validation-report.json');
    await fs.writeFile(reportPath, JSON.stringify(result.toJSON(), null, 2));
    console.log(chalk.gray(`\nDetailed report saved to: ${reportPath}`));
    
    // Print results
    result.print();
    
    // Exit with appropriate code
    process.exit(result.hasErrors() ? 1 : 0);
  } catch (error) {
    console.error(chalk.red('Fatal error during validation:'), error);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

module.exports = { DocumentationValidator, ValidationResult };