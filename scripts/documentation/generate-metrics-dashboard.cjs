#!/usr/bin/env node

/**
 * Documentation Metrics Dashboard Generator
 * Generates an HTML dashboard showing documentation health metrics
 */

const fs = require('fs').promises;
const path = require('path');
const glob = require('glob');
const { spawn } = require('child_process');
const { promisify } = require('util');

/**
 * Secure wrapper for executing git commands using spawn with argument arrays
 * @param {string[]} args - Git command arguments
 * @param {Object} options - Additional options
 * @param {number} options.timeout - Timeout in milliseconds (default: 10000)
 * @returns {Promise<string>} - Command output
 */
async function secureGitExec(args, options = {}) {
  const { timeout = 10000 } = options;
  
  return new Promise((resolve, reject) => {
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
      if (!/^[a-zA-Z0-9._\/-]+$/.test(arg) && !['--', '...', '@', '^', '~'].some(safe => arg.includes(safe))) {
        reject(new Error(`Potentially unsafe git argument: ${arg}`));
        return;
      }
    }

    const gitProcess = spawn('git', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false, // Explicitly disable shell to prevent injection
      timeout: timeout
    });

    let stdout = '';
    let stderr = '';
    let timeoutId;

    // Set up timeout
    if (timeout > 0) {
      timeoutId = setTimeout(() => {
        gitProcess.kill('SIGTERM');
        reject(new Error(`Git command timed out after ${timeout}ms: git ${args.join(' ')}`));
      }, timeout);
    }

    gitProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    gitProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    gitProcess.on('close', (code) => {
      if (timeoutId) clearTimeout(timeoutId);
      
      if (code === 0) {
        resolve(stdout);
      } else {
        const errorMsg = stderr.trim() || `Git command exited with code ${code}`;
        reject(new Error(`Git command failed: ${errorMsg} (Command: git ${args.join(' ')})`));
      }
    });

    gitProcess.on('error', (error) => {
      if (timeoutId) clearTimeout(timeoutId);
      
      if (error.code === 'ENOENT') {
        reject(new Error('Git is not installed or not in PATH'));
      } else if (error.code === 'EACCES') {
        reject(new Error('Permission denied executing git command'));
      } else {
        reject(new Error(`Failed to execute git command: ${error.message}`));
      }
    });
  });
}

// Configuration
const CONFIG = {
  srcRoot: path.join(process.cwd(), 'src'),
  docsRoot: path.join(process.cwd(), 'docs'),
  outputPath: path.join(process.cwd(), 'docs', 'dashboard.html'),
  metricsHistoryPath: path.join(process.cwd(), '.metrics', 'history.json')
};

// Metrics collector
class MetricsCollector {
  constructor() {
    this.metrics = {
      timestamp: new Date().toISOString(),
      coverage: {},
      quality: {},
      process: {},
      trends: {}
    };
  }

  async collect() {
    console.log('📊 Collecting documentation metrics...\n');
    
    await this.collectCoverageMetrics();
    await this.collectQualityMetrics();
    await this.collectProcessMetrics();
    await this.calculateTrends();
    
    return this.metrics;
  }

