/**
 * ConfigureDNSActivity
 *
 * Creates DNS CNAME record for organization subdomain.
 *
 * Flow:
 * 1. List zones to find target domain zone
 * 2. Check if DNS record already exists (idempotency)
 * 3. Create CNAME record if not exists
 * 4. Emit DNSConfigured event
 *
 * Provider:
 * - Uses DNS provider from factory (Cloudflare/Mock/Logging)
 * - Provider determined by WORKFLOW_MODE and DNS_PROVIDER
 *
 * Idempotency:
 * - Checks for existing record before creation
 * - Returns existing record ID if found
 * - Event emission idempotent via event_id
 */

import type { ConfigureDNSParams, ConfigureDNSResult } from '@shared/types';
import { createDNSProvider } from '@shared/providers/dns/factory';
import { emitEvent, buildTags } from '@shared/utils/emit-event';

/**
 * Configure DNS activity
 * @param params - DNS configuration parameters
 * @returns DNS configuration result (FQDN and record ID)
 */
export async function configureDNS(
  params: ConfigureDNSParams
): Promise<ConfigureDNSResult> {
  console.log(`[ConfigureDNS] Starting for subdomain: ${params.subdomain}`);

  const dnsProvider = createDNSProvider();
  const fqdn = `${params.subdomain}.${params.targetDomain}`;

  // Find zone for target domain
  console.log(`[ConfigureDNS] Finding zone for: ${params.targetDomain}`);
  const zones = await dnsProvider.listZones(params.targetDomain);

  if (zones.length === 0) {
    throw new Error(`No DNS zone found for domain: ${params.targetDomain}`);
  }

  const zone = zones[0];
  if (!zone) {
    throw new Error(`Zone list returned empty zone for domain: ${params.targetDomain}`);
  }
  console.log(`[ConfigureDNS] Using zone: ${zone.id} (${zone.name})`);

  // Check if record already exists (idempotency)
  console.log(`[ConfigureDNS] Checking for existing CNAME record: ${fqdn}`);
  const existingRecords = await dnsProvider.listRecords(zone.id, {
    name: fqdn,
    type: 'CNAME'
  });

  if (existingRecords.length > 0) {
    const existing = existingRecords[0];
    if (!existing) {
      throw new Error(`Existing records list returned empty record`);
    }
    console.log(`[ConfigureDNS] DNS record already exists: ${existing.id}`);

    // Emit event even if record exists (for event replay)
    await emitEvent({
      event_type: 'DNSConfigured',
      aggregate_type: 'Organization',
      aggregate_id: params.orgId,
      event_data: {
        org_id: params.orgId,
        subdomain: params.subdomain,
        fqdn,
        record_id: existing.id,
        record_type: existing.type,
        record_content: existing.content
      },
      tags: buildTags()
    });

    return {
      fqdn,
      recordId: existing.id
    };
  }

  // Create CNAME record
  console.log(`[ConfigureDNS] Creating CNAME record: ${fqdn} → ${params.targetDomain}`);
  const record = await dnsProvider.createRecord(zone.id, {
    type: 'CNAME',
    name: fqdn,
    content: params.targetDomain,
    ttl: 3600,
    proxied: false
  });

  console.log(`[ConfigureDNS] Created DNS record: ${record.id}`);

  // Emit DNSConfigured event
  await emitEvent({
    event_type: 'DNSConfigured',
    aggregate_type: 'Organization',
    aggregate_id: params.orgId,
    event_data: {
      org_id: params.orgId,
      subdomain: params.subdomain,
      fqdn,
      record_id: record.id,
      record_type: record.type,
      record_content: record.content
    },
    tags: buildTags()
  });

  console.log(`[ConfigureDNS] Emitted DNSConfigured event for ${params.orgId}`);

  return {
    fqdn,
    recordId: record.id
  };
}
