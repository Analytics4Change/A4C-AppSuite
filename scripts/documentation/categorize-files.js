#!/usr/bin/env node

/**
 * File Categorization Script
 *
 * Categorizes markdown files as "stay" or "move" based on project rules:
 *
 * STAY (do not move):
 * - All CLAUDE.md files
 * - All README.md files
 * - All files in .claude/ directory
 * - All files in dev/ directory
 * - API contracts in infrastructure/supabase/contracts/
 *
 * MOVE (consolidate to documentation/):
 * - Everything else
 *
 * Usage:
 *   node categorize-files.js [--json] [--move-only] [--stay-only]
 *
 * Options:
 *   --json       Output as JSON
 *   --move-only  Only show files to move
 *   --stay-only  Only show files that stay
 */

const fs = require('fs');
const path = require('path');
const { findMarkdownFiles } = require('./find-markdown-files');

/**
 * Determine if a file should stay in place
 * @param {string} filePath - Relative file path
 * @returns {boolean} True if file should stay
 */
function shouldStay(filePath) {
  const normalized = filePath.replace(/\\/g, '/');

  // Files that stay based on name
  const basename = path.basename(filePath);
  if (basename === 'CLAUDE.md' || basename === 'README.md') {
    return true;
  }

  // Directories that stay
  if (normalized.startsWith('.claude/')) return true;
  if (normalized.startsWith('dev/')) return true;
  if (normalized.startsWith('infrastructure/supabase/contracts/')) return true;

  return false;
}

/**
 * Get the reason why a file stays
 * @param {string} filePath - Relative file path
 * @returns {string} Reason string
 */
function getStayReason(filePath) {
  const basename = path.basename(filePath);
  const normalized = filePath.replace(/\\/g, '/');

  if (basename === 'CLAUDE.md') return 'Developer guidance (CLAUDE.md)';
  if (basename === 'README.md') return 'GitHub convention (README.md)';
  if (normalized.startsWith('.claude/')) return 'Claude Code infrastructure';
  if (normalized.startsWith('dev/')) return 'Development tracking';
  if (normalized.startsWith('infrastructure/supabase/contracts/')) return 'API contracts (near source)';

  return 'Unknown';
}

/**
 * Suggest destination for files that should move
 * @param {string} filePath - Relative file path
 * @returns {string} Suggested destination path
 */
function suggestDestination(filePath) {
  const normalized = filePath.replace(/\\/g, '/');

  // Frontend documentation
  if (normalized.startsWith('frontend/docs/')) {
    const remainder = normalized.replace('frontend/docs/', '');
    return `documentation/frontend/${remainder}`;
  }
  if (normalized.startsWith('frontend/') && !normalized.includes('node_modules')) {
    const basename = path.basename(filePath);
    if (basename !== 'README.md' && basename !== 'CLAUDE.md') {
      return `documentation/frontend/guides/${basename}`;
    }
  }

  // Workflow documentation
  if (normalized.startsWith('workflows/')) {
    const basename = path.basename(filePath);
    if (basename === 'IMPLEMENTATION.md') {
      return 'documentation/workflows/guides/implementation.md';
    }
    return `documentation/workflows/${basename}`;
  }

  // Infrastructure documentation
  if (normalized.startsWith('infrastructure/supabase/') && !normalized.includes('contracts/')) {
    const remainder = normalized.replace('infrastructure/supabase/', '');
    return `documentation/infrastructure/guides/supabase/${remainder}`;
  }
  if (normalized.startsWith('infrastructure/k8s/')) {
    const remainder = normalized.replace('infrastructure/k8s/', '');
    return `documentation/infrastructure/guides/kubernetes/${remainder}`;
  }
  if (normalized.startsWith('infrastructure/')) {
    const basename = path.basename(filePath);
    return `documentation/infrastructure/operations/${basename}`;
  }

  // Planning documentation (needs manual review)
  if (normalized.startsWith('.plans/') || normalized.startsWith('.archived_plans/')) {
    return 'NEEDS MANUAL REVIEW - See Phase 3.5';
  }

  // Root level documentation
  return `documentation/operations/${path.basename(filePath)}`;
}

/**
 * Categorize all markdown files
 * @returns {{stay: Array, move: Array}} Categorized files
 */
function categorizeFiles() {
  const repoRoot = path.resolve(__dirname, '../..');
  const allFiles = findMarkdownFiles(repoRoot);

  const stay = [];
  const move = [];

  for (const file of allFiles) {
    if (shouldStay(file)) {
      stay.push({
        path: file,
        reason: getStayReason(file)
      });
    } else {
      move.push({
        path: file,
        destination: suggestDestination(file)
      });
    }
  }

  return { stay, move };
}

/**
 * Main execution
 */
function main() {
  const args = process.argv.slice(2);
  const jsonOutput = args.includes('--json');
  const moveOnly = args.includes('--move-only');
  const stayOnly = args.includes('--stay-only');

  const { stay, move } = categorizeFiles();

  if (jsonOutput) {
    console.log(JSON.stringify({ stay, move }, null, 2));
    return;
  }

  // Human-readable output
  if (!moveOnly) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`FILES THAT STAY IN PLACE (${stay.length} files)`);
    console.log('='.repeat(80));

    for (const file of stay) {
      console.log(`\n${file.path}`);
      console.log(`  Reason: ${file.reason}`);
    }
  }

  if (!stayOnly) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`FILES TO MOVE (${move.length} files)`);
    console.log('='.repeat(80));

    const needsReview = [];
    const readyToMove = [];

    for (const file of move) {
      if (file.destination.startsWith('NEEDS MANUAL REVIEW')) {
        needsReview.push(file);
      } else {
        readyToMove.push(file);
      }
    }

    console.log(`\n--- Ready to Move (${readyToMove.length}) ---`);
    for (const file of readyToMove) {
      console.log(`\n${file.path}`);
      console.log(`  → ${file.destination}`);
    }

    if (needsReview.length > 0) {
      console.log(`\n--- Needs Manual Review (${needsReview.length}) ---`);
      for (const file of needsReview) {
        console.log(`\n${file.path}`);
        console.log(`  → ${file.destination}`);
      }
    }
  }

  console.log(`\n${'='.repeat(80)}`);
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log(`Stay in place: ${stay.length} files`);
  console.log(`Move to documentation/: ${move.length} files`);
  console.log(`Total: ${stay.length + move.length} files`);
  console.log('');
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { categorizeFiles, shouldStay, suggestDestination };