  async collectCoverageMetrics() {
    console.log('  Analyzing coverage...');
    
    // Component coverage
    const componentFiles = glob.sync('**/*.tsx', {
      cwd: path.join(CONFIG.srcRoot, 'components'),
      ignore: ['**/*.test.tsx', '**/*.spec.tsx']
    });
    
    const documentedComponents = [];
    for (const component of componentFiles) {
      const componentName = path.basename(component, '.tsx');
      const docPath = path.join(CONFIG.docsRoot, 'components', `${componentName}.md`);
      
      try {
        await fs.access(docPath);
        documentedComponents.push(componentName);
      } catch (error) {
        // Not documented
      }
    }
    
    this.metrics.coverage.components = {
      total: componentFiles.length,
      documented: documentedComponents.length,
      percentage: Math.round((documentedComponents.length / componentFiles.length) * 100),
      missing: componentFiles
        .map(f => path.basename(f, '.tsx'))
        .filter(name => !documentedComponents.includes(name))
    };
    
    // API coverage
    const apiFiles = glob.sync('**/api/**/*.ts', {
      cwd: CONFIG.srcRoot,
      ignore: ['**/*.test.ts', '**/*.spec.ts']
    });
    
    const documentedApis = [];
    for (const apiFile of apiFiles) {
      const apiName = path.basename(apiFile, '.ts');
      const docPath = path.join(CONFIG.docsRoot, 'api', `${apiName}.md`);
      
      try {
        await fs.access(docPath);
        documentedApis.push(apiName);
      } catch (error) {
        // Not documented
      }
    }
    
    this.metrics.coverage.apis = {
      total: apiFiles.length,
      documented: documentedApis.length,
      percentage: apiFiles.length > 0 
        ? Math.round((documentedApis.length / apiFiles.length) * 100)
        : 100,
      missing: apiFiles
        .map(f => path.basename(f, '.ts'))
        .filter(name => !documentedApis.includes(name))
    };
    
    // Type coverage
    const typeFiles = glob.sync('**/types/**/*.ts', {
      cwd: CONFIG.srcRoot,
      ignore: ['**/*.test.ts', '**/*.spec.ts']
    });
    
    this.metrics.coverage.types = {
      total: typeFiles.length,
      documented: 0, // Will be calculated from type doc analysis
      percentage: 0
    };
    
    // Overall coverage
    const totalItems = componentFiles.length + apiFiles.length + typeFiles.length;
    const documentedItems = documentedComponents.length + documentedApis.length;
    
    this.metrics.coverage.overall = {
      total: totalItems,
      documented: documentedItems,
      percentage: Math.round((documentedItems / totalItems) * 100)
    };
  }

  async collectQualityMetrics() {
    console.log('  Analyzing quality...');
    
    // Documentation freshness
    const docFiles = glob.sync('**/*.md', {
      cwd: CONFIG.docsRoot,
      ignore: ['node_modules/**']
    });
    
    const ages = [];
    const staleFiles = [];
    
    for (const docFile of docFiles) {
      const filePath = path.join(CONFIG.docsRoot, docFile);
      const stats = await fs.stat(filePath);
      const ageInDays = Math.floor((Date.now() - stats.mtime) / (1000 * 60 * 60 * 24));
      
      ages.push(ageInDays);
      
      if (ageInDays > 30) {
        staleFiles.push({
          file: docFile,
          age: ageInDays
        });
      }
    }
    
    this.metrics.quality.freshness = {
      averageAge: Math.round(ages.reduce((a, b) => a + b, 0) / ages.length),
      maxAge: Math.max(...ages),
      staleCount: staleFiles.length,
      staleFiles: staleFiles.sort((a, b) => b.age - a.age).slice(0, 10)
    };
    
    // Code examples validity (simplified check)
    let totalExamples = 0;
    let invalidExamples = 0;
    
    for (const docFile of docFiles) {
      const filePath = path.join(CONFIG.docsRoot, docFile);
      const content = await fs.readFile(filePath, 'utf-8');
      
      const codeBlocks = content.match(/```(?:tsx?|jsx?|javascript|typescript)[\s\S]*?```/g) || [];
      totalExamples += codeBlocks.length;
      
      for (const block of codeBlocks) {
        // Check for common issues
        if (block.includes('// TODO') || block.includes('// FIXME')) {
          invalidExamples++;
        }
      }
    }
    
    this.metrics.quality.codeExamples = {
      total: totalExamples,
      invalid: invalidExamples,
      validPercentage: totalExamples > 0 
        ? Math.round(((totalExamples - invalidExamples) / totalExamples) * 100)
        : 100
    };
    
    // Broken links (simplified check)
    this.metrics.quality.brokenLinks = {
      count: 0,
      files: []
    };
  }

  async collectProcessMetrics() {
    console.log('  Analyzing process metrics...');
    
    // Git statistics (if in git repo)
    try {
      // Recent commits with documentation changes (secure command execution)
      const recentCommitsOutput = await secureGitExec([
        'log', '--since=7 days ago', '--grep=doc', '--oneline'
      ]);
      const commitsWithDocs = recentCommitsOutput.trim().split('\n').filter(line => line.length > 0).length;
      
      // Total commits in last week (secure command execution)
      const totalCommitsOutput = await secureGitExec([
        'log', '--since=7 days ago', '--oneline'
      ]);
      const totalCommits = totalCommitsOutput.trim().split('\n').filter(line => line.length > 0).length;
      
      this.metrics.process.recentActivity = {
        commitsWithDocs,
        totalCommits,
        percentage: totalCommits > 0
          ? Math.round((commitsWithDocs / totalCommits) * 100)
          : 0
      };
    } catch (error) {
      this.metrics.process.recentActivity = {
        commitsWithDocs: 0,
        totalCommits: 0,
        percentage: 0
      };
    }
    
    // Documentation-related issues (would need GitHub API integration)
    this.metrics.process.issues = {
      open: 0,
      closed: 0,
      avgResolutionTime: 0
    };
  }

