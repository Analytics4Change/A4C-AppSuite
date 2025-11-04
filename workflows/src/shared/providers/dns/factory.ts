/**
 * DNS Provider Factory
 *
 * Creates appropriate DNS provider based on environment configuration.
 * Validates credentials and ensures configuration consistency.
 *
 * Provider Selection Logic:
 * 1. Check DNS_PROVIDER override
 * 2. If not set or 'auto', use WORKFLOW_MODE defaults:
 *    - mock → MockDNSProvider
 *    - development → LoggingDNSProvider
 *    - production → CloudflareDNSProvider
 * 3. Validate required credentials
 *
 * Usage:
 * ```typescript
 * const dnsProvider = createDNSProvider();
 * const zones = await dnsProvider.listZones('firstovertheline.com');
 * ```
 */

import type { IDNSProvider } from '../../types';
import type { ProviderType, WorkflowMode } from '../../config/validate-config';
import { CloudflareDNSProvider } from './cloudflare-provider';
import { MockDNSProvider } from './mock-provider';
import { LoggingDNSProvider } from './logging-provider';

/**
 * Create DNS provider based on environment configuration
 * @returns IDNSProvider instance
 * @throws Error if invalid configuration
 */
export function createDNSProvider(): IDNSProvider {
  const mode = (process.env.WORKFLOW_MODE || 'development') as WorkflowMode;
  const dnsProviderOverride = process.env.DNS_PROVIDER as ProviderType | undefined;

  // Determine provider type
  let providerType: ProviderType;

  if (dnsProviderOverride && dnsProviderOverride !== 'auto') {
    // Use explicit override
    providerType = dnsProviderOverride;
  } else {
    // Auto-select based on mode
    switch (mode) {
      case 'mock':
        providerType = 'mock';
        break;
      case 'development':
        providerType = 'logging';
        break;
      case 'production':
        providerType = 'cloudflare';
        break;
      default:
        providerType = 'logging';
    }
  }

  // Log provider selection
  console.log(`\n[DNS Provider Factory]`);
  console.log(`  Mode: ${mode}`);
  if (dnsProviderOverride) {
    console.log(`  Override: ${dnsProviderOverride}`);
  }
  console.log(`  Selected: ${providerType}Provider\n`);

  // Create provider
  switch (providerType) {
    case 'cloudflare':
      return createCloudflareProvider();

    case 'mock':
      return new MockDNSProvider();

    case 'logging':
      return new LoggingDNSProvider();

    default:
      throw new Error(
        `Invalid DNS_PROVIDER: ${providerType}. ` +
        `Valid options: cloudflare, mock, logging, auto`
      );
  }
}

/**
 * Create Cloudflare provider with credential validation
 */
function createCloudflareProvider(): CloudflareDNSProvider {
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;

  if (!apiToken) {
    throw new Error(
      'Cloudflare DNS provider requires CLOUDFLARE_API_TOKEN.\n' +
      '\n' +
      'Options:\n' +
      '1. Set CLOUDFLARE_API_TOKEN environment variable\n' +
      '2. Use DNS_PROVIDER=logging for development (console logging)\n' +
      '3. Use DNS_PROVIDER=mock for testing (in-memory)\n' +
      '\n' +
      'Get API token: https://dash.cloudflare.com/profile/api-tokens\n' +
      'Required permissions: Zone:Read, DNS:Edit'
    );
  }

  return new CloudflareDNSProvider();
}

/**
 * Get DNS provider type (for logging/debugging)
 */
export function getDNSProviderType(): ProviderType {
  const mode = (process.env.WORKFLOW_MODE || 'development') as WorkflowMode;
  const dnsProviderOverride = process.env.DNS_PROVIDER as ProviderType | undefined;

  if (dnsProviderOverride && dnsProviderOverride !== 'auto') {
    return dnsProviderOverride;
  }

  switch (mode) {
    case 'mock': return 'mock';
    case 'development': return 'logging';
    case 'production': return 'cloudflare';
    default: return 'logging';
  }
}
