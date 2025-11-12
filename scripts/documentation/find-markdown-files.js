#!/usr/bin/env node

/**
 * Markdown File Finder
 *
 * Finds all markdown files in the repository, excluding:
 * - node_modules/
 * - .git/
 * - dev/
 *
 * Usage:
 *   node find-markdown-files.js [--json] [--count-only]
 *
 * Options:
 *   --json        Output as JSON array
 *   --count-only  Only output the count
 */

const fs = require('fs');
const path = require('path');

// Directories to exclude from search
const EXCLUDE_DIRS = [
  'node_modules',
  '.git',
  'dev',
  '.next',
  'dist',
  'build',
  'coverage',
  '.temporal'
];

// File extensions to include
const INCLUDE_EXTENSIONS = ['.md'];

/**
 * Recursively find all markdown files
 * @param {string} dir - Directory to search
 * @param {string} baseDir - Base directory for relative paths
 * @returns {string[]} Array of relative file paths
 */
function findMarkdownFiles(dir, baseDir = dir) {
  const results = [];

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(baseDir, fullPath);

      if (entry.isDirectory()) {
        // Skip excluded directories
        if (EXCLUDE_DIRS.includes(entry.name)) {
          continue;
        }

        // Recursively search subdirectories
        results.push(...findMarkdownFiles(fullPath, baseDir));
      } else if (entry.isFile()) {
        // Check if file has an included extension
        const ext = path.extname(entry.name).toLowerCase();
        if (INCLUDE_EXTENSIONS.includes(ext)) {
          results.push(relativePath);
        }
      }
    }
  } catch (error) {
    console.error(`Error reading directory ${dir}:`, error.message);
  }

  return results;
}

/**
 * Group files by directory for better readability
 * @param {string[]} files - Array of file paths
 * @returns {Object} Files grouped by directory
 */
function groupByDirectory(files) {
  const grouped = {};

  for (const file of files) {
    const dir = path.dirname(file);
    if (!grouped[dir]) {
      grouped[dir] = [];
    }
    grouped[dir].push(path.basename(file));
  }

  return grouped;
}

/**
 * Main execution
 */
function main() {
  const args = process.argv.slice(2);
  const jsonOutput = args.includes('--json');
  const countOnly = args.includes('--count-only');

  // Get repository root (assume script is in scripts/documentation/)
  const repoRoot = path.resolve(__dirname, '../..');

  console.error(`Scanning repository: ${repoRoot}`);
  console.error(`Excluding directories: ${EXCLUDE_DIRS.join(', ')}`);
  console.error('');

  const files = findMarkdownFiles(repoRoot);
  files.sort(); // Sort alphabetically

  if (countOnly) {
    console.log(files.length);
    return;
  }

  if (jsonOutput) {
    console.log(JSON.stringify(files, null, 2));
    return;
  }

  // Human-readable output
  console.log(`Found ${files.length} markdown files:\n`);

  const grouped = groupByDirectory(files);
  const directories = Object.keys(grouped).sort();

  for (const dir of directories) {
    console.log(`\n${dir}/`);
    for (const file of grouped[dir].sort()) {
      console.log(`  ${file}`);
    }
  }

  console.log(`\nTotal: ${files.length} files`);
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { findMarkdownFiles };
