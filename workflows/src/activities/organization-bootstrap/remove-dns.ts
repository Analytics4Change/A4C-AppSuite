/**
 * RemoveDNSActivity (Compensation)
 *
 * Removes DNS record created during organization provisioning.
 * Used for rollback when workflow fails after DNS creation.
 *
 * Flow:
 * 1. List zones to find target domain zone
 * 2. List records to find the CNAME record
 * 3. Delete the DNS record
 * 4. Emit DNSRemoved event
 *
 * Idempotency:
 * - Safe to call multiple times
 * - No-op if record doesn't exist
 * - Event emission idempotent via event_id
 */

import type { RemoveDNSParams } from '@shared/types';
import { createDNSProvider } from '@shared/providers/dns/factory';
import { emitEvent, buildTags } from '@shared/utils/emit-event';

/**
 * Remove DNS activity (compensation)
 * @param params - DNS removal parameters
 * @returns true if removed or not found
 */
export async function removeDNS(params: RemoveDNSParams): Promise<boolean> {
  console.log(`[RemoveDNS] Starting for subdomain: ${params.subdomain}`);

  const dnsProvider = createDNSProvider();
  const targetDomain = 'firstovertheline.com'; // TODO: Make configurable
  const fqdn = `${params.subdomain}.${targetDomain}`;

  try {
    // Find zone for target domain
    console.log(`[RemoveDNS] Finding zone for: ${targetDomain}`);
    const zones = await dnsProvider.listZones(targetDomain);

    if (zones.length === 0) {
      console.log(`[RemoveDNS] No DNS zone found for domain: ${targetDomain} (skip)`);
      return true;
    }

    const zone = zones[0];
    if (!zone) {
      console.log(`[RemoveDNS] Zone list returned empty zone (skip)`);
      return true;
    }
    console.log(`[RemoveDNS] Using zone: ${zone.id} (${zone.name})`);

    // Find the CNAME record
    console.log(`[RemoveDNS] Looking for CNAME record: ${fqdn}`);
    const records = await dnsProvider.listRecords(zone.id, {
      name: fqdn,
      type: 'CNAME'
    });

    if (records.length === 0) {
      console.log(`[RemoveDNS] DNS record not found (already removed or never created)`);

      // Emit event even if not found (for event replay)
      await emitEvent({
        event_type: 'DNSRemoved',
        aggregate_type: 'Organization',
        aggregate_id: params.subdomain, // Use subdomain as ID
        event_data: {
          subdomain: params.subdomain,
          fqdn,
          status: 'not_found'
        },
        tags: buildTags()
      });

      return true;
    }

    // Delete the DNS record
    const record = records[0];
    if (!record) {
      console.log(`[RemoveDNS] Records list returned empty record (skip)`);
      return true;
    }
    console.log(`[RemoveDNS] Deleting DNS record: ${record.id}`);
    await dnsProvider.deleteRecord(zone.id, record.id);

    console.log(`[RemoveDNS] Deleted DNS record: ${record.id}`);

    // Emit DNSRemoved event
    await emitEvent({
      event_type: 'DNSRemoved',
      aggregate_type: 'Organization',
      aggregate_id: params.subdomain,
      event_data: {
        subdomain: params.subdomain,
        fqdn,
        record_id: record.id,
        status: 'deleted'
      },
      tags: buildTags()
    });

    console.log(`[RemoveDNS] Emitted DNSRemoved event for ${params.subdomain}`);

    return true;
  } catch (error) {
    // Log error but don't fail compensation
    // We want cleanup to be best-effort
    if (error instanceof Error) {
      console.error(`[RemoveDNS] Error removing DNS (non-fatal): ${error.message}`);
    }

    // Emit event even on error
    await emitEvent({
      event_type: 'DNSRemoved',
      aggregate_type: 'Organization',
      aggregate_id: params.subdomain,
      event_data: {
        subdomain: params.subdomain,
        fqdn,
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      tags: buildTags()
    });

    return true; // Don't fail workflow
  }
}
