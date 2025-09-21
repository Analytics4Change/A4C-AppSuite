#!/usr/bin/env node

/**
 * Count high-priority alignment issues for GitHub Actions
 * This script safely counts high-severity issues from alignment reports
 */

const fs = require('fs');

try {
  // Verify input file exists
  if (!fs.existsSync('doc-alignment-report.json')) {
    console.log('0');
    process.exit(0);
  }

  // Read and parse the report
  const reportContent = fs.readFileSync('doc-alignment-report.json', 'utf8');
  const report = JSON.parse(reportContent);

  // Count high-priority misalignments
  const highPriority = report.misalignments 
    ? report.misalignments.filter(m => m.severity === 'high').length 
    : 0;

  console.log(highPriority);

} catch (error) {
  // Return 0 on any error to avoid breaking the workflow
  console.log('0');
  process.exit(0);
}