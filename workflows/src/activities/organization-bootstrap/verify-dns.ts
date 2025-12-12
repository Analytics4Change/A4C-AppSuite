/**
 * VerifyDNSActivity
 *
 * Verifies DNS record propagation using quorum-based multi-server lookup.
 *
 * Flow:
 * 1. Query 3 public DNS servers in parallel (Google, Cloudflare, OpenDNS)
 * 2. Require quorum of 2 servers to confirm A records exist
 * 3. Emit organization.subdomain.verified event if quorum reached
 *
 * Why Quorum-Based:
 * - Cloudflare proxied records return A records (IPs), not CNAME
 * - Single DNS server might be temporarily unreachable
 * - Different providers = different network paths = global confirmation
 *
 * Retries:
 * - Workflow will retry this activity with exponential backoff
 * - DNS propagation typically takes 60-300 seconds
 * - Activity should throw error if quorum not reached
 *
 * Note:
 * - In mock/development mode, always succeeds (no real DNS queries)
 * - In production mode, performs real DNS lookups against public resolvers
 */

import { Resolver } from 'dns';
import type { VerifyDNSParams } from '@shared/types';
import { emitEvent, buildTags } from '@shared/utils/emit-event';
import { AGGREGATE_TYPES } from '@shared/constants';

// Public DNS servers to query for propagation verification
const DNS_SERVERS = [
  { name: 'Google', ip: '8.8.8.8' },
  { name: 'Cloudflare', ip: '1.1.1.1' },
  { name: 'OpenDNS', ip: '208.67.222.222' }
] as const;

// Quorum configuration
const QUORUM_REQUIRED = 2;
const DNS_TIMEOUT_MS = 5000;

interface DnsCheckResult {
  server: string;
  success: boolean;
  ips?: string[];
  error?: string;
}

/**
 * Check DNS resolution against a specific DNS server
 * Uses isolated Resolver instance to avoid affecting other queries
 */
async function checkDnsWithServer(
  domain: string,
  server: { name: string; ip: string }
): Promise<DnsCheckResult> {
  const resolver = new Resolver();
  resolver.setServers([server.ip]);

  try {
    const ips = await Promise.race([
      new Promise<string[]>((resolve, reject) => {
        resolver.resolve4(domain, (err, addresses) => {
          if (err) reject(err);
          else resolve(addresses);
        });
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('DNS timeout')), DNS_TIMEOUT_MS)
      )
    ]);

    return { server: server.name, success: true, ips };
  } catch (error) {
    return {
      server: server.name,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Verify DNS propagation using quorum-based multi-server lookup
 * Queries multiple public DNS servers in parallel and requires quorum
 */
async function verifyDnsWithQuorum(
  domain: string
): Promise<{ verified: boolean; results: DnsCheckResult[] }> {
  const results = await Promise.all(
    DNS_SERVERS.map(server => checkDnsWithServer(domain, server))
  );

  const successCount = results.filter(r => r.success).length;
  const verified = successCount >= QUORUM_REQUIRED;

  return { verified, results };
}

/**
 * Verify DNS activity
 * @param params - DNS verification parameters
 * @returns true if DNS is verified (quorum reached)
 * @throws Error if DNS not propagated (quorum not reached, workflow will retry)
 */
export async function verifyDNS(params: VerifyDNSParams): Promise<boolean> {
  console.log(`[VerifyDNS] Starting for domain: ${params.domain}`);

  // In mock/development mode, skip real DNS verification
  const workflowMode = process.env.WORKFLOW_MODE || 'development';
  if (workflowMode === 'mock' || workflowMode === 'development') {
    console.log(`[VerifyDNS] Skipping DNS verification (${workflowMode} mode)`);

    // Emit DNSVerified event
    await emitEvent({
      event_type: 'organization.subdomain.verified',
      aggregate_type: AGGREGATE_TYPES.ORGANIZATION,
      aggregate_id: params.orgId,
      event_data: {
        domain: params.domain,
        verified: true,
        verified_at: new Date().toISOString(),
        verification_method: 'development',
        mode: workflowMode
      },
      tags: buildTags()
    });

    return true;
  }

  // Production mode: Perform quorum-based DNS verification
  console.log(`[VerifyDNS] Performing quorum-based DNS verification for: ${params.domain}`);
  console.log(`[VerifyDNS] Querying ${DNS_SERVERS.length} DNS servers, quorum required: ${QUORUM_REQUIRED}`);

  const { verified, results } = await verifyDnsWithQuorum(params.domain);

  // Log individual results
  for (const result of results) {
    if (result.success) {
      console.log(`[VerifyDNS] ✓ ${result.server}: ${params.domain} → [${result.ips?.join(', ')}]`);
    } else {
      console.log(`[VerifyDNS] ✗ ${result.server}: ${result.error}`);
    }
  }

  const successCount = results.filter(r => r.success).length;
  console.log(`[VerifyDNS] Quorum: ${successCount}/${DNS_SERVERS.length} (required: ${QUORUM_REQUIRED})`);

  if (!verified) {
    throw new Error(
      `DNS verification failed: only ${successCount}/${DNS_SERVERS.length} servers confirmed. ` +
      `Required quorum: ${QUORUM_REQUIRED}. Domain may not be fully propagated. ` +
      `This is normal during DNS propagation (60-300 seconds). Workflow will retry automatically.`
    );
  }

  // Get IPs from first successful result for event data
  const successfulResult = results.find(r => r.success);

  // Emit DNSVerified event with quorum details
  await emitEvent({
    event_type: 'organization.subdomain.verified',
    aggregate_type: AGGREGATE_TYPES.ORGANIZATION,
    aggregate_id: params.orgId,
    event_data: {
      domain: params.domain,
      verified: true,
      verified_at: new Date().toISOString(),
      verification_method: 'dns_quorum',
      quorum: `${successCount}/${DNS_SERVERS.length}`,
      dns_results: results.map(r => ({
        server: r.server,
        success: r.success,
        ips: r.ips
      })),
      resolved_ips: successfulResult?.ips || []
    },
    tags: buildTags()
  });

  console.log(`[VerifyDNS] DNS verified successfully via quorum: ${params.domain}`);
  return true;
}
