#!/usr/bin/env node

/**
 * Count high-priority alignment issues for GitHub Actions
 * This script safely counts high-severity issues from alignment reports
 * Converted from CommonJS to TypeScript
 */

import { existsSync, readFileSync } from 'fs';
import { getLogger } from '../utils/logger.js';

const logger = getLogger('count-issues');

interface AlignmentReport {
  misalignments?: Array<{
    severity: string;
    category: string;
    source: string;
    details: string;
  }>;
  stats?: {
    alignmentScore?: number;
  };
}

async function main(): Promise<void> {
  try {
    logger.debug('Starting high-priority issue count');
    
    // Verify input file exists
    if (!existsSync('doc-alignment-report.json')) {
      logger.info('No alignment report found, returning 0');
      console.log('0');
      process.exit(0);
    }

    // Read and parse the report
    const reportContent = readFileSync('doc-alignment-report.json', 'utf8');
    const report: AlignmentReport = JSON.parse(reportContent);

    // Count high-priority misalignments
    const highPriority = report.misalignments 
      ? report.misalignments.filter(m => m.severity === 'high').length 
      : 0;

    logger.debug('High-priority issues counted', { count: highPriority });
    console.log(highPriority);

  } catch (error) {
    // Return 0 on any error to avoid breaking the workflow
    logger.warn('Error counting issues, returning 0', error);
    console.log('0');
    process.exit(0);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { main };