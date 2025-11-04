/**
 * VerifyDNSActivity
 *
 * Verifies DNS record propagation using DNS lookup.
 *
 * Flow:
 * 1. Perform DNS lookup for FQDN
 * 2. Check if CNAME record exists
 * 3. Emit DNSVerified event if successful
 *
 * Retries:
 * - Workflow will retry this activity with exponential backoff
 * - DNS propagation typically takes 60-300 seconds
 * - Activity should throw error if DNS not propagated yet
 *
 * Note:
 * - In mock/logging mode, always succeeds (no real DNS)
 * - In production mode, performs real DNS lookup
 */

import { promises as dns } from 'dns';
import type { VerifyDNSParams } from '@shared/types';
import { emitEvent, buildTags } from '@shared/utils/emit-event';

/**
 * Verify DNS activity
 * @param params - DNS verification parameters
 * @returns true if DNS is verified
 * @throws Error if DNS not propagated (workflow will retry)
 */
export async function verifyDNS(params: VerifyDNSParams): Promise<boolean> {
  console.log(`[VerifyDNS] Starting for domain: ${params.domain}`);

  // In mock/development mode, skip real DNS verification
  const workflowMode = process.env.WORKFLOW_MODE || 'development';
  if (workflowMode === 'mock' || workflowMode === 'development') {
    console.log(`[VerifyDNS] Skipping DNS verification (${workflowMode} mode)`);

    // Emit DNSVerified event
    await emitEvent({
      event_type: 'DNSVerified',
      aggregate_type: 'Organization',
      aggregate_id: params.domain, // Use domain as aggregate ID (org ID not available)
      event_data: {
        domain: params.domain,
        verified: true,
        mode: workflowMode
      },
      tags: buildTags()
    });

    return true;
  }

  // Production mode: Perform real DNS lookup
  try {
    console.log(`[VerifyDNS] Performing DNS lookup for: ${params.domain}`);
    const records = await dns.resolveCname(params.domain);

    if (records.length === 0) {
      throw new Error(`No CNAME record found for ${params.domain}`);
    }

    console.log(`[VerifyDNS] DNS verified: ${params.domain} → ${records[0]}`);

    // Emit DNSVerified event
    await emitEvent({
      event_type: 'DNSVerified',
      aggregate_type: 'Organization',
      aggregate_id: params.domain,
      event_data: {
        domain: params.domain,
        verified: true,
        cname_target: records[0]
      },
      tags: buildTags()
    });

    return true;
  } catch (error) {
    if (error instanceof Error) {
      console.log(`[VerifyDNS] DNS not yet propagated: ${error.message}`);
      throw new Error(
        `DNS not yet propagated for ${params.domain}. ` +
        `This is normal during DNS propagation (60-300 seconds). ` +
        `Workflow will retry automatically.`
      );
    }
    throw error;
  }
}
