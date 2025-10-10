#!/usr/bin/env node

/**
 * Documentation-Code Alignment Check
 * Detects when code changes require documentation updates
 * Converted from CommonJS to TypeScript with enhanced security and logging
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';
import { glob } from 'glob';
import chalk from 'chalk';

import { sanitizePath, isValidProjectPath, SECURITY_CONFIG } from '../utils/security.js';
import { getLogger, createLogger } from '../utils/logger.js';
import { createProgress, ProgressTracker } from '../utils/progress.js';
import { configManager } from '../config/manager.js';

const logger = getLogger('doc-alignment');

// Enhanced cache for glob results with TTL
interface CacheEntry {
  result: string[];
  timestamp: number;
  ttl: number;
}

const globCache = new Map<string, CacheEntry>();

/**
 * Cached glob function with TTL to improve performance
 */
async function cachedGlob(pattern: string, options: any = {}): Promise<string[]> {
  const cacheKey = JSON.stringify({ pattern, options });
  const cacheConfig = configManager.get('cache');
  
  if (cacheConfig.enabled && globCache.has(cacheKey)) {
    const entry = globCache.get(cacheKey)!;
    if (Date.now() - entry.timestamp < entry.ttl) {
      logger.debug('Cache hit for glob pattern', { pattern });
      return entry.result;
    } else {
      globCache.delete(cacheKey);
    }
  }
  
  logger.debug('Executing glob pattern', { pattern, options });
  const result = await glob(pattern, options);
  
  if (cacheConfig.enabled) {
    globCache.set(cacheKey, {
      result,
      timestamp: Date.now(),
      ttl: cacheConfig.ttlMs
    });
  }
  
  return result;
}

/**
 * Git command execution options
 */
interface GitExecOptions {
  timeout?: number;
  cwd?: string;
}

/**
 * Secure wrapper for executing git commands using spawn with argument arrays
 */
async function secureGitExec(args: string[], options: GitExecOptions = {}): Promise<string> {
  const { timeout = 10000, cwd = process.cwd() } = options;
  
  return new Promise<string>((resolve, reject) => {
    // Validate input arguments
    if (!Array.isArray(args) || args.length === 0) {
      reject(new Error('Git arguments must be a non-empty array'));
      return;
    }
    
    // Validate argument safety
    for (const arg of args) {
      if (typeof arg !== 'string') {
        reject(new Error(`Invalid git argument type: ${typeof arg}`));
        return;
      }
      
      // Allow some special characters that are safe in git commands
      const safeChars = /^[a-zA-Z0-9._\\/-]+$/;
      const specialSafePatterns = ['--', '...', '@', '^', '~'];
      
      if (!safeChars.test(arg) && !specialSafePatterns.some(safe => arg.includes(safe))) {
        reject(new Error(`Potentially unsafe git argument: ${arg}`));
        return;
      }
    }

    logger.debug('Executing git command', { args, timeout, cwd });

    const gitProcess: ChildProcess = spawn('git', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false, // Explicitly disable shell to prevent injection
      cwd,
    });

    let stdout = '';
    let stderr = '';
    let timeoutId: NodeJS.Timeout | undefined;

    // Set up timeout
    if (timeout > 0) {
      timeoutId = setTimeout(() => {
        gitProcess.kill('SIGTERM');
        reject(new Error(`Git command timed out after ${timeout}ms: git ${args.join(' ')}`));
      }, timeout);
    }

    gitProcess.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    gitProcess.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    gitProcess.on('close', (code: number | null) => {
      if (timeoutId) clearTimeout(timeoutId);
      
      if (code === 0) {
        logger.debug('Git command completed successfully', { args, outputLength: stdout.length });
        resolve(stdout);
      } else {
        const errorMsg = stderr.trim() || `Git command exited with code ${code}`;
        const error = new Error(`Git command failed: ${errorMsg} (Command: git ${args.join(' ')})`);
        logger.error('Git command failed', error, { args, code, stderr: stderr.trim() });
        reject(error);
      }
    });

    gitProcess.on('error', (error: Error & { code?: string }) => {
      if (timeoutId) clearTimeout(timeoutId);
      
      let errorMessage: string;
      if (error.code === 'ENOENT') {
        errorMessage = 'Git is not installed or not in PATH';
      } else if (error.code === 'EACCES') {
        errorMessage = 'Permission denied executing git command';
      } else {
        errorMessage = `Failed to execute git command: ${error.message}`;
      }
      
      const enhancedError = new Error(errorMessage);
      logger.error('Git command execution error', enhancedError, { args, originalError: error });
      reject(enhancedError);
    });
  });
}

/**
 * Rule for checking alignment between code and documentation
 */
interface AlignmentRule {
  name: string;
  sourcePattern: string;
  docPattern: string;
  extractor: (content: string, filePath: string) => Promise<any[]>;
  validator: (sourceData: any[], docContent: string, docPath: string) => Promise<ValidationResult>;
}

/**
 * Result of validation check
 */
interface ValidationResult {
  isValid: boolean;
  missingElements: string[];
  outdatedElements: string[];
  suggestions: string[];
  severity: 'low' | 'medium' | 'high';
}

/**
 * File change information
 */
interface FileChange {
  path: string;
  type: 'added' | 'modified' | 'deleted';
  timestamp: Date;
}

/**
 * Configuration for alignment checking
 */
const CONFIG = {
  srcRoot: join(process.cwd(), 'src'),
  docsRoot: join(process.cwd(), 'docs'),
  alignmentRules: [
    {
      name: 'API Endpoints',
      sourcePattern: 'src/services/api/**/*.ts',
      docPattern: 'docs/api/**/*.md',
      extractor: extractApiEndpoints,
      validator: validateApiEndpoints
    },
    {
      name: 'ViewModels',
      sourcePattern: 'src/viewModels/**/*.ts',
      docPattern: 'docs/architecture/viewmodels.md',
      extractor: extractViewModelStructure,
      validator: validateViewModelDocs
    },
    {
      name: 'Types and Interfaces',
      sourcePattern: 'src/types/**/*.ts',
      docPattern: 'docs/api/types.md',
      extractor: extractTypeDefinitions,
      validator: validateTypeDocs
    }
  ] as AlignmentRule[]
};

/**
 * Parse property definitions from interface/type body
 */
function parseProperties(body: string): any[] {
  const properties: any[] = [];
  const lines = body.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  
  for (const line of lines) {
    const propMatch = line.match(/(\w+)(\??):\s*([^;]+);?/);
    if (propMatch) {
      const [, name, optional, type] = propMatch;
      properties.push({
        name,
        type: type.trim(),
        optional: !!optional,
        description: extractJSDocDescription(line)
      });
    }
  }
  
  return properties;
}

/**
 * Extract JSDoc description from a line
 */
function extractJSDocDescription(line: string): string | undefined {
  const commentMatch = line.match(/\/\*\*\s*(.+?)\s*\*\//);
  return commentMatch ? commentMatch[1] : undefined;
}

/**
 * Extract API endpoints from service files
 */
async function extractApiEndpoints(content: string, filePath: string): Promise<any[]> {
  logger.debug('Extracting API endpoints', { filePath });
  
  const endpoints: any[] = [];
  
  // Skip interface files - they define contracts, not implementations
  if (filePath.includes('/interfaces/') || filePath.includes('Interface') || content.includes('export interface')) {
    logger.debug('Skipping interface file', { filePath });
    return endpoints;
  }
  
  // Extract method definitions that look like API endpoints
  const methodRegex = /(?:public\s+)?(?:async\s+)?(\w+)\s*\([^)]*\):\s*Promise<([^>]+)>/g;
  
  let match;
  while ((match = methodRegex.exec(content)) !== null) {
    const [fullMatch, methodName, returnType] = match;
    
    // Skip common non-API methods
    if (['constructor', 'toString', 'valueOf'].includes(methodName)) {
      continue;
    }
    
    // Skip private methods by checking if the method is preceded by 'private'
    const methodStart = content.indexOf(fullMatch);
    const beforeMethod = content.substring(Math.max(0, methodStart - 50), methodStart);
    if (beforeMethod.includes('private')) {
      continue;
    }
    
    endpoints.push({
      name: methodName,
      returnType,
      source: filePath,
      isAsync: content.includes(`async ${methodName}`)
    });
  }
  
  logger.debug('Extracted API endpoints', { filePath, endpointsCount: endpoints.length });
  return endpoints;
}

/**
 * Validate API endpoints documentation
 */
async function validateApiEndpoints(sourceData: any[], docContent: string, docPath: string): Promise<ValidationResult> {
  logger.debug('Validating API endpoints documentation', { docPath, sourceDataCount: sourceData.length });
  
  const result: ValidationResult = {
    isValid: true,
    missingElements: [],
    outdatedElements: [],
    suggestions: [],
    severity: 'low'
  };
  
  // Only validate endpoints against relevant documentation files
  // Skip validation if this doc file doesn't seem to be for the same API
  const docFileName = docPath.toLowerCase();
  
  // Group endpoints by their source to match with appropriate docs
  const endpointsBySource = new Map<string, any[]>();
  for (const endpoint of sourceData) {
    const sourceFile = endpoint.source || '';
    if (!endpointsBySource.has(sourceFile)) {
      endpointsBySource.set(sourceFile, []);
    }
    endpointsBySource.get(sourceFile)!.push(endpoint);
  }
  
  // Determine which endpoints are relevant for this doc file
  let relevantEndpoints: any[] = [];
  
  if (docFileName.includes('medication')) {
    // For medication API docs, only check medication API endpoints
    relevantEndpoints = sourceData.filter(ep => 
      ep.source.includes('Medication') || ep.source.includes('medication')
    );
  } else if (docFileName.includes('client')) {
    // For client API docs, only check client API endpoints
    relevantEndpoints = sourceData.filter(ep => 
      ep.source.includes('Client') || ep.source.includes('client')
    );
  } else if (docFileName.includes('cache')) {
    // For cache service docs, only check cache-related endpoints
    relevantEndpoints = sourceData.filter(ep => 
      ep.source.includes('Cache') || ep.source.includes('cache')
    );
  } else if (docFileName.includes('types')) {
    // Types documentation doesn't need to list API endpoints
    relevantEndpoints = [];
  } else {
    // For other docs, check all endpoints
    relevantEndpoints = sourceData;
  }
  
  for (const endpoint of relevantEndpoints) {
    if (!docContent.includes(endpoint.name)) {
      result.missingElements.push(`API Endpoint: ${endpoint.name}`);
      result.isValid = false;
    }
  }
  
  if (result.missingElements.length > 0) {
    result.severity = result.missingElements.length > 3 ? 'high' : 'medium';
  }
  
  return result;
}

/**
 * Extract ViewModel structure from files
 */
async function extractViewModelStructure(content: string, filePath: string): Promise<any[]> {
  logger.debug('Extracting ViewModel structure', { filePath });
  
  const viewModels: any[] = [];
  
  // Extract class definitions that look like ViewModels
  const classRegex = /class\s+(\w+ViewModel)\s*(?:extends\s+\w+)?\s*\{([^}]+(?:\{[^}]*\}[^}]*)*)\}/g;
  
  let match;
  while ((match = classRegex.exec(content)) !== null) {
    const [, className, classBody] = match;
    
    viewModels.push({
      name: className,
      properties: extractClassProperties(classBody),
      methods: extractClassMethods(classBody),
      source: filePath
    });
  }
  
  logger.debug('Extracted ViewModel structure', { filePath, viewModelsCount: viewModels.length });
  return viewModels;
}

/**
 * Extract class properties from class body
 */
function extractClassProperties(classBody: string): any[] {
  const properties: any[] = [];
  const propertyRegex = /(private|public|protected)?\s*(\w+):\s*([^;=]+)[;=]/g;
  
  let match;
  while ((match = propertyRegex.exec(classBody)) !== null) {
    const [, visibility, name, type] = match;
    properties.push({
      name,
      type: type.trim(),
      visibility: visibility || 'public'
    });
  }
  
  return properties;
}

/**
 * Extract class methods from class body
 */
function extractClassMethods(classBody: string): any[] {
  const methods: any[] = [];
  const methodRegex = /(private|public|protected)?\s*(async\s+)?(\w+)\s*\([^)]*\)(?::\s*([^{]+))?\s*\{/g;
  
  let match;
  while ((match = methodRegex.exec(classBody)) !== null) {
    const [, visibility, isAsync, name, returnType] = match;
    methods.push({
      name,
      returnType: returnType?.trim(),
      visibility: visibility || 'public',
      isAsync: !!isAsync
    });
  }
  
  return methods;
}

/**
 * Validate ViewModel documentation
 */
async function validateViewModelDocs(sourceData: any[], docContent: string, docPath: string): Promise<ValidationResult> {
  logger.debug('Validating ViewModel documentation', { docPath, sourceDataCount: sourceData.length });
  
  const result: ValidationResult = {
    isValid: true,
    missingElements: [],
    outdatedElements: [],
    suggestions: [],
    severity: 'low'
  };
  
  for (const viewModel of sourceData) {
    if (!docContent.includes(viewModel.name)) {
      result.missingElements.push(`ViewModel: ${viewModel.name}`);
      result.isValid = false;
    }
  }
  
  return result;
}

/**
 * Extract type definitions from TypeScript files
 */
async function extractTypeDefinitions(content: string, filePath: string): Promise<any[]> {
  logger.debug('Extracting type definitions', { filePath });
  
  const types: any[] = [];
  
  // Extract interface and type definitions
  const interfaceRegex = /export\s+interface\s+(\w+)\s*(?:extends\s+[^{]+)?\s*\{([^}]+(?:\{[^}]*\}[^}]*)*)\}/g;
  const typeRegex = /export\s+type\s+(\w+)\s*=\s*([^;]+);/g;
  
  let match;
  
  // Extract interfaces
  while ((match = interfaceRegex.exec(content)) !== null) {
    const [, name, body] = match;
    types.push({
      name,
      kind: 'interface',
      properties: parseProperties(body),
      source: filePath
    });
  }
  
  // Extract types
  while ((match = typeRegex.exec(content)) !== null) {
    const [, name, definition] = match;
    types.push({
      name,
      kind: 'type',
      definition: definition.trim(),
      source: filePath
    });
  }
  
  logger.debug('Extracted type definitions', { filePath, typesCount: types.length });
  return types;
}

/**
 * Validate type documentation
 */
async function validateTypeDocs(sourceData: any[], docContent: string, docPath: string): Promise<ValidationResult> {
  logger.debug('Validating type documentation', { docPath, sourceDataCount: sourceData.length });
  
  const result: ValidationResult = {
    isValid: true,
    missingElements: [],
    outdatedElements: [],
    suggestions: [],
    severity: 'low'
  };
  
  for (const type of sourceData) {
    if (!docContent.includes(type.name)) {
      result.missingElements.push(`Type: ${type.name}`);
      result.isValid = false;
    }
  }
  
  return result;
}

/**
 * Get recently changed files from git
 */
async function getRecentlyChangedFiles(since: string = '7 days ago'): Promise<FileChange[]> {
  const operation = logger.start('getRecentlyChangedFiles', { since });
  
  try {
    const output = await secureGitExec([
      'log',
      '--name-status',
      '--pretty=format:%H|%ad|%s',
      '--date=iso',
      `--since=${since}`,
      '--no-merges'
    ]);
    
    const changes: FileChange[] = [];
    const lines = output.split('\n').filter(line => line.trim());
    
    let currentCommit: { hash: string; date: string; message: string } | null = null;
    
    for (const line of lines) {
      if (line.includes('|')) {
        // Commit line
        const [hash, date, ...messageParts] = line.split('|');
        currentCommit = { hash, date, message: messageParts.join('|') };
      } else if (currentCommit && line.match(/^[AMD]\s+/)) {
        // File change line
        const [changeType, ...pathParts] = line.split('\t');
        const filePath = pathParts.join('\t');
        
        if (isValidProjectPath(filePath)) {
          changes.push({
            path: filePath,
            type: changeType === 'A' ? 'added' : changeType === 'M' ? 'modified' : 'deleted',
            timestamp: new Date(currentCommit.date)
          });
        }
      }
    }
    
    operation.complete('getRecentlyChangedFiles', { changesCount: changes.length });
    return changes;
  } catch (error) {
    operation.failed('getRecentlyChangedFiles', error);
    throw error;
  }
}

/**
 * Check alignment for a specific rule
 */
async function checkRuleAlignment(rule: AlignmentRule, changedFiles: FileChange[]): Promise<ValidationResult> {
  const operation = logger.start('checkRuleAlignment', { ruleName: rule.name });
  
  try {
    // Find source files matching the pattern
    const sourceFiles = await cachedGlob(rule.sourcePattern);
    
    // Filter to only check files that have changed recently
    const relevantSourceFiles = sourceFiles.filter(sourceFile => 
      changedFiles.some(change => change.path === sourceFile)
    );
    
    if (relevantSourceFiles.length === 0) {
      logger.debug('No relevant changed files for rule', { ruleName: rule.name });
      return {
        isValid: true,
        missingElements: [],
        outdatedElements: [],
        suggestions: [],
        severity: 'low'
      };
    }
    
    // Extract data from source files
    const sourceData: any[] = [];
    
    for (const sourceFile of relevantSourceFiles) {
      try {
        const content = await fs.readFile(sourceFile, 'utf-8');
        const extracted = await rule.extractor(content, sourceFile);
        sourceData.push(...extracted);
      } catch (error) {
        logger.warn('Failed to extract data from source file', { sourceFile, error });
      }
    }
    
    // Find documentation files
    const docFiles = await cachedGlob(rule.docPattern);
    
    // Validate against documentation
    const results: ValidationResult[] = [];
    
    for (const docFile of docFiles) {
      try {
        const docContent = await fs.readFile(docFile, 'utf-8');
        const result = await rule.validator(sourceData, docContent, docFile);
        results.push(result);
      } catch (error) {
        logger.warn('Failed to validate documentation file', { docFile, error });
      }
    }
    
    // Combine results
    const combinedResult: ValidationResult = {
      isValid: results.every(r => r.isValid),
      missingElements: results.flatMap(r => r.missingElements),
      outdatedElements: results.flatMap(r => r.outdatedElements),
      suggestions: results.flatMap(r => r.suggestions),
      severity: results.reduce((max, r) => 
        r.severity === 'high' ? 'high' : 
        (r.severity === 'medium' && max !== 'high') ? 'medium' : max, 
        'low' as 'low' | 'medium' | 'high')
    };
    
    operation.complete('checkRuleAlignment', { 
      ruleName: rule.name, 
      isValid: combinedResult.isValid,
      issuesCount: combinedResult.missingElements.length + combinedResult.outdatedElements.length
    });
    
    return combinedResult;
  } catch (error) {
    operation.failed('checkRuleAlignment', error);
    throw error;
  }
}

/**
 * Generate alignment report
 */
function generateReport(results: Map<string, ValidationResult>): void {
  const operation = logger.start('generateReport');
  
  console.log(chalk.bold('\\n📋 Documentation-Code Alignment Report'));
  console.log(chalk.gray('=' .repeat(50)));
  
  let totalIssues = 0;
  let highSeverityCount = 0;
  
  for (const [ruleName, result] of results) {
    const issueCount = result.missingElements.length + result.outdatedElements.length;
    totalIssues += issueCount;
    
    if (result.severity === 'high') {
      highSeverityCount++;
    }
    
    const statusIcon = result.isValid ? '✅' : '❌';
    const severityColor = result.severity === 'high' ? chalk.red : 
                         result.severity === 'medium' ? chalk.yellow : chalk.green;
    
    console.log(`\\n${statusIcon} ${chalk.bold(ruleName)}`);
    console.log(`   Severity: ${severityColor(result.severity.toUpperCase())}`);
    
    if (issueCount > 0) {
      console.log(`   Issues: ${issueCount}`);
      
      if (result.missingElements.length > 0) {
        console.log(`   Missing: ${result.missingElements.slice(0, 3).join(', ')}${result.missingElements.length > 3 ? '...' : ''}`);
      }
      
      if (result.outdatedElements.length > 0) {
        console.log(`   Outdated: ${result.outdatedElements.slice(0, 3).join(', ')}${result.outdatedElements.length > 3 ? '...' : ''}`);
      }
    }
  }
  
  console.log(chalk.gray('\\n' + '=' .repeat(50)));
  console.log(`${chalk.bold('Summary:')} ${totalIssues} total issues found`);
  
  if (highSeverityCount > 0) {
    console.log(chalk.red(`⚠️  ${highSeverityCount} high severity issues require immediate attention`));
  }
  
  if (totalIssues === 0) {
    console.log(chalk.green('🎉 All documentation is up to date!'));
  }
  
  operation.complete('generateReport', { totalIssues, highSeverityCount });
}

/**
 * Main execution function
 */
async function main(): Promise<void> {
  const mainLogger = logger.start('main');
  
  try {
    console.log(chalk.bold('🔍 Checking Documentation-Code Alignment...'));
    
    // Get recently changed files
    const changedFiles = await getRecentlyChangedFiles();
    
    if (changedFiles.length === 0) {
      console.log(chalk.green('✅ No recent changes detected. Documentation alignment check skipped.'));
      return;
    }
    
    console.log(`Found ${changedFiles.length} recently changed files`);
    
    // Create progress tracker
    const progress = new ProgressTracker(CONFIG.alignmentRules.length, {
      message: 'Checking alignment rules...',
      style: configManager.get('progress').style
    });
    
    progress.start();
    
    // Check each alignment rule
    const results = new Map<string, ValidationResult>();
    
    for (const rule of CONFIG.alignmentRules) {
      try {
        const result = await checkRuleAlignment(rule, changedFiles);
        results.set(rule.name, result);
        progress.tick(`Checked ${rule.name}`);
      } catch (error) {
        logger.error(`Failed to check rule: ${rule.name}`, error);
        progress.tick(`Failed ${rule.name}`);
      }
    }
    
    progress.complete('Alignment check completed');
    
    // Generate and display report
    generateReport(results);
    
    // Exit with error code if high severity issues found
    const hasHighSeverityIssues = Array.from(results.values()).some(r => r.severity === 'high');
    
    if (hasHighSeverityIssues) {
      process.exit(1);
    }
    
    mainLogger.complete('main');
  } catch (error) {
    mainLogger.failed('main', error);
    console.error(chalk.red('❌ Documentation alignment check failed:'), error);
    process.exit(1);
  }
}

// Export the main function for CLI usage
export { main };

// Execute if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    logger.error('Unhandled error in main', error);
    process.exit(1);
  });
}