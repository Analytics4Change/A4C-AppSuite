#!/usr/bin/env node

/**
 * Documentation-Code Alignment Check
 * Detects when code changes require documentation updates
 */

const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const { sanitizePath, escapeShellArg, isValidProjectPath, DOC_CONFIG } = require('./security-utils.cjs');
const { promisify } = require('util');
const glob = require('glob');
const chalk = require('chalk');

const execAsync = promisify(exec);

// Configuration
const CONFIG = {
  srcRoot: path.join(process.cwd(), 'src'),
  docsRoot: path.join(process.cwd(), 'docs'),
  alignmentRules: [
    {
      name: 'Component Props',
      sourcePattern: 'components/**/*.tsx',
      docPattern: 'docs/components/**/*.md',
      extractor: extractComponentProps,
      validator: validateComponentProps
    },
    {
      name: 'API Endpoints',
      sourcePattern: 'services/api/**/*.ts',
      docPattern: 'docs/api/**/*.md',
      extractor: extractApiEndpoints,
      validator: validateApiEndpoints
    },
    {
      name: 'ViewModels',
      sourcePattern: 'viewModels/**/*.ts',
      docPattern: 'docs/architecture/viewmodels.md',
      extractor: extractViewModelStructure,
      validator: validateViewModelDocs
    },
    {
      name: 'Types and Interfaces',
      sourcePattern: 'types/**/*.ts',
      docPattern: 'docs/api/types.md',
      extractor: extractTypeDefinitions,
      validator: validateTypeDocs
    },
    {
      name: 'Configuration',
      sourcePattern: 'config/**/*.ts',
      docPattern: 'CLAUDE.md',
      extractor: extractConfigValues,
      validator: validateConfigDocs
    }
  ]
};

// Alignment Check Result
class AlignmentResult {
  constructor() {
    this.misalignments = [];
    this.suggestions = [];
    this.stats = {
      filesChecked: 0,
      alignmentScore: 100,
      componentsChecked: 0,
      apisChecked: 0,
      typesChecked: 0
    };
  }

  addMisalignment(category, source, doc, details, suggestion = null, lineNumber = null) {
    this.misalignments.push({
      category,
      source,
      doc,
      details,
      suggestion,
      lineNumber,
      severity: this.calculateSeverity(details)
    });
    this.updateScore();
  }

  addSuggestion(message, files = []) {
    this.suggestions.push({ message, files });
  }

  calculateSeverity(details) {
    if (details.includes('missing') || details.includes('removed')) {
      return 'high';
    }
    if (details.includes('changed') || details.includes('updated')) {
      return 'medium';
    }
    return 'low';
  }

  updateScore() {
    const penalty = this.misalignments.reduce((sum, m) => {
      return sum + (m.severity === 'high' ? 10 : m.severity === 'medium' ? 5 : 2);
    }, 0);
    this.stats.alignmentScore = Math.max(0, 100 - penalty);
  }

  isAligned() {
    return this.misalignments.length === 0;
  }

  print() {
    console.log(chalk.bold('\n🔍 Documentation-Code Alignment Report\n'));
    
    // Print statistics
    console.log(chalk.cyan('Statistics:'));
    console.log(`  Files checked: ${this.stats.filesChecked}`);
    console.log(`  Components: ${this.stats.componentsChecked}`);
    console.log(`  APIs: ${this.stats.apisChecked}`);
    console.log(`  Types: ${this.stats.typesChecked}`);
    console.log(`  Alignment score: ${this.getScoreColor(this.stats.alignmentScore)}%\n`);

    // Print misalignments
    if (this.misalignments.length > 0) {
      console.log(chalk.red.bold(`❌ Misalignments Found (${this.misalignments.length}):\n`));
      
      const grouped = this.groupBySeverity();
      
      if (grouped.high.length > 0) {
        console.log(chalk.red('High Priority:'));
        grouped.high.forEach(m => this.printMisalignment(m));
      }
      
      if (grouped.medium.length > 0) {
        console.log(chalk.yellow('\nMedium Priority:'));
        grouped.medium.forEach(m => this.printMisalignment(m));
      }
      
      if (grouped.low.length > 0) {
        console.log(chalk.blue('\nLow Priority:'));
        grouped.low.forEach(m => this.printMisalignment(m));
      }
    }

    // Print suggestions
    if (this.suggestions.length > 0) {
      console.log(chalk.cyan.bold('\n💡 Suggestions:\n'));
      this.suggestions.forEach(({ message, files }) => {
        console.log(chalk.cyan(`  • ${message}`));
        if (files.length > 0) {
          files.forEach(f => console.log(chalk.gray(`    - ${f}`)));
        }
      });
    }

    // Summary
    console.log();
    if (this.isAligned()) {
      console.log(chalk.green.bold('✓ Documentation is aligned with code'));
    } else {
      console.log(chalk.yellow.bold('⚠ Documentation updates required'));
      console.log(chalk.gray('Please update the documentation to match the code changes.'));
    }
  }

  groupBySeverity() {
    return {
      high: this.misalignments.filter(m => m.severity === 'high'),
      medium: this.misalignments.filter(m => m.severity === 'medium'),
      low: this.misalignments.filter(m => m.severity === 'low')
    };
  }

  printMisalignment(m) {
    const severityIcon = m.severity === 'high' ? '🔴' : m.severity === 'medium' ? '🟡' : '🔵';
    console.log(`  ${severityIcon} ${chalk.bold(m.category)} - ${chalk.cyan(m.source)}${m.lineNumber ? `:${m.lineNumber}` : ''}`);
    console.log(`     Issue: ${m.details}`);
    if (m.doc) {
      console.log(`     Doc: ${chalk.gray(m.doc)}`);
    }
    if (m.suggestion) {
      console.log(`     💡 Fix: ${chalk.green(m.suggestion)}`);
    }
    console.log(); // Add spacing
  }

  getScoreColor(score) {
    if (score >= 90) return chalk.green(score);
    if (score >= 70) return chalk.yellow(score);
    return chalk.red(score);
  }

  toJSON() {
    return {
      aligned: this.isAligned(),
      misalignments: this.misalignments,
      suggestions: this.suggestions,
      stats: this.stats,
      timestamp: new Date().toISOString(),
      prSummary: this.generatePRSummary()
    };
  }

  generatePRSummary() {
    const lines = [];
    
    lines.push('### 🔍 Code-Documentation Alignment Details\n');
    
    if (this.misalignments.length === 0) {
      lines.push('✅ **All documentation is aligned with code**\n');
      return lines.join('\n');
    }

    const grouped = this.groupBySeverity();
    
    if (grouped.high.length > 0) {
      lines.push('#### 🔴 High Priority Issues (Must Fix)');
      grouped.high.slice(0, 5).forEach(m => {
        lines.push(`- **${m.source}${m.lineNumber ? `:${m.lineNumber}` : ''}**: ${m.details}`);
        if (m.suggestion) {
          lines.push(`  - 💡 **Fix**: ${m.suggestion}`);
        }
      });
      if (grouped.high.length > 5) {
        lines.push(`- *...and ${grouped.high.length - 5} more high priority issues*`);
      }
      lines.push('');
    }

    if (grouped.medium.length > 0) {
      lines.push('#### 🟡 Medium Priority Issues');
      grouped.medium.slice(0, 3).forEach(m => {
        lines.push(`- **${m.source}**: ${m.details}`);
        if (m.suggestion) {
          lines.push(`  - 💡 **Fix**: ${m.suggestion}`);
        }
      });
      if (grouped.medium.length > 3) {
        lines.push(`- *...and ${grouped.medium.length - 3} more medium priority issues*`);
      }
      lines.push('');
    }

    // Add summary statistics
    lines.push('#### 📊 Summary');
    lines.push(`- **Total Issues**: ${this.misalignments.length}`);
    lines.push(`- **High Priority**: ${grouped.high.length}`);
    lines.push(`- **Medium Priority**: ${grouped.medium.length}`);
    lines.push(`- **Low Priority**: ${grouped.low.length}`);
    lines.push(`- **Alignment Score**: ${this.stats.alignmentScore}%\n`);

    if (this.suggestions.length > 0) {
      lines.push('#### 💡 General Suggestions');
      this.suggestions.slice(0, 3).forEach(s => {
        lines.push(`- ${s.message}`);
      });
      lines.push('');
    }

    lines.push('**📋 Next Steps**: Download the detailed alignment report artifact for complete file listings and fix suggestions.');
    
    return lines.join('\n');
  }
}

// Extractors - Parse source code to extract documentation-relevant information
async function extractComponentProps(filePath) {
  const safePath = sanitizePath(filePath);
  const content = await fs.readFile(safePath, 'utf-8');
  const props = {};
  
  // Extract interface Props
  const propsMatch = content.match(/interface\s+\w*Props\s*{([^}]+)}/);
  if (propsMatch) {
    const propsContent = propsMatch[1];
    const propLines = propsContent.split('\n').filter(line => line.trim());
    
    propLines.forEach(line => {
      const propMatch = line.match(/(\w+)(\?)?:\s*([^;]+)/);
      if (propMatch) {
        props[propMatch[1]] = {
          name: propMatch[1],
          required: !propMatch[2],
          type: propMatch[3].trim()
        };
      }
    });
  }
  
  // Extract default props
  const defaultPropsMatch = content.match(/defaultProps\s*=\s*{([^}]+)}/);
  if (defaultPropsMatch) {
    const defaultsContent = defaultPropsMatch[1];
    const defaultLines = defaultsContent.split(',').filter(line => line.trim());
    
    defaultLines.forEach(line => {
      const defaultMatch = line.match(/(\w+):\s*(.+)/);
      if (defaultMatch && props[defaultMatch[1]]) {
        props[defaultMatch[1]].default = defaultMatch[2].trim();
      }
    });
  }
  
  return props;
}

async function extractApiEndpoints(filePath) {
  const safePath = sanitizePath(filePath);
  const content = await fs.readFile(safePath, 'utf-8');
  const endpoints = [];
  
  // Extract API method definitions
  const methodMatches = content.matchAll(/(get|post|put|patch|delete|GET|POST|PUT|PATCH|DELETE)\s*\(\s*['"`]([^'"`]+)['"`]/g);
  
  for (const match of methodMatches) {
    endpoints.push({
      method: match[1].toUpperCase(),
      path: match[2]
    });
  }
  
  // Extract interface definitions for request/response types
  const interfaceMatches = content.matchAll(/interface\s+(\w+(?:Request|Response|Payload|Data))\s*{([^}]+)}/g);
  
  for (const match of interfaceMatches) {
    const fields = {};
    const fieldLines = match[2].split('\n').filter(line => line.trim());
    
    fieldLines.forEach(line => {
      const fieldMatch = line.match(/(\w+)(\?)?:\s*([^;]+)/);
      if (fieldMatch) {
        fields[fieldMatch[1]] = {
          required: !fieldMatch[2],
          type: fieldMatch[3].trim()
        };
      }
    });
    
    endpoints.push({
      type: match[1],
      fields
    });
  }
  
  return endpoints;
}

async function extractViewModelStructure(filePath) {
  const safePath = sanitizePath(filePath);
  const content = await fs.readFile(safePath, 'utf-8');
  const structure = {
    observables: [],
    computed: [],
    actions: []
  };
  
  // Extract @observable fields
  const observableMatches = content.matchAll(/@observable\s+(\w+)/g);
  for (const match of observableMatches) {
    structure.observables.push(match[1]);
  }
  
  // Extract @computed getters
  const computedMatches = content.matchAll(/@computed\s+get\s+(\w+)/g);
  for (const match of computedMatches) {
    structure.computed.push(match[1]);
  }
  
  // Extract @action methods
  const actionMatches = content.matchAll(/@action\s+(\w+)/g);
  for (const match of actionMatches) {
    structure.actions.push(match[1]);
  }
  
  // Also check for makeAutoObservable pattern
  if (content.includes('makeAutoObservable')) {
    // Extract class methods as potential actions
    const methodMatches = content.matchAll(/^\s*(async\s+)?(\w+)\s*\([^)]*\)\s*{/gm);
    for (const match of methodMatches) {
      if (!match[2].startsWith('get') && match[2] !== 'constructor') {
        structure.actions.push(match[2]);
      }
    }
    
    // Extract getters as computed
    const getterMatches = content.matchAll(/^\s*get\s+(\w+)\s*\(\)/gm);
    for (const match of getterMatches) {
      if (!structure.computed.includes(match[1])) {
        structure.computed.push(match[1]);
      }
    }
  }
  
  return structure;
}

async function extractTypeDefinitions(filePath) {
  const safePath = sanitizePath(filePath);
  const content = await fs.readFile(safePath, 'utf-8');
  const types = {};
  
  // Extract type aliases
  const typeMatches = content.matchAll(/export\s+type\s+(\w+)\s*=\s*([^;]+);/g);
  for (const match of typeMatches) {
    types[match[1]] = {
      kind: 'type',
      definition: match[2].trim()
    };
  }
  
  // Extract interfaces
  const interfaceMatches = content.matchAll(/export\s+interface\s+(\w+)\s*(?:extends\s+([^{]+))?\s*{([^}]+)}/g);
  for (const match of interfaceMatches) {
    const fields = {};
    const fieldLines = match[3].split('\n').filter(line => line.trim());
    
    fieldLines.forEach(line => {
      const fieldMatch = line.match(/(\w+)(\?)?:\s*([^;]+)/);
      if (fieldMatch) {
        fields[fieldMatch[1]] = {
          required: !fieldMatch[2],
          type: fieldMatch[3].trim()
        };
      }
    });
    
    types[match[1]] = {
      kind: 'interface',
      extends: match[2] ? match[2].trim() : null,
      fields
    };
  }
  
  // Extract enums
  const enumMatches = content.matchAll(/export\s+enum\s+(\w+)\s*{([^}]+)}/g);
  for (const match of enumMatches) {
    const values = match[2].split(',')
      .map(v => v.trim())
      .filter(v => v)
      .map(v => v.split('=')[0].trim());
    
    types[match[1]] = {
      kind: 'enum',
      values
    };
  }
  
  return types;
}

async function extractConfigValues(filePath) {
  const safePath = sanitizePath(filePath);
  const content = await fs.readFile(safePath, 'utf-8');
  const config = {};
  
  // Extract exported constants
  const constMatches = content.matchAll(/export\s+const\s+(\w+)\s*=\s*({[^}]+}|[^;]+);/g);
  for (const match of constMatches) {
    config[match[1]] = match[2].trim();
  }
  
  return config;
}

// Validators - Check if documentation matches extracted code information
async function validateComponentProps(codeProps, docPath) {
  try {
    const docContent = await fs.readFile(docPath, 'utf-8');
    const issues = [];
    
    // Check if Props section exists
    if (!docContent.includes('## Props')) {
      issues.push('Missing Props section in documentation');
      return issues;
    }
    
    // Extract props table from documentation
    const propsSection = docContent.match(/## Props[\s\S]*?(?=##|$)/);
    if (!propsSection) {
      issues.push('Props section is empty');
      return issues;
    }
    
    const docProps = new Set();
    const tableRows = propsSection[0].match(/\|[^|]+\|[^|]+\|[^|]+\|[^|]+\|[^|]+\|/g) || [];
    
    tableRows.forEach(row => {
      const match = row.match(/\|\s*(\w+)\s*\|/);
      if (match && match[1] !== 'Prop') {
        docProps.add(match[1]);
      }
    });
    
    // Compare code props with documented props
    Object.keys(codeProps).forEach(prop => {
      if (!docProps.has(prop)) {
        issues.push(`Prop '${prop}' is not documented`);
      }
    });
    
    // Check for documented props that don't exist in code
    docProps.forEach(prop => {
      if (!codeProps[prop] && prop !== 'Prop') {
        issues.push(`Documented prop '${prop}' does not exist in code`);
      }
    });
    
    return issues;
  } catch (error) {
    return [`Documentation file not found: ${docPath}`];
  }
}

async function validateApiEndpoints(endpoints, docPath) {
  try {
    const docContent = await fs.readFile(docPath, 'utf-8');
    const issues = [];
    
    // Check each endpoint
    endpoints.forEach(endpoint => {
      if (endpoint.method && endpoint.path) {
        const endpointString = `${endpoint.method} ${endpoint.path}`;
        if (!docContent.includes(endpointString)) {
          issues.push(`Endpoint '${endpointString}' is not documented`);
        }
      }
      
      if (endpoint.type && endpoint.fields) {
        if (!docContent.includes(endpoint.type)) {
          issues.push(`Type '${endpoint.type}' is not documented`);
        }
      }
    });
    
    return issues;
  } catch (error) {
    return endpoints.length > 0 ? [`Documentation file not found: ${docPath}`] : [];
  }
}

async function validateViewModelDocs(structure, docPath) {
  try {
    const docContent = await fs.readFile(docPath, 'utf-8');
    const issues = [];
    
    // Check if ViewModels are documented
    structure.observables.forEach(obs => {
      if (!docContent.includes(obs)) {
        issues.push(`Observable '${obs}' is not documented`);
      }
    });
    
    structure.computed.forEach(comp => {
      if (!docContent.includes(comp)) {
        issues.push(`Computed property '${comp}' is not documented`);
      }
    });
    
    structure.actions.forEach(action => {
      if (!docContent.includes(action)) {
        issues.push(`Action '${action}' is not documented`);
      }
    });
    
    return issues;
  } catch (error) {
    return structure.observables.length > 0 || structure.actions.length > 0
      ? [`ViewModel documentation not found: ${docPath}`]
      : [];
  }
}

async function validateTypeDocs(types, docPath) {
  try {
    const docContent = await fs.readFile(docPath, 'utf-8');
    const issues = [];
    
    Object.keys(types).forEach(typeName => {
      if (!docContent.includes(typeName)) {
        issues.push(`Type '${typeName}' is not documented`);
      }
    });
    
    return issues;
  } catch (error) {
    return Object.keys(types).length > 0
      ? [`Type documentation not found: ${docPath}`]
      : [];
  }
}

async function validateConfigDocs(config, docPath) {
  try {
    const docContent = await fs.readFile(docPath, 'utf-8');
    const issues = [];
    
    // Only check for important config values
    const importantConfigs = Object.keys(config).filter(key => 
      key.includes('TIMING') || key.includes('CONFIG') || key.includes('DEFAULT')
    );
    
    importantConfigs.forEach(configKey => {
      if (!docContent.includes(configKey)) {
        issues.push(`Configuration '${configKey}' is not documented`);
      }
    });
    
    return issues;
  } catch (error) {
    return [`Configuration documentation not found: ${docPath}`];
  }
}

// Main alignment checker
class AlignmentChecker {
  constructor() {
    this.result = new AlignmentResult();
  }

  async check() {
    console.log(chalk.cyan('Checking documentation-code alignment...\n'));
    
    for (const rule of CONFIG.alignmentRules) {
      await this.checkRule(rule);
    }
    
    // Add suggestions based on findings
    this.generateSuggestions();
    
    return this.result;
  }

  async checkRule(rule) {
    console.log(chalk.gray(`Checking ${rule.name}...`));
    
    const sourceFiles = glob.sync(rule.sourcePattern, {
      cwd: CONFIG.srcRoot
    });
    
    for (const sourceFile of sourceFiles) {
      const sourcePath = path.join(CONFIG.srcRoot, sourceFile);
      this.result.stats.filesChecked++;
      
      // Update category stats
      if (rule.name.includes('Component')) {
        this.result.stats.componentsChecked++;
      } else if (rule.name.includes('API')) {
        this.result.stats.apisChecked++;
      } else if (rule.name.includes('Type')) {
        this.result.stats.typesChecked++;
      }
      
      // Extract information from source
      const extracted = await rule.extractor(sourcePath);
      
      // Determine corresponding doc file
      const docFile = this.getDocFile(sourceFile, rule);
      
      // Validate against documentation
      const issues = await rule.validator(extracted, docFile);
      
      // Record misalignments
      issues.forEach(issue => {
        this.result.addMisalignment(
          rule.name,
          sourceFile,
          path.relative(process.cwd(), docFile),
          issue
        );
      });
    }
  }

  getDocFile(sourceFile, rule) {
    // Handle different documentation mapping patterns
    if (typeof rule.docPattern === 'string') {
      if (rule.docPattern.includes('**')) {
        // Map source file to doc file
        const baseName = path.basename(sourceFile, path.extname(sourceFile));
        return path.join(CONFIG.docsRoot, 'components', `${baseName}.md`);
      } else {
        // Fixed doc file
        return path.join(process.cwd(), rule.docPattern);
      }
    }
    return rule.docPattern;
  }

  generateSuggestions() {
    const misalignmentsByCategory = {};
    
    this.result.misalignments.forEach(m => {
      if (!misalignmentsByCategory[m.category]) {
        misalignmentsByCategory[m.category] = [];
      }
      misalignmentsByCategory[m.category].push(m);
    });
    
    // Generate category-specific suggestions
    Object.entries(misalignmentsByCategory).forEach(([category, misalignments]) => {
      if (misalignments.length > 3) {
        this.result.addSuggestion(
          `Consider running documentation generation for ${category}`,
          misalignments.map(m => m.source).slice(0, 3)
        );
      }
    });
    
    // General suggestions based on alignment score
    if (this.result.stats.alignmentScore < 70) {
      this.result.addSuggestion(
        'Documentation is significantly out of sync. Consider a documentation sprint.'
      );
    } else if (this.result.stats.alignmentScore < 90) {
      this.result.addSuggestion(
        'Some documentation updates needed. Address high priority items first.'
      );
    }
  }
}

// Git integration for checking changed files
async function getChangedFiles() {
  try {
    // Check if we're in a git repository
    await execAsync('git rev-parse --git-dir');
    
    // Get current branch name safely
    const { stdout: branchOutput } = await execAsync('git rev-parse --abbrev-ref HEAD');
    const currentBranch = branchOutput.trim();
    
    // Validate branch name (prevent injection)
    const safeBranchName = escapeShellArg(currentBranch);
    
    // Get list of changed files compared to main branch with safe command
    const gitCommand = `git diff --name-only main...${safeBranchName}`;
    const { stdout } = await execAsync(gitCommand);
    
    // Filter and validate file paths
    const files = stdout.trim().split('\n').filter(f => f && isValidProjectPath(f));
    return files;
  } catch (error) {
    // Not in a git repo or no changes
    return [];
  }
}

// Main execution
async function main() {
  try {
    const checker = new AlignmentChecker();
    const result = await checker.check();
    
    // Check for changed files if in git repo
    const changedFiles = await getChangedFiles();
    if (changedFiles.length > 0) {
      console.log(chalk.gray(`\nDetected ${changedFiles.length} changed files in current branch.`));
      
      // Filter misalignments to only changed files
      const relevantMisalignments = result.misalignments.filter(m => 
        changedFiles.some(f => f.includes(m.source))
      );
      
      if (relevantMisalignments.length > 0) {
        console.log(chalk.yellow('Documentation updates needed for changed files:'));
        relevantMisalignments.forEach(m => {
          console.log(chalk.yellow(`  • ${m.source}: ${m.details}`));
        });
      }
    }
    
    // Save JSON report
    const reportPath = path.join(process.cwd(), 'doc-alignment-report.json');
    await fs.writeFile(reportPath, JSON.stringify(result.toJSON(), null, 2));
    console.log(chalk.gray(`\nDetailed report saved to: ${reportPath}`));
    
    // Print results
    result.print();
    
    // Exit with appropriate code
    process.exit(result.isAligned() ? 0 : 1);
  } catch (error) {
    console.error(chalk.red('Fatal error during alignment check:'), error);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

module.exports = { AlignmentChecker, AlignmentResult };