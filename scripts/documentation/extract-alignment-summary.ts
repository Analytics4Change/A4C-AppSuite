#!/usr/bin/env node

/**
 * Extract alignment summary for GitHub Actions
 * This script safely extracts PR summary information from alignment reports
 * Converted from CommonJS to TypeScript
 */

import { existsSync, readFileSync, appendFileSync } from 'fs';
import { getLogger } from '../utils/logger.js';

const logger = getLogger('extract-summary');

interface AlignmentReport {
  prSummary?: string;
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
    logger.debug('Starting alignment summary extraction');
    
    // Verify input file exists
    if (!existsSync('doc-alignment-report.json')) {
      logger.error('Alignment report file not found');
      console.error('Alignment report file not found');
      process.exit(1);
    }

    // Read and parse the report
    const reportContent = readFileSync('doc-alignment-report.json', 'utf8');
    const report: AlignmentReport = JSON.parse(reportContent);

    // Extract and append PR summary if it exists
    if (report.prSummary && typeof report.prSummary === 'string') {
      appendFileSync('doc-status-report.md', report.prSummary + '\n\n');
      logger.info('Successfully extracted alignment details', { 
        summaryLength: report.prSummary.length 
      });
      console.log('Successfully extracted alignment details');
    } else {
      logger.warn('No PR summary found in alignment report');
      console.log('No PR summary found in alignment report');
    }

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Could not extract alignment details', error);
    console.error('Could not extract alignment details:', errorMessage);
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { main };