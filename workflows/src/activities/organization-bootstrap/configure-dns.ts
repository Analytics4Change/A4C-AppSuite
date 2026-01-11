/**
 * ConfigureDNSActivity
 *
 * Creates DNS CNAME record for organization subdomain.
 *
 * Flow:
 * 1. List zones to find target domain zone
 * 2. Check if DNS record already exists (idempotency)
 * 3. Create CNAME record if not exists
 * 4. Emit organization.subdomain.dns_created event (AsyncAPI contract)
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
import { getLogger, emitSubdomainDnsCreated, DNSRecordType } from '@shared/utils';
import { getWorkflowsEnv } from '@shared/config/env-schema';

const log = getLogger('ConfigureDNS');

/**
 * Configure DNS activity
 * @param params - DNS configuration parameters
 * @returns DNS configuration result (FQDN and record ID)
 */
export async function configureDNS(
  params: ConfigureDNSParams
): Promise<ConfigureDNSResult> {
  log.info('Starting DNS configuration', { subdomain: params.subdomain });

  // Get domain configuration from environment
  const env = getWorkflowsEnv();

  // PLATFORM_BASE_DOMAIN is the root domain for tenant subdomains (e.g., firstovertheline.com)
  // TARGET_DOMAIN is the CNAME target for subdomain routing (e.g., a4c.firstovertheline.com)
  const baseDomain = env.PLATFORM_BASE_DOMAIN;
  const cnameTarget = params.targetDomain ?? env.TARGET_DOMAIN;

  const dnsProvider = createDNSProvider();
  const fqdn = `${params.subdomain}.${baseDomain}`;

  // Find zone for base domain
  log.debug('Finding zone', { baseDomain });
  const zones = await dnsProvider.listZones(baseDomain);

  if (zones.length === 0) {
    throw new Error(`No DNS zone found for domain: ${baseDomain}`);
  }

  const zone = zones[0];
  if (!zone) {
    throw new Error(`Zone list returned empty zone for domain: ${baseDomain}`);
  }
  log.debug('Using zone', { zoneId: zone.id, zoneName: zone.name });

  // Check if record already exists (idempotency)
  log.debug('Checking for existing CNAME record', { fqdn });
  const existingRecords = await dnsProvider.listRecords(zone.id, {
    name: fqdn,
    type: 'CNAME'
  });

  if (existingRecords.length > 0) {
    const existing = existingRecords[0];
    if (!existing) {
      throw new Error(`Existing records list returned empty record`);
    }
    log.info('DNS record already exists', { recordId: existing.id });

    // Emit event even if record exists (for event replay)
    // Type-safe event using AsyncAPI contract
    await emitSubdomainDnsCreated(params.orgId, {
      subdomain: params.subdomain,
      cloudflare_record_id: existing.id,
      cloudflare_zone_id: zone.id,
      dns_record_type: existing.type === 'CNAME' ? DNSRecordType.CNAME : DNSRecordType.A,
      dns_record_value: existing.content,
    }, params.tracing);

    return {
      fqdn,
      recordId: existing.id
    };
  }

  // Create CNAME record (proxied through Cloudflare for tunnel routing)
  log.info('Creating CNAME record', { fqdn, target: cnameTarget });
  const record = await dnsProvider.createRecord(zone.id, {
    type: 'CNAME',
    name: fqdn,
    content: cnameTarget,
    ttl: 1,  // Auto TTL when proxied
    proxied: true  // Required for Cloudflare Tunnel routing
  });

  log.info('Created DNS record', { recordId: record.id });

  // Type-safe event using AsyncAPI contract
  await emitSubdomainDnsCreated(params.orgId, {
    subdomain: params.subdomain,
    cloudflare_record_id: record.id,
    cloudflare_zone_id: zone.id,
    dns_record_type: record.type === 'CNAME' ? DNSRecordType.CNAME : DNSRecordType.A,
    dns_record_value: record.content,
  }, params.tracing);

  log.info('Emitted organization.subdomain.dns_created event', { orgId: params.orgId });

  return {
    fqdn,
    recordId: record.id
  };
}
