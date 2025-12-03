/**
 * Cloudflare DNS Provider (Production)
 *
 * Real DNS provider using Cloudflare API.
 * Creates actual DNS records for production and integration testing.
 *
 * Requirements:
 * - CLOUDFLARE_API_TOKEN environment variable
 * - Token must have Zone:Read and DNS:Edit permissions
 *
 * Note: Zone ID is auto-discovered via the listZones() API call.
 *
 * API Documentation: https://developers.cloudflare.com/api/operations/dns-records-for-a-zone-list-dns-records
 */

import type {
  IDNSProvider,
  DNSZone,
  DNSRecord,
  DNSRecordFilter,
  CreateDNSRecordParams
} from '../../types';

interface CloudflareZone {
  id: string;
  name: string;
  status: string;
}

interface CloudflareRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  ttl: number;
  proxied: boolean;
}

interface CloudflareListZonesResponse {
  result: CloudflareZone[];
  success: boolean;
  errors: Array<{ code: number; message: string }>;
}

interface CloudflareListRecordsResponse {
  result: CloudflareRecord[];
  success: boolean;
  errors: Array<{ code: number; message: string }>;
}

interface CloudflareCreateRecordResponse {
  result: CloudflareRecord;
  success: boolean;
  errors: Array<{ code: number; message: string }>;
}

interface CloudflareDeleteRecordResponse {
  result: { id: string };
  success: boolean;
  errors: Array<{ code: number; message: string }>;
}

export class CloudflareDNSProvider implements IDNSProvider {
  private readonly apiToken: string;
  private readonly baseUrl = 'https://api.cloudflare.com/client/v4';

  constructor() {
    const token = process.env.CLOUDFLARE_API_TOKEN;
    if (!token) {
      throw new Error(
        'CloudflareDNSProvider requires CLOUDFLARE_API_TOKEN environment variable. ' +
        'Get a token at https://dash.cloudflare.com/profile/api-tokens'
      );
    }
    this.apiToken = token;
  }

  /**
   * List DNS zones for a domain
   * @param domain - Domain name (e.g., 'firstovertheline.com')
   * @returns Array of DNS zones
   */
  async listZones(domain: string): Promise<DNSZone[]> {
    const url = `${this.baseUrl}/zones?name=${encodeURIComponent(domain)}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(
        `Cloudflare API error: ${response.status} ${response.statusText}`
      );
    }

    const data = await response.json() as CloudflareListZonesResponse;

    if (!data.success) {
      const errorMessages = data.errors.map(e => e.message).join(', ');
      throw new Error(`Cloudflare API error: ${errorMessages}`);
    }

    return data.result.map(zone => ({
      id: zone.id,
      name: zone.name
    }));
  }

  /**
   * List DNS records in a zone
   * @param zoneId - Cloudflare zone ID
   * @param filter - Optional filter (name, type)
   * @returns Array of DNS records
   */
  async listRecords(
    zoneId: string,
    filter?: DNSRecordFilter
  ): Promise<DNSRecord[]> {
    let url = `${this.baseUrl}/zones/${zoneId}/dns_records`;

    // Add query parameters for filtering
    const params = new URLSearchParams();
    if (filter?.name) {
      params.append('name', filter.name);
    }
    if (filter?.type) {
      params.append('type', filter.type);
    }

    if (params.toString()) {
      url += `?${params.toString()}`;
    }

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(
        `Cloudflare API error: ${response.status} ${response.statusText}`
      );
    }

    const data = await response.json() as CloudflareListRecordsResponse;

    if (!data.success) {
      const errorMessages = data.errors.map(e => e.message).join(', ');
      throw new Error(`Cloudflare API error: ${errorMessages}`);
    }

    return data.result.map(record => ({
      id: record.id,
      type: record.type,
      name: record.name,
      content: record.content,
      ttl: record.ttl,
      proxied: record.proxied
    }));
  }

  /**
   * Create a new DNS record
   * @param zoneId - Cloudflare zone ID
   * @param params - DNS record parameters
   * @returns Created DNS record
   */
  async createRecord(
    zoneId: string,
    params: CreateDNSRecordParams
  ): Promise<DNSRecord> {
    const url = `${this.baseUrl}/zones/${zoneId}/dns_records`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        type: params.type,
        name: params.name,
        content: params.content,
        ttl: params.ttl || 3600,
        proxied: params.proxied ?? false
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Cloudflare API error: ${response.status} ${response.statusText}. ${errorText}`
      );
    }

    const data = await response.json() as CloudflareCreateRecordResponse;

    if (!data.success) {
      const errorMessages = data.errors.map(e => e.message).join(', ');
      throw new Error(`Cloudflare API error: ${errorMessages}`);
    }

    const record = data.result;
    return {
      id: record.id,
      type: record.type,
      name: record.name,
      content: record.content,
      ttl: record.ttl,
      proxied: record.proxied
    };
  }

  /**
   * Delete a DNS record
   * @param zoneId - Cloudflare zone ID
   * @param recordId - DNS record ID to delete
   */
  async deleteRecord(zoneId: string, recordId: string): Promise<void> {
    const url = `${this.baseUrl}/zones/${zoneId}/dns_records/${recordId}`;

    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(
        `Cloudflare API error: ${response.status} ${response.statusText}`
      );
    }

    const data = await response.json() as CloudflareDeleteRecordResponse;

    if (!data.success) {
      const errorMessages = data.errors.map(e => e.message).join(', ');
      throw new Error(`Cloudflare API error: ${errorMessages}`);
    }
  }
}
