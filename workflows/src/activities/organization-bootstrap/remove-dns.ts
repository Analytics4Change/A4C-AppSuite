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
import { emitEvent, buildTags, getLogger } from '@shared/utils';
import { getWorkflowsEnv } from '@shared/config/env-schema';
import { AGGREGATE_TYPES } from '@shared/constants';

const log = getLogger('RemoveDNS');

/**
 * Remove DNS activity (compensation)
 * @param params - DNS removal parameters
 * @returns true if removed or not found
 */
export async function removeDNS(params: RemoveDNSParams): Promise<boolean> {
  log.info('Starting DNS removal', { subdomain: params.subdomain });

  const dnsProvider = createDNSProvider();
  const targetDomain = getWorkflowsEnv().TARGET_DOMAIN;
  const fqdn = `${params.subdomain}.${targetDomain}`;

  try {
    // Find zone for target domain
    log.debug('Finding zone', { targetDomain });
    const zones = await dnsProvider.listZones(targetDomain);

    if (zones.length === 0) {
      log.info('No DNS zone found, skipping', { targetDomain });
      return true;
    }

    const zone = zones[0];
    if (!zone) {
      log.info('Zone list returned empty zone, skipping');
      return true;
    }
    log.debug('Using zone', { zoneId: zone.id, zoneName: zone.name });

    // Find the CNAME record
    log.debug('Looking for CNAME record', { fqdn });
    const records = await dnsProvider.listRecords(zone.id, {
      name: fqdn,
      type: 'CNAME'
    });

    if (records.length === 0) {
      log.info('DNS record not found', { fqdn });

      // Emit event even if not found (for event replay)
      await emitEvent({
        event_type: 'organization.dns.removed',
        aggregate_type: AGGREGATE_TYPES.ORGANIZATION,
        aggregate_id: params.orgId,
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
      log.info('Records list returned empty record, skipping');
      return true;
    }
    log.debug('Deleting DNS record', { recordId: record.id });
    await dnsProvider.deleteRecord(zone.id, record.id);

    log.info('Deleted DNS record', { recordId: record.id });

    // Emit DNSRemoved event
    await emitEvent({
      event_type: 'organization.dns.removed',
      aggregate_type: AGGREGATE_TYPES.ORGANIZATION,
      aggregate_id: params.orgId,
      event_data: {
        subdomain: params.subdomain,
        fqdn,
        record_id: record.id,
        status: 'deleted'
      },
      tags: buildTags()
    });

    log.debug('Emitted organization.dns.removed event', { subdomain: params.subdomain });

    return true;
  } catch (error) {
    // Log error but don't fail compensation
    // We want cleanup to be best-effort
    if (error instanceof Error) {
      log.error('Non-fatal error removing DNS', { error: error.message });
    }

    // Emit event even on error
    await emitEvent({
      event_type: 'organization.dns.removed',
      aggregate_type: AGGREGATE_TYPES.ORGANIZATION,
      aggregate_id: params.orgId,
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
