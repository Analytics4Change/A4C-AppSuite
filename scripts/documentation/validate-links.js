#!/usr/bin/env node

/**
 * Link Validation Script
 *
 * Validates internal markdown links in the repository:
 * - Finds all markdown links [text](path)
 * - Checks if linked files exist
 * - Reports broken links
 * - Supports relative paths
 *
 * Usage:
 *   node validate-links.js [directory] [--json] [--verbose]
 *
 * Options:
 *   directory  Directory to validate (default: repository root)
 *   --json     Output as JSON
 *   --verbose  Show all links, not just broken ones
 */

const fs = require('fs');
const path = require('path');
const { findMarkdownFiles } = require('./find-markdown-files');

// Regex to match markdown links: [text](path)
const MARKDOWN_LINK_REGEX = /\[([^\]]+)\]\(([^)]+)\)/g;

/**
 * Extract all links from markdown content
 * @param {string} content - Markdown file content
 * @returns {Array<{text: string, url: string, line: number}>} Array of links
 */
function extractLinks(content) {
  const links = [];
  const lines = content.split('\n');

  lines.forEach((line, lineIndex) => {
    let match;
    const regex = new RegExp(MARKDOWN_LINK_REGEX);

    while ((match = regex.exec(line)) !== null) {
      links.push({
        text: match[1],
        url: match[2],
        line: lineIndex + 1
      });
    }
  });

  return links;
}

/**
 * Check if a link is internal (should be validated)
 * @param {string} url - Link URL
 * @returns {boolean} True if internal link
 */
function isInternalLink(url) {
  // Skip external URLs
  if (url.startsWith('http://') || url.startsWith('https://')) return false;

  // Skip anchors only
  if (url.startsWith('#')) return false;

  // Skip mailto links
  if (url.startsWith('mailto:')) return false;

  return true;
}

/**
 * Resolve a link relative to a file
 * @param {string} fromFile - Source file path (relative to repo root)
 * @param {string} linkUrl - Link URL from markdown
 * @param {string} repoRoot - Repository root path
 * @returns {string} Absolute file path
 */
function resolveLink(fromFile, linkUrl, repoRoot) {
  // Remove anchor if present
  const urlWithoutAnchor = linkUrl.split('#')[0];
  if (!urlWithoutAnchor) return null; // Anchor-only link

  // Get directory of source file
  const fromDir = path.dirname(path.join(repoRoot, fromFile));

  // Resolve relative to source file's directory
  const resolved = path.resolve(fromDir, urlWithoutAnchor);

  return resolved;
}

/**
 * Validate links in a single file
 * @param {string} filePath - Relative file path
 * @param {string} repoRoot - Repository root path
 * @returns {Object} Validation results
 */
function validateFileLinks(filePath, repoRoot) {
  const absolutePath = path.join(repoRoot, filePath);
  const content = fs.readFileSync(absolutePath, 'utf-8');
  const links = extractLinks(content);

  const results = {
    file: filePath,
    totalLinks: links.length,
    internalLinks: 0,
    brokenLinks: [],
    validLinks: []
  };

  for (const link of links) {
    if (!isInternalLink(link.url)) continue;

    results.internalLinks++;

    const resolved = resolveLink(filePath, link.url, repoRoot);
    if (!resolved) {
      // Anchor-only link, skip
      continue;
    }

    const exists = fs.existsSync(resolved);

    if (!exists) {
      results.brokenLinks.push({
        text: link.text,
        url: link.url,
        line: link.line,
        resolved: path.relative(repoRoot, resolved)
      });
    } else {
      results.validLinks.push({
        text: link.text,
        url: link.url,
        line: link.line
      });
    }
  }

  return results;
}

/**
 * Validate all links in a directory
 * @param {string} directory - Directory to validate
 * @returns {Array} Validation results for all files
 */
function validateAllLinks(directory) {
  const repoRoot = path.resolve(directory);
  const files = findMarkdownFiles(repoRoot);

  const results = [];

  for (const file of files) {
    const fileResults = validateFileLinks(file, repoRoot);
    results.push(fileResults);
  }

  return results;
}

/**
 * Main execution
 */
function main() {
  const args = process.argv.slice(2);

  // Parse arguments
  let directory = path.resolve(__dirname, '../..');
  const jsonOutput = args.includes('--json');
  const verbose = args.includes('--verbose');

  // Check if first arg is a directory
  if (args.length > 0 && !args[0].startsWith('--')) {
    directory = path.resolve(args[0]);
  }

  console.error(`Validating links in: ${directory}\n`);

  const results = validateAllLinks(directory);

  if (jsonOutput) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  // Human-readable output
  let totalFiles = 0;
  let totalLinks = 0;
  let totalInternal = 0;
  let totalBroken = 0;

  for (const result of results) {
    totalFiles++;
    totalLinks += result.totalLinks;
    totalInternal += result.internalLinks;
    totalBroken += result.brokenLinks.length;

    if (verbose || result.brokenLinks.length > 0) {
      console.log(`\n${'='.repeat(80)}`);
      console.log(result.file);
      console.log('='.repeat(80));
      console.log(`Total links: ${result.totalLinks}`);
      console.log(`Internal links: ${result.internalLinks}`);
      console.log(`Broken links: ${result.brokenLinks.length}`);

      if (result.brokenLinks.length > 0) {
        console.log('\nBROKEN LINKS:');
        for (const broken of result.brokenLinks) {
          console.log(`  Line ${broken.line}: [${broken.text}](${broken.url})`);
          console.log(`    Resolved to: ${broken.resolved}`);
          console.log(`    Status: FILE NOT FOUND`);
        }
      }

      if (verbose && result.validLinks.length > 0) {
        console.log('\nVALID LINKS:');
        for (const valid of result.validLinks) {
          console.log(`  Line ${valid.line}: [${valid.text}](${valid.url})`);
        }
      }
    }
  }

  // Summary
  console.log(`\n${'='.repeat(80)}`);
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log(`Files scanned: ${totalFiles}`);
  console.log(`Total links: ${totalLinks}`);
  console.log(`Internal links: ${totalInternal}`);
  console.log(`Broken links: ${totalBroken}`);

  if (totalBroken > 0) {
    console.log(`\n⚠️  Found ${totalBroken} broken link(s) in ${results.filter(r => r.brokenLinks.length > 0).length} file(s)`);
    process.exit(1);
  } else {
    console.log('\n✅ All internal links are valid!');
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { validateAllLinks, validateFileLinks, extractLinks };
