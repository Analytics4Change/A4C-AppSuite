/**
 * Mock DNS Provider (Unit Testing)
 *
 * In-memory DNS provider for unit tests and CI/CD pipelines.
 * All operations are local, no network calls, no console output.
 *
 * Use Case:
 * - Unit tests
 * - CI/CD pipelines
 * - Fast test execution
 * - Workflow replay testing
 *
 * Features:
 * - In-memory storage (cleared on restart)
 * - Deterministic behavior
 * - No side effects
 * - Instant response times
 */

import type {
  IDNSProvider,
  DNSZone,
  DNSRecord,
  DNSRecordFilter,
  CreateDNSRecordParams
} from '../../types';

interface StoredZone extends DNSZone {
  records: Map<string, DNSRecord>;
}

export class MockDNSProvider implements IDNSProvider {
  private zones: Map<string, StoredZone> = new Map();
  private recordIdCounter = 1;
  private zoneIdCounter = 1;

  constructor() {
    // Pre-populate with a default zone for testing
    this.createDefaultZone();
  }

  /**
   * Create default zone for testing
   */
  private createDefaultZone(): void {
    const zoneId = `zone_${this.zoneIdCounter++}`;
    this.zones.set('firstovertheline.com', {
      id: zoneId,
      name: 'firstovertheline.com',
      records: new Map()
    });
  }

  /**
   * List DNS zones for a domain
   * @param domain - Domain name
   * @returns Array of matching zones
   */
  async listZones(domain: string): Promise<DNSZone[]> {
    const zone = this.zones.get(domain);
    if (!zone) {
      return [];
    }

    return [{
      id: zone.id,
      name: zone.name
    }];
  }

  /**
   * List DNS records in a zone
   * @param zoneId - Zone ID
   * @param filter - Optional filter (name, type)
   * @returns Array of DNS records
   */
  async listRecords(
    zoneId: string,
    filter?: DNSRecordFilter
  ): Promise<DNSRecord[]> {
    // Find zone by ID
    const zone = Array.from(this.zones.values()).find(z => z.id === zoneId);
    if (!zone) {
      throw new Error(`Zone not found: ${zoneId}`);
    }

    let records = Array.from(zone.records.values());

    // Apply filters
    if (filter?.name) {
      records = records.filter(r => r.name === filter.name);
    }
    if (filter?.type) {
      records = records.filter(r => r.type === filter.type);
    }

    return records;
  }

  /**
   * Create a new DNS record
   * @param zoneId - Zone ID
   * @param params - DNS record parameters
   * @returns Created DNS record
   */
  async createRecord(
    zoneId: string,
    params: CreateDNSRecordParams
  ): Promise<DNSRecord> {
    // Find zone by ID
    const zone = Array.from(this.zones.values()).find(z => z.id === zoneId);
    if (!zone) {
      throw new Error(`Zone not found: ${zoneId}`);
    }

    // Check for duplicate record (same name and type)
    const existingRecord = Array.from(zone.records.values()).find(
      r => r.name === params.name && r.type === params.type
    );

    if (existingRecord) {
      // Return existing record (idempotent behavior)
      return existingRecord;
    }

    // Create new record
    const recordId = `record_${this.recordIdCounter++}`;
    const record: DNSRecord = {
      id: recordId,
      type: params.type,
      name: params.name,
      content: params.content,
      ttl: params.ttl || 3600,
      proxied: params.proxied ?? false
    };

    zone.records.set(recordId, record);
    return record;
  }

  /**
   * Delete a DNS record
   * @param zoneId - Zone ID
   * @param recordId - DNS record ID to delete
   */
  async deleteRecord(zoneId: string, recordId: string): Promise<void> {
    // Find zone by ID
    const zone = Array.from(this.zones.values()).find(z => z.id === zoneId);
    if (!zone) {
      throw new Error(`Zone not found: ${zoneId}`);
    }

    const deleted = zone.records.delete(recordId);
    if (!deleted) {
      // Idempotent: Don't throw if record doesn't exist
      return;
    }
  }

  /**
   * Clear all zones and records (for testing)
   */
  reset(): void {
    this.zones.clear();
    this.recordIdCounter = 1;
    this.zoneIdCounter = 1;
    this.createDefaultZone();
  }

  /**
   * Get all zones (for testing/inspection)
   */
  getZones(): StoredZone[] {
    return Array.from(this.zones.values());
  }
}