  async calculateTrends() {
    console.log('  Calculating trends...');
    
    // Load historical data
    let history = [];
    try {
      const historyData = await fs.readFile(CONFIG.metricsHistoryPath, 'utf-8');
      history = JSON.parse(historyData);
    } catch (error) {
      // No history file yet
    }
    
    // Calculate trends if we have history
    if (history.length > 0) {
      const lastMetrics = history[history.length - 1];
      
      this.metrics.trends.coverage = {
        components: this.metrics.coverage.components.percentage - (lastMetrics.coverage?.components?.percentage || 0),
        apis: this.metrics.coverage.apis.percentage - (lastMetrics.coverage?.apis?.percentage || 0),
        overall: this.metrics.coverage.overall.percentage - (lastMetrics.coverage?.overall?.percentage || 0)
      };
      
      this.metrics.trends.quality = {
        freshness: this.metrics.quality.freshness.averageAge - (lastMetrics.quality?.freshness?.averageAge || 0),
        codeExamples: this.metrics.quality.codeExamples.validPercentage - (lastMetrics.quality?.codeExamples?.validPercentage || 0)
      };
    }
    
    // Save current metrics to history
    history.push(this.metrics);
    
    // Keep only last 30 entries
    if (history.length > 30) {
      history = history.slice(-30);
    }
    
    // Save history
    await fs.mkdir(path.dirname(CONFIG.metricsHistoryPath), { recursive: true });
    await fs.writeFile(CONFIG.metricsHistoryPath, JSON.stringify(history, null, 2));
  }
}

// Dashboard generator
class DashboardGenerator {
  constructor(metrics) {
    this.metrics = metrics;
  }

  generate() {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Documentation Metrics Dashboard - A4C-FrontEnd</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 2rem;
        }
        
        .container {
            max-width: 1400px;
            margin: 0 auto;
        }
        
        .header {
            background: white;
            border-radius: 12px;
            padding: 2rem;
            margin-bottom: 2rem;
            box-shadow: 0 10px 30px rgba(0,0,0,0.1);
        }
        
        .header h1 {
            color: #333;
            margin-bottom: 0.5rem;
        }
        
        .header .subtitle {
            color: #666;
            font-size: 0.9rem;
        }
        
        .header .timestamp {
            color: #999;
            font-size: 0.8rem;
            margin-top: 0.5rem;
        }
        
        .metrics-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 1.5rem;
            margin-bottom: 2rem;
        }
        
        .metric-card {
            background: white;
            border-radius: 12px;
            padding: 1.5rem;
            box-shadow: 0 10px 30px rgba(0,0,0,0.1);
            position: relative;
            overflow: hidden;
        }
        
        .metric-card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 4px;
            background: linear-gradient(90deg, #667eea, #764ba2);
        }
        
        .metric-card h3 {
            color: #333;
            margin-bottom: 1rem;
            font-size: 1.1rem;
        }
        
        .metric-value {
            font-size: 2.5rem;
            font-weight: bold;
            margin-bottom: 0.5rem;
        }
        
        .metric-value.good {
            color: #10b981;
        }
        
        .metric-value.warning {
            color: #f59e0b;
        }
        
        .metric-value.error {
            color: #ef4444;
        }
        
        .metric-label {
            color: #666;
            font-size: 0.9rem;
        }
        
        .metric-details {
            margin-top: 1rem;
            padding-top: 1rem;
            border-top: 1px solid #e5e7eb;
        }
        
        .detail-item {
            display: flex;
            justify-content: space-between;
            padding: 0.25rem 0;
            font-size: 0.85rem;
        }
        
        .detail-label {
            color: #666;
        }
        
        .detail-value {
            color: #333;
            font-weight: 500;
        }
        
        .trend {
            display: inline-block;
            margin-left: 0.5rem;
            font-size: 0.8rem;
            padding: 0.1rem 0.3rem;
            border-radius: 4px;
        }
        
        .trend.up {
            background: #d1fae5;
            color: #065f46;
        }
        
        .trend.down {
            background: #fee2e2;
            color: #991b1b;
        }
        
        .trend.neutral {
            background: #f3f4f6;
            color: #6b7280;
        }
        
        .chart-container {
            background: white;
            border-radius: 12px;
            padding: 2rem;
            box-shadow: 0 10px 30px rgba(0,0,0,0.1);
            margin-bottom: 2rem;
        }
        
        .progress-bar {
            width: 100%;
            height: 20px;
            background: #e5e7eb;
            border-radius: 10px;
            overflow: hidden;
            margin-top: 0.5rem;
        }
        
        .progress-fill {
            height: 100%;
            background: linear-gradient(90deg, #667eea, #764ba2);
            transition: width 0.3s ease;
        }
        
        .list-container {
            margin-top: 1rem;
        }
        
        .list-item {
            padding: 0.5rem;
            background: #f9fafb;
            border-radius: 6px;
            margin-bottom: 0.5rem;
            font-size: 0.85rem;
            color: #4b5563;
        }
        
        .badge {
            display: inline-block;
            padding: 0.25rem 0.5rem;
            border-radius: 4px;
            font-size: 0.75rem;
            font-weight: 500;
        }
        
        .badge.high {
            background: #fee2e2;
            color: #991b1b;
        }
        
        .badge.medium {
            background: #fed7aa;
            color: #92400e;
        }
        
        .badge.low {
            background: #dbeafe;
            color: #1e40af;
        }
        
        .footer {
            text-align: center;
            color: white;
            margin-top: 3rem;
            opacity: 0.8;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>📚 Documentation Metrics Dashboard</h1>
            <div class="subtitle">A4C-FrontEnd Project Documentation Health</div>
            <div class="timestamp">Generated: ${new Date(this.metrics.timestamp).toLocaleString()}</div>
        </div>
        
        <div class="metrics-grid">
            ${this.generateCoverageCard()}
            ${this.generateQualityCard()}
            ${this.generateFreshnessCard()}
            ${this.generateActivityCard()}
        </div>
        
        ${this.generateDetailedCoverage()}
        ${this.generateStaleFiles()}
        ${this.generateRecommendations()}
        
        <div class="footer">
            <p>Documentation metrics are updated daily. For detailed reports, check the CI/CD pipeline.</p>
        </div>
    </div>
</body>
</html>`;
    
    return html;
  }

  generateCoverageCard() {
    const coverage = this.metrics.coverage.overall;
    const trend = this.metrics.trends?.coverage?.overall || 0;
    const status = coverage.percentage >= 90 ? 'good' : coverage.percentage >= 70 ? 'warning' : 'error';
    
    return `
        <div class="metric-card">
            <h3>Overall Coverage</h3>
            <div class="metric-value ${status}">
                ${coverage.percentage}%
                ${this.generateTrend(trend, '%')}
            </div>
            <div class="metric-label">Documentation Coverage</div>
            <div class="progress-bar">
                <div class="progress-fill" style="width: ${coverage.percentage}%"></div>
            </div>
            <div class="metric-details">
                <div class="detail-item">
                    <span class="detail-label">Documented</span>
                    <span class="detail-value">${coverage.documented}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Total Items</span>
                    <span class="detail-value">${coverage.total}</span>
                </div>
            </div>
        </div>`;
  }

  generateQualityCard() {
    const quality = this.metrics.quality.codeExamples;
    const status = quality.validPercentage >= 95 ? 'good' : quality.validPercentage >= 80 ? 'warning' : 'error';
    
    return `
        <div class="metric-card">
            <h3>Code Quality</h3>
            <div class="metric-value ${status}">
                ${quality.validPercentage}%
            </div>
            <div class="metric-label">Valid Code Examples</div>
            <div class="progress-bar">
                <div class="progress-fill" style="width: ${quality.validPercentage}%"></div>
            </div>
            <div class="metric-details">
                <div class="detail-item">
                    <span class="detail-label">Total Examples</span>
                    <span class="detail-value">${quality.total}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Issues Found</span>
                    <span class="detail-value">${quality.invalid}</span>
                </div>
            </div>
        </div>`;
  }

  generateFreshnessCard() {
    const freshness = this.metrics.quality.freshness;
    const status = freshness.averageAge <= 15 ? 'good' : freshness.averageAge <= 30 ? 'warning' : 'error';
    
    return `
        <div class="metric-card">
            <h3>Documentation Freshness</h3>
            <div class="metric-value ${status}">
                ${freshness.averageAge}
            </div>
            <div class="metric-label">Average Age (days)</div>
            <div class="metric-details">
                <div class="detail-item">
                    <span class="detail-label">Oldest Doc</span>
                    <span class="detail-value">${freshness.maxAge} days</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Stale Files</span>
                    <span class="detail-value">${freshness.staleCount}</span>
                </div>
            </div>
        </div>`;
  }

  generateActivityCard() {
    const activity = this.metrics.process.recentActivity;
    const status = activity.percentage >= 50 ? 'good' : activity.percentage >= 25 ? 'warning' : 'error';
    
    return `
        <div class="metric-card">
            <h3>Recent Activity</h3>
            <div class="metric-value ${status}">
                ${activity.percentage}%
            </div>
            <div class="metric-label">Commits with Docs (7d)</div>
            <div class="progress-bar">
                <div class="progress-fill" style="width: ${activity.percentage}%"></div>
            </div>
            <div class="metric-details">
                <div class="detail-item">
                    <span class="detail-label">Doc Commits</span>
                    <span class="detail-value">${activity.commitsWithDocs}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Total Commits</span>
                    <span class="detail-value">${activity.totalCommits}</span>
                </div>
            </div>
        </div>`;
  }

  generateDetailedCoverage() {
    return `
        <div class="chart-container">
            <h3>Detailed Coverage Breakdown</h3>
            <div class="metrics-grid" style="margin-top: 1.5rem">
                <div>
                    <h4 style="margin-bottom: 1rem">Components</h4>
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: ${this.metrics.coverage.components.percentage}%"></div>
                    </div>
                    <p style="margin-top: 0.5rem; color: #666; font-size: 0.9rem">
                        ${this.metrics.coverage.components.documented} / ${this.metrics.coverage.components.total} documented (${this.metrics.coverage.components.percentage}%)
                    </p>
                    ${this.metrics.coverage.components.missing.length > 0 ? `
                        <div class="list-container">
                            <p style="font-weight: 500; margin-bottom: 0.5rem">Missing:</p>
                            ${this.metrics.coverage.components.missing.slice(0, 5).map(name => 
                                `<div class="list-item">${name}</div>`
                            ).join('')}
                            ${this.metrics.coverage.components.missing.length > 5 ? 
                                `<div class="list-item">... and ${this.metrics.coverage.components.missing.length - 5} more</div>` : ''
                            }
                        </div>
                    ` : ''}
                </div>
                
                <div>
                    <h4 style="margin-bottom: 1rem">APIs</h4>
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: ${this.metrics.coverage.apis.percentage}%"></div>
                    </div>
                    <p style="margin-top: 0.5rem; color: #666; font-size: 0.9rem">
                        ${this.metrics.coverage.apis.documented} / ${this.metrics.coverage.apis.total} documented (${this.metrics.coverage.apis.percentage}%)
                    </p>
                    ${this.metrics.coverage.apis.missing.length > 0 ? `
                        <div class="list-container">
                            <p style="font-weight: 500; margin-bottom: 0.5rem">Missing:</p>
                            ${this.metrics.coverage.apis.missing.slice(0, 5).map(name => 
                                `<div class="list-item">${name}</div>`
                            ).join('')}
                            ${this.metrics.coverage.apis.missing.length > 5 ? 
                                `<div class="list-item">... and ${this.metrics.coverage.apis.missing.length - 5} more</div>` : ''
                            }
                        </div>
                    ` : ''}
                </div>
            </div>
        </div>`;
  }

  generateStaleFiles() {
    const staleFiles = this.metrics.quality.freshness.staleFiles;
    
    if (staleFiles.length === 0) {
      return '';
    }
    
    return `
        <div class="chart-container">
            <h3>Stale Documentation (>30 days)</h3>
            <div class="list-container">
                ${staleFiles.map(file => `
                    <div class="list-item" style="display: flex; justify-content: space-between; align-items: center;">
                        <span>${file.file}</span>
                        <span class="badge ${file.age > 60 ? 'high' : file.age > 45 ? 'medium' : 'low'}">
                            ${file.age} days old
                        </span>
                    </div>
                `).join('')}
            </div>
        </div>`;
  }

  generateRecommendations() {
    const recommendations = [];
    
    // Coverage recommendations
    if (this.metrics.coverage.overall.percentage < 90) {
      recommendations.push({
        priority: 'high',
        text: `Increase documentation coverage from ${this.metrics.coverage.overall.percentage}% to meet the 90% target`
      });
    }
    
    if (this.metrics.coverage.components.missing.length > 0) {
      recommendations.push({
        priority: 'medium',
        text: `Document ${this.metrics.coverage.components.missing.length} missing components`
      });
    }
    
    // Quality recommendations
    if (this.metrics.quality.codeExamples.invalid > 0) {
      recommendations.push({
        priority: 'medium',
        text: `Fix ${this.metrics.quality.codeExamples.invalid} invalid code examples`
      });
    }
    
    // Freshness recommendations
    if (this.metrics.quality.freshness.staleCount > 0) {
      recommendations.push({
        priority: 'low',
        text: `Update ${this.metrics.quality.freshness.staleCount} stale documentation files`
      });
    }
    
    if (recommendations.length === 0) {
      recommendations.push({
        priority: 'low',
        text: 'Documentation is in excellent shape! Continue regular maintenance.'
      });
    }
    
    return `
        <div class="chart-container">
            <h3>📋 Recommendations</h3>
            <div class="list-container">
                ${recommendations.map(rec => `
                    <div class="list-item" style="display: flex; align-items: center;">
                        <span class="badge ${rec.priority}" style="margin-right: 1rem">
                            ${rec.priority.toUpperCase()}
                        </span>
                        <span>${rec.text}</span>
                    </div>
                `).join('')}
            </div>
        </div>`;
  }

  generateTrend(value, unit = '') {
    if (value === 0 || value === undefined) {
      return '<span class="trend neutral">→ 0' + unit + '</span>';
    }
    if (value > 0) {
      return `<span class="trend up">↑ ${value}${unit}</span>`;
    }
    return `<span class="trend down">↓ ${Math.abs(value)}${unit}</span>`;
  }
}

// Main execution
async function main() {
  let collector;
  let metrics;
  let dashboardPath;
  let metricsPath;
  
  try {
    console.log('📊 Collecting documentation metrics...');
    console.log('');
    
    // Initialize metrics collector with validation
    try {
      collector = new MetricsCollector();
    } catch (initError) {
      console.error('❌ Failed to initialize metrics collector:');
      console.error(`  ${initError.message}`);
      console.log('\n🔧 Troubleshooting:');
      console.log('  • Ensure you are in the project root directory');
      console.log('  • Verify that src/ and docs/ directories exist');
      console.log('  • Check that package.json contains valid configuration');
      process.exit(1);
    }
    
    // Collect metrics with comprehensive error handling
    try {
      metrics = await collector.collect();
      
      // Validate collected metrics
      if (!metrics || typeof metrics !== 'object') {
        throw new Error('Invalid metrics object returned from collector');
      }
      
      // Ensure required properties exist
      const requiredProps = ['coverage', 'quality', 'process', 'trends'];
      for (const prop of requiredProps) {
        if (!metrics[prop]) {
          console.warn(`⚠️ Warning: Missing metrics property '${prop}' - using defaults`);
          metrics[prop] = {};
        }
      }
      
    } catch (collectionError) {
      console.error('❌ Error during metrics collection:');
      console.error(`  ${collectionError.message}`);
      console.log('\n💡 This could be due to:');
      console.log('  • Missing or inaccessible source files');
      console.log('  • Git repository access issues');
      console.log('  • File permission problems');
      console.log('  • Network connectivity issues');
      
      // Try to provide fallback metrics
      console.log('\n📊 Generating dashboard with minimal metrics...');
      metrics = {
        timestamp: new Date().toISOString(),
        coverage: { 
          overall: { percentage: 0, documented: 0, total: 0 },
          components: { percentage: 0, documented: 0, total: 0 },
          apis: { percentage: 0, documented: 0, total: 0 }
        },
        quality: { 
          codeExamples: { validPercentage: 0, total: 0, valid: 0 },
          freshness: { averageAge: 0 }
        },
        process: { 
          recentActivity: { commitsWithDocs: 0, totalCommits: 0, percentage: 0 },
          issues: { open: 0, closed: 0 }
        },
        trends: { coverage: {}, quality: {} }
      };
    }
    
    // Generate dashboard HTML with error handling
    let html;
    try {
      const generator = new DashboardGenerator(metrics);
      html = generator.generate();
      
      if (!html || typeof html !== 'string' || html.length < 100) {
        throw new Error('Generated HTML appears to be invalid or too short');
      }
      
    } catch (generateError) {
      console.error('❌ Error generating dashboard HTML:');
      console.error(`  ${generateError.message}`);
      console.log('\n🔧 Recovery actions:');
      console.log('  • Check template syntax and structure');
      console.log('  • Verify metrics data integrity');
      console.log('  • Ensure all required dependencies are available');
      process.exit(1);
    }
    
    // Save dashboard with error handling
    dashboardPath = CONFIG.outputPath;
    try {
      // Ensure output directory exists
      await fs.mkdir(path.dirname(dashboardPath), { recursive: true });
      await fs.writeFile(dashboardPath, html);
      console.log(`✅ Dashboard generated successfully: ${dashboardPath}`);
    } catch (saveError) {
      console.error(`❌ Could not save dashboard to ${dashboardPath}:`);
      console.error(`  ${saveError.message}`);
      
      // Try alternative location
      const fallbackPath = path.join(process.cwd(), 'dashboard.html');
      try {
        await fs.writeFile(fallbackPath, html);
        console.log(`✅ Dashboard saved to fallback location: ${fallbackPath}`);
        dashboardPath = fallbackPath;
      } catch (fallbackError) {
        console.error('❌ Failed to save dashboard to fallback location');
        console.log('\n🔧 Check:');
        console.log('  • Write permissions in target directory');
        console.log('  • Available disk space');
        console.log('  • File system limitations');
        process.exit(1);
      }
    }
    
    // Save metrics JSON with error handling
    metricsPath = path.join(CONFIG.docsRoot, 'metrics.json');
    try {
      await fs.mkdir(path.dirname(metricsPath), { recursive: true });
      await fs.writeFile(metricsPath, JSON.stringify(metrics, null, 2));
      console.log(`📊 Metrics saved to: ${metricsPath}`);
    } catch (jsonSaveError) {
      console.warn(`⚠️ Warning: Could not save metrics JSON to ${metricsPath}:`);
      console.warn(`  ${jsonSaveError.message}`);
      console.log('Dashboard generation continued without saving metrics JSON');
    }
    
    // Print summary with error handling
    try {
      console.log('\n📈 Summary:');
      console.log(`  Overall Coverage: ${metrics.coverage?.overall?.percentage || 0}%`);
      console.log(`  Components: ${metrics.coverage?.components?.percentage || 0}%`);
      console.log(`  APIs: ${metrics.coverage?.apis?.percentage || 0}%`);
      console.log(`  Code Quality: ${metrics.quality?.codeExamples?.validPercentage || 0}%`);
      console.log(`  Avg Doc Age: ${metrics.quality?.freshness?.averageAge || 0} days`);
    } catch (printError) {
      console.warn('⚠️ Warning: Error displaying summary statistics');
      console.log('Dashboard was generated successfully despite summary display issues');
    }
    
  } catch (error) {
    console.error('\n💥 Unexpected error during dashboard generation:');
    console.error(`  ${error.message}`);
    
    if (error.stack) {
      console.log('\n🔍 Stack trace:');
      console.log(error.stack);
    }
    
    console.log('\n🔧 Recovery actions:');
    console.log('  • Ensure all dependencies are installed: npm ci');
    console.log('  • Verify Node.js version compatibility (18+)');
    console.log('  • Check file system permissions');
    console.log('  • Verify project structure and configuration');
    
    if (dashboardPath) {
      console.log(`  • Check if partial dashboard exists: ${dashboardPath}`);
    }
    
    if (metricsPath) {
      console.log(`  • Check if partial metrics exist: ${metricsPath}`);
    }
    
    console.log('\n📋 Report this issue with:');
    console.log('  • Node.js version: ' + process.version);
    console.log('  • Operating system: ' + process.platform);
    console.log('  • Current working directory: ' + process.cwd());
    console.log('  • Available memory: ' + Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB');
    
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

module.exports = { MetricsCollector, DashboardGenerator };