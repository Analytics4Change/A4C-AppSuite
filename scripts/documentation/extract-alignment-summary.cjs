#!/usr/bin/env node

/**
 * Extract alignment summary for GitHub Actions
 * This script safely extracts PR summary information from alignment reports
 */

const fs = require('fs');

try {
  // Verify input file exists
  if (!fs.existsSync('doc-alignment-report.json')) {
    console.error('Alignment report file not found');
    process.exit(1);
  }

  // Read and parse the report
  const reportContent = fs.readFileSync('doc-alignment-report.json', 'utf8');
  const report = JSON.parse(reportContent);

  // Extract and append PR summary if it exists
  if (report.prSummary && typeof report.prSummary === 'string') {
    fs.appendFileSync('doc-status-report.md', report.prSummary + '\n\n');
    console.log('Successfully extracted alignment details');
  } else {
    console.log('No PR summary found in alignment report');
  }

} catch (error) {
  console.error('Could not extract alignment details:', error.message);
  process.exit(1);
}