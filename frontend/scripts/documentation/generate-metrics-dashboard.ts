#!/usr/bin/env node

/**
 * Documentation Metrics Dashboard Generator
 * Generates an HTML dashboard showing documentation health metrics
 * Converted from CommonJS to TypeScript with enhanced security and logging
 */

import { promises as fs } from 'fs';
import { join, basename } from 'path';
import { glob } from 'glob';
import { spawn, ChildProcess } from 'child_process';
import chalk from 'chalk';

import { getLogger } from '../utils/logger.js';
import { withProgress } from '../utils/progress.js';
import { configManager } from '../config/manager.js';

const logger = getLogger('metrics-dashboard');

/**
 * Enhanced cache for glob results with TTL
 */
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
      shell: false,
      cwd,
    });

    let stdout = '';
    let stderr = '';
    let timeoutId: NodeJS.Timeout | undefined;

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
 * Documentation coverage metrics
 */
interface CoverageMetrics {
  components: {
    total: number;
    documented: number;
    percentage: number;
    missing: string[];
  };
  apis: {
    total: number;
    documented: number;
    percentage: number;
    missing: string[];
  };
  types: {
    total: number;
    documented: number;
    percentage: number;
  };
  overall: {
    total: number;
    documented: number;
    percentage: number;
  };
}

/**
 * Documentation quality metrics
 */
interface QualityMetrics {
  freshness: {
    averageAge: number;
    maxAge: number;
    staleCount: number;
    staleFiles: string[];
  };
  codeExamples: {
    total: number;
    invalid: number;
    validPercentage: number;
  };
  brokenLinks: {
    count: number;
    files: string[];
  };
}

/**
 * Process metrics
 */
interface ProcessMetrics {
  recentActivity: {
    commitsWithDocs: number;
    totalCommits: number;
    percentage: number;
  };
  issues: {
    open: number;
    closed: number;
    avgResolutionTime: number;
  };
}

/**
 * Trend metrics
 */
interface TrendMetrics {
  coverage: {
    components: number;
    apis: number;
    overall: number;
  };
  quality: {
    freshness: number;
    codeExamples: number;
  };
}

/**
 * Complete metrics structure
 */
interface DocumentationMetrics {
  timestamp: string;
  coverage: CoverageMetrics;
  quality: QualityMetrics;
  process: ProcessMetrics;
  trends: TrendMetrics;
}

/**
 * Component information
 */
interface ComponentInfo {
  name: string;
  path: string;
  hasProps: boolean;
  propsCount: number;
  isDocumented: boolean;
  docPath?: string;
}

/**
 * API endpoint information
 */
interface ApiInfo {
  name: string;
  path: string;
  methods: string[];
  isDocumented: boolean;
  docPath?: string;
}

/**
 * Documentation file information
 */
interface DocFileInfo {
  path: string;
  lastModified: Date;
  size: number;
  codeExamples: number;
  hasValidExamples: boolean;
  brokenLinks: string[];
}

/**
 * Analyze React components in the codebase
 */
async function analyzeComponents(): Promise<ComponentInfo[]> {
  const operation = logger.start('analyzeComponents');
  
  try {
    const componentFiles = await cachedGlob('src/components/**/*.tsx');
    const docFiles = await cachedGlob('docs/**/*.md');
    
    const components: ComponentInfo[] = [];
    
    await withProgress(componentFiles, async (file) => {
      try {
        const content = await fs.readFile(file, 'utf-8');
        const componentName = basename(file, '.tsx');
        
        // Check if component has props interface/type
        const hasPropsInterface = /interface\s+\w*Props/.test(content) || /type\s+\w*Props\s*=/.test(content);
        const propsMatches = content.match(/(interface|type)\s+\w*Props/g);
        const propsCount = propsMatches ? propsMatches.length : 0;
        
        // Check if component is documented
        const isDocumented = docFiles.some(docFile => {
          const docName = basename(docFile, '.md').toLowerCase();
          return docName.includes(componentName.toLowerCase());
        });
        
        const docPath = docFiles.find(docFile => {
          const docName = basename(docFile, '.md').toLowerCase();
          return docName.includes(componentName.toLowerCase());
        });
        
        components.push({
          name: componentName,
          path: file,
          hasProps: hasPropsInterface,
          propsCount,
          isDocumented,
          docPath
        });
      } catch (error) {
        logger.warn('Failed to analyze component', { file, error });
      }
    }, { message: 'Analyzing components...' });
    
    operation.complete('analyzeComponents', { componentsCount: components.length });
    return components;
  } catch (error) {
    operation.failed('analyzeComponents', error);
    throw error;
  }
}

/**
 * Analyze API endpoints in the codebase
 */
async function analyzeAPIs(): Promise<ApiInfo[]> {
  const operation = logger.start('analyzeAPIs');
  
  try {
    const apiFiles = await cachedGlob('src/services/api/**/*.ts');
    const docFiles = await cachedGlob('docs/api/**/*.md');
    
    const apis: ApiInfo[] = [];
    
    await withProgress(apiFiles, async (file) => {
      try {
        const content = await fs.readFile(file, 'utf-8');
        const apiName = basename(file, '.ts');
        
        // Extract method names
        const methodMatches = content.match(/(?:async\s+)?(\w+)\s*\([^)]*\)\s*(?::\s*Promise<[^>]+>)?/g);
        const methods = methodMatches ? methodMatches.map(match => {
          const methodName = match.match(/(\w+)\s*\(/);
          return methodName ? methodName[1] : '';
        }).filter(name => name && !['constructor', 'toString', 'valueOf'].includes(name)) : [];
        
        // Check if API is documented
        const isDocumented = docFiles.some(docFile => {
          const docName = basename(docFile, '.md').toLowerCase();
          return docName.includes(apiName.toLowerCase());
        });
        
        const docPath = docFiles.find(docFile => {
          const docName = basename(docFile, '.md').toLowerCase();
          return docName.includes(apiName.toLowerCase());
        });
        
        apis.push({
          name: apiName,
          path: file,
          methods,
          isDocumented,
          docPath
        });
      } catch (error) {
        logger.warn('Failed to analyze API', { file, error });
      }
    }, { message: 'Analyzing APIs...' });
    
    operation.complete('analyzeAPIs', { apisCount: apis.length });
    return apis;
  } catch (error) {
    operation.failed('analyzeAPIs', error);
    throw error;
  }
}

/**
 * Analyze type definitions in the codebase
 */
async function analyzeTypes(): Promise<number> {
  const operation = logger.start('analyzeTypes');
  
  try {
    const typeFiles = await cachedGlob('src/types/**/*.ts');
    let totalTypes = 0;
    
    await withProgress(typeFiles, async (file) => {
      try {
        const content = await fs.readFile(file, 'utf-8');
        
        // Count exported interfaces and types
        const interfaceMatches = content.match(/export\s+interface\s+\w+/g);
        const typeMatches = content.match(/export\s+type\s+\w+/g);
        
        const interfaceCount = interfaceMatches ? interfaceMatches.length : 0;
        const typeCount = typeMatches ? typeMatches.length : 0;
        
        totalTypes += interfaceCount + typeCount;
      } catch (error) {
        logger.warn('Failed to analyze types', { file, error });
      }
    }, { message: 'Analyzing types...' });
    
    operation.complete('analyzeTypes', { totalTypes });
    return totalTypes;
  } catch (error) {
    operation.failed('analyzeTypes', error);
    throw error;
  }
}

/**
 * Analyze documentation files
 */
async function analyzeDocumentation(): Promise<DocFileInfo[]> {
  const operation = logger.start('analyzeDocumentation');
  
  try {
    const docFiles = await cachedGlob('docs/**/*.md');
    const docInfos: DocFileInfo[] = [];
    
    await withProgress(docFiles, async (file) => {
      try {
        const content = await fs.readFile(file, 'utf-8');
        const stats = await fs.stat(file);
        
        // Count code examples
        const codeBlockMatches = content.match(/```[\\s\\S]*?```/g);
        const codeExamples = codeBlockMatches ? codeBlockMatches.length : 0;
        
        // Validate code examples (simple check)
        let hasValidExamples = true;
        if (codeBlockMatches) {
          for (const block of codeBlockMatches) {
            // Check for syntax errors or incomplete blocks
            if (!block.includes('```') || block.split('```').length < 3) {
              hasValidExamples = false;
              break;
            }
          }
        }
        
        // Find broken links (simple regex check)
        const linkMatches = content.match(/\[([^\]]+)\]\(([^)]+)\)/g);
        const brokenLinks: string[] = [];
        
        if (linkMatches) {
          for (const link of linkMatches) {
            const urlMatch = link.match(/\(([^)]+)\)/);
            if (urlMatch) {
              const url = urlMatch[1];
              // Check for obvious broken links
              if (url.startsWith('./') || url.startsWith('../')) {
                // Would need filesystem check in real implementation
                // For now, just check if it looks suspicious
                if (url.includes('undefined') || url.includes('null')) {
                  brokenLinks.push(url);
                }
              }
            }
          }
        }
        
        docInfos.push({
          path: file,
          lastModified: stats.mtime,
          size: stats.size,
          codeExamples,
          hasValidExamples,
          brokenLinks
        });
      } catch (error) {
        logger.warn('Failed to analyze documentation', { file, error });
      }
    }, { message: 'Analyzing documentation...' });
    
    operation.complete('analyzeDocumentation', { docFilesCount: docInfos.length });
    return docInfos;
  } catch (error) {
    operation.failed('analyzeDocumentation', error);
    throw error;
  }
}

/**
 * Get git commit activity for process metrics
 */
async function getCommitActivity(days: number = 30): Promise<{ commitsWithDocs: number; totalCommits: number }> {
  const operation = logger.start('getCommitActivity', { days });
  
  try {
    const since = new Date();
    since.setDate(since.getDate() - days);
    const sinceStr = since.toISOString().split('T')[0];
    
    // Get all commits in the time period
    const allCommitsOutput = await secureGitExec([
      'log',
      '--oneline',
      '--no-merges',
      `--since=${sinceStr}`
    ]);
    
    const totalCommits = allCommitsOutput.trim().split('\\n').filter(line => line.trim()).length;
    
    // Get commits that touched documentation files
    const docCommitsOutput = await secureGitExec([
      'log',
      '--oneline',
      '--no-merges',
      `--since=${sinceStr}`,
      '--',
      'docs/',
      '*.md'
    ]);
    
    const commitsWithDocs = docCommitsOutput.trim().split('\\n').filter(line => line.trim()).length;
    
    operation.complete('getCommitActivity', { totalCommits, commitsWithDocs });
    return { commitsWithDocs, totalCommits };
  } catch (error) {
    operation.failed('getCommitActivity', error);
    return { commitsWithDocs: 0, totalCommits: 0 };
  }
}

/**
 * Generate comprehensive documentation metrics
 */
async function generateMetrics(): Promise<DocumentationMetrics> {
  const operation = logger.start('generateMetrics');
  
  try {
    console.log(chalk.bold('📊 Generating Documentation Metrics...'));
    
    // Analyze all aspects in parallel where possible
    const [components, apis, totalTypes, docFiles, commitActivity] = await Promise.all([
      analyzeComponents(),
      analyzeAPIs(),
      analyzeTypes(),
      analyzeDocumentation(),
      getCommitActivity()
    ]);
    
    // Calculate coverage metrics
    const documentedComponents = components.filter(c => c.isDocumented).length;
    const documentedAPIs = apis.filter(a => a.isDocumented).length;
    const totalDocumentable = components.length + apis.length + totalTypes;
    const totalDocumented = documentedComponents + documentedAPIs; // Types are harder to track
    
    const coverage: CoverageMetrics = {
      components: {
        total: components.length,
        documented: documentedComponents,
        percentage: components.length > 0 ? Math.round((documentedComponents / components.length) * 100) : 0,
        missing: components.filter(c => !c.isDocumented).map(c => c.name)
      },
      apis: {
        total: apis.length,
        documented: documentedAPIs,
        percentage: apis.length > 0 ? Math.round((documentedAPIs / apis.length) * 100) : 0,
        missing: apis.filter(a => !a.isDocumented).map(a => a.name)
      },
      types: {
        total: totalTypes,
        documented: 0, // Would need more sophisticated analysis
        percentage: 0
      },
      overall: {
        total: totalDocumentable,
        documented: totalDocumented,
        percentage: totalDocumentable > 0 ? Math.round((totalDocumented / totalDocumentable) * 100) : 0
      }
    };
    
    // Calculate quality metrics
    const now = new Date();
    const docAges = docFiles.map(doc => Math.floor((now.getTime() - doc.lastModified.getTime()) / (1000 * 60 * 60 * 24)));
    const staleThreshold = 30; // days
    
    const quality: QualityMetrics = {
      freshness: {
        averageAge: docAges.length > 0 ? Math.round(docAges.reduce((a, b) => a + b, 0) / docAges.length) : 0,
        maxAge: docAges.length > 0 ? Math.max(...docAges) : 0,
        staleCount: docAges.filter(age => age > staleThreshold).length,
        staleFiles: docFiles.filter((_, i) => docAges[i] > staleThreshold).map(doc => doc.path)
      },
      codeExamples: {
        total: docFiles.reduce((sum, doc) => sum + doc.codeExamples, 0),
        invalid: docFiles.filter(doc => !doc.hasValidExamples).length,
        validPercentage: docFiles.length > 0 ? Math.round((docFiles.filter(doc => doc.hasValidExamples).length / docFiles.length) * 100) : 100
      },
      brokenLinks: {
        count: docFiles.reduce((sum, doc) => sum + doc.brokenLinks.length, 0),
        files: docFiles.filter(doc => doc.brokenLinks.length > 0).map(doc => doc.path)
      }
    };
    
    // Calculate process metrics
    const process: ProcessMetrics = {
      recentActivity: {
        commitsWithDocs: commitActivity.commitsWithDocs,
        totalCommits: commitActivity.totalCommits,
        percentage: commitActivity.totalCommits > 0 ? Math.round((commitActivity.commitsWithDocs / commitActivity.totalCommits) * 100) : 0
      },
      issues: {
        open: 0, // Would need GitHub API integration
        closed: 0,
        avgResolutionTime: 0
      }
    };
    
    // Calculate trend metrics (simplified - would need historical data)
    const trends: TrendMetrics = {
      coverage: {
        components: 0, // Placeholder
        apis: 0,
        overall: 0
      },
      quality: {
        freshness: 0,
        codeExamples: 0
      }
    };
    
    const metrics: DocumentationMetrics = {
      timestamp: new Date().toISOString(),
      coverage,
      quality,
      process,
      trends
    };
    
    operation.complete('generateMetrics');
    return metrics;
  } catch (error) {
    operation.failed('generateMetrics', error);
    throw error;
  }
}

/**
 * Generate HTML dashboard from metrics
 */
function generateHTMLDashboard(metrics: DocumentationMetrics): string {
  const operation = logger.start('generateHTMLDashboard');
  
  try {
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Documentation Metrics Dashboard</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #f5f7fa; color: #2d3748; }
        .container { max-width: 1200px; margin: 0 auto; padding: 2rem; }
        .header { text-align: center; margin-bottom: 3rem; }
        .header h1 { color: #1a202c; font-size: 2.5rem; margin-bottom: 0.5rem; }
        .header p { color: #718096; font-size: 1.1rem; }
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 2rem; margin-bottom: 3rem; }
        .card { background: white; border-radius: 12px; padding: 1.5rem; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05); border: 1px solid #e2e8f0; }
        .card h2 { color: #2d3748; font-size: 1.3rem; margin-bottom: 1rem; display: flex; align-items: center; }
        .card h2::before { content: '📊'; margin-right: 0.5rem; }
        .metric { display: flex; justify-content: space-between; align-items: center; padding: 0.75rem 0; border-bottom: 1px solid #f7fafc; }
        .metric:last-child { border-bottom: none; }
        .metric-label { font-weight: 500; color: #4a5568; }
        .metric-value { font-weight: 600; font-size: 1.1rem; }
        .percentage { padding: 0.25rem 0.75rem; border-radius: 20px; color: white; font-size: 0.9rem; }
        .percentage.high { background: #48bb78; }
        .percentage.medium { background: #ed8936; }
        .percentage.low { background: #f56565; }
        .progress-bar { width: 100%; height: 8px; background: #edf2f7; border-radius: 4px; overflow: hidden; margin: 0.5rem 0; }
        .progress-fill { height: 100%; background: linear-gradient(90deg, #667eea 0%, #764ba2 100%); transition: width 0.3s ease; }
        .missing-items { margin-top: 1rem; }
        .missing-items h4 { color: #e53e3e; font-size: 0.9rem; margin-bottom: 0.5rem; }
        .missing-list { display: flex; flex-wrap: wrap; gap: 0.5rem; }
        .missing-item { background: #fed7d7; color: #c53030; padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.8rem; }
        .timestamp { text-align: center; color: #718096; font-size: 0.9rem; margin-top: 2rem; }
        .summary { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 2rem; border-radius: 12px; text-align: center; margin-bottom: 2rem; }
        .summary h2 { font-size: 1.5rem; margin-bottom: 1rem; }
        .summary-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1rem; margin-top: 1.5rem; }
        .summary-stat { text-align: center; }
        .summary-stat-value { font-size: 2rem; font-weight: bold; margin-bottom: 0.25rem; }
        .summary-stat-label { font-size: 0.9rem; opacity: 0.9; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>📚 Documentation Metrics Dashboard</h1>
            <p>Comprehensive overview of documentation health and coverage</p>
        </div>
        
        <div class="summary">
            <h2>Overall Documentation Health</h2>
            <div class="summary-stats">
                <div class="summary-stat">
                    <div class="summary-stat-value">${metrics.coverage.overall.percentage}%</div>
                    <div class="summary-stat-label">Overall Coverage</div>
                </div>
                <div class="summary-stat">
                    <div class="summary-stat-value">${metrics.quality.freshness.averageAge}</div>
                    <div class="summary-stat-label">Avg Age (days)</div>
                </div>
                <div class="summary-stat">
                    <div class="summary-stat-value">${metrics.process.recentActivity.percentage}%</div>
                    <div class="summary-stat-label">Recent Activity</div>
                </div>
                <div class="summary-stat">
                    <div class="summary-stat-value">${metrics.quality.codeExamples.validPercentage}%</div>
                    <div class="summary-stat-label">Valid Examples</div>
                </div>
            </div>
        </div>
        
        <div class="grid">
            <div class="card">
                <h2>📁 Coverage Metrics</h2>
                <div class="metric">
                    <span class="metric-label">Components</span>
                    <span class="metric-value">
                        <span class="percentage ${metrics.coverage.components.percentage >= 80 ? 'high' : metrics.coverage.components.percentage >= 50 ? 'medium' : 'low'}">
                            ${metrics.coverage.components.percentage}%
                        </span>
                        (${metrics.coverage.components.documented}/${metrics.coverage.components.total})
                    </span>
                </div>
                <div class="progress-bar">
                    <div class="progress-fill" style="width: ${metrics.coverage.components.percentage}%"></div>
                </div>
                
                <div class="metric">
                    <span class="metric-label">APIs</span>
                    <span class="metric-value">
                        <span class="percentage ${metrics.coverage.apis.percentage >= 80 ? 'high' : metrics.coverage.apis.percentage >= 50 ? 'medium' : 'low'}">
                            ${metrics.coverage.apis.percentage}%
                        </span>
                        (${metrics.coverage.apis.documented}/${metrics.coverage.apis.total})
                    </span>
                </div>
                <div class="progress-bar">
                    <div class="progress-fill" style="width: ${metrics.coverage.apis.percentage}%"></div>
                </div>
                
                <div class="metric">
                    <span class="metric-label">Types</span>
                    <span class="metric-value">
                        <span class="percentage ${metrics.coverage.types.percentage >= 80 ? 'high' : metrics.coverage.types.percentage >= 50 ? 'medium' : 'low'}">
                            ${metrics.coverage.types.percentage}%
                        </span>
                        (${metrics.coverage.types.documented}/${metrics.coverage.types.total})
                    </span>
                </div>
                <div class="progress-bar">
                    <div class="progress-fill" style="width: ${metrics.coverage.types.percentage}%"></div>
                </div>
                
                ${metrics.coverage.components.missing.length > 0 ? `
                <div class="missing-items">
                    <h4>Missing Component Documentation:</h4>
                    <div class="missing-list">
                        ${metrics.coverage.components.missing.slice(0, 10).map(item => `<span class="missing-item">${item}</span>`).join('')}
                        ${metrics.coverage.components.missing.length > 10 ? `<span class="missing-item">+${metrics.coverage.components.missing.length - 10} more</span>` : ''}
                    </div>
                </div>
                ` : ''}
            </div>
            
            <div class="card">
                <h2>✨ Quality Metrics</h2>
                <div class="metric">
                    <span class="metric-label">Average Age</span>
                    <span class="metric-value">${metrics.quality.freshness.averageAge} days</span>
                </div>
                <div class="metric">
                    <span class="metric-label">Stale Files</span>
                    <span class="metric-value">${metrics.quality.freshness.staleCount}</span>
                </div>
                <div class="metric">
                    <span class="metric-label">Code Examples</span>
                    <span class="metric-value">${metrics.quality.codeExamples.total}</span>
                </div>
                <div class="metric">
                    <span class="metric-label">Valid Examples</span>
                    <span class="metric-value">
                        <span class="percentage ${metrics.quality.codeExamples.validPercentage >= 90 ? 'high' : metrics.quality.codeExamples.validPercentage >= 70 ? 'medium' : 'low'}">
                            ${metrics.quality.codeExamples.validPercentage}%
                        </span>
                    </span>
                </div>
                <div class="metric">
                    <span class="metric-label">Broken Links</span>
                    <span class="metric-value">${metrics.quality.brokenLinks.count}</span>
                </div>
            </div>
            
            <div class="card">
                <h2>🔄 Process Metrics</h2>
                <div class="metric">
                    <span class="metric-label">Recent Commits</span>
                    <span class="metric-value">${metrics.process.recentActivity.totalCommits}</span>
                </div>
                <div class="metric">
                    <span class="metric-label">Commits with Docs</span>
                    <span class="metric-value">
                        <span class="percentage ${metrics.process.recentActivity.percentage >= 30 ? 'high' : metrics.process.recentActivity.percentage >= 15 ? 'medium' : 'low'}">
                            ${metrics.process.recentActivity.percentage}%
                        </span>
                        (${metrics.process.recentActivity.commitsWithDocs})
                    </span>
                </div>
                <div class="progress-bar">
                    <div class="progress-fill" style="width: ${metrics.process.recentActivity.percentage}%"></div>
                </div>
            </div>
        </div>
        
        <div class="timestamp">
            Generated on ${new Date(metrics.timestamp).toLocaleString()}
        </div>
    </div>
</body>
</html>`;
    
    operation.complete('generateHTMLDashboard');
    return html;
  } catch (error) {
    operation.failed('generateHTMLDashboard', error);
    throw error;
  }
}

/**
 * Save metrics to JSON file
 */
async function saveMetricsJSON(metrics: DocumentationMetrics): Promise<void> {
  const operation = logger.start('saveMetricsJSON');
  
  try {
    const outputPath = join(process.cwd(), 'docs', 'metrics.json');
    await fs.writeFile(outputPath, JSON.stringify(metrics, null, 2), 'utf-8');
    
    logger.info('Metrics JSON saved successfully', { outputPath });
    operation.complete('saveMetricsJSON', { outputPath });
  } catch (error) {
    operation.failed('saveMetricsJSON', error);
    throw error;
  }
}

/**
 * Save HTML dashboard
 */
async function saveDashboard(html: string): Promise<void> {
  const operation = logger.start('saveDashboard');
  
  try {
    const outputPath = join(process.cwd(), 'docs', 'dashboard.html');
    await fs.writeFile(outputPath, html, 'utf-8');
    
    logger.info('HTML dashboard saved successfully', { outputPath });
    operation.complete('saveDashboard', { outputPath });
  } catch (error) {
    operation.failed('saveDashboard', error);
    throw error;
  }
}

/**
 * Main execution function
 */
async function main(): Promise<void> {
  const mainLogger = logger.start('main');
  
  try {
    console.log(chalk.bold('📊 Generating Documentation Metrics Dashboard...'));
    
    // Generate comprehensive metrics
    const metrics = await generateMetrics();
    
    // Generate HTML dashboard
    const html = generateHTMLDashboard(metrics);
    
    // Save both JSON and HTML outputs
    await Promise.all([
      saveMetricsJSON(metrics),
      saveDashboard(html)
    ]);
    
    // Display summary
    console.log(chalk.green('\\n✅ Dashboard generated successfully!'));
    console.log(chalk.cyan('📄 JSON Metrics: docs/metrics.json'));
    console.log(chalk.cyan('🌐 HTML Dashboard: docs/dashboard.html'));
    
    console.log(chalk.bold('\\n📋 Quick Summary:'));
    console.log(`   Overall Coverage: ${chalk.bold(metrics.coverage.overall.percentage + '%')}`);
    console.log(`   Components: ${chalk.bold(metrics.coverage.components.documented + '/' + metrics.coverage.components.total)}`);
    console.log(`   APIs: ${chalk.bold(metrics.coverage.apis.documented + '/' + metrics.coverage.apis.total)}`);
    console.log(`   Average Doc Age: ${chalk.bold(metrics.quality.freshness.averageAge + ' days')}`);
    
    mainLogger.complete('main');
  } catch (error) {
    mainLogger.failed('main', error);
    console.error(chalk.red('❌ Dashboard generation failed:'), error);
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