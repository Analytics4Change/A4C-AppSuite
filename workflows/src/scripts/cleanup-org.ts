/**
 * Organization Cleanup Script
 *
 * Hard deletes an organization by slug from all database tables and Cloudflare DNS.
 * Designed to be run by Claude Code agent using Supabase MCP for database operations.
 *
 * What it does:
 * 1. Looks up organization by slug
 * 2. Counts records in all related tables
 * 3. Hard deletes from junction tables, projections, and domain_events
 * 4. Deletes Cloudflare DNS CNAME record
 *
 * Usage:
 *   npm run cleanup:org -- --slug=my-org-slug           # Execute cleanup
 *   npm run cleanup:org -- --slug=my-org-slug --dry-run # Show what would be deleted
 *   npm run cleanup:org -- --slug=my-org-slug --skip-dns # Skip DNS deletion
 *
 * Configuration:
 *   - Cloudflare token: Read from frontend/.env.local (CLOUDFLARE_API_TOKEN)
 *   - Supabase: Agent uses MCP server (no env vars needed)
 */

import * as fs from 'fs';
import * as path from 'path';

interface CleanupOptions {
  slug: string;
  dryRun: boolean;
  skipDns: boolean;
}

// Cloudflare configuration
const CLOUDFLARE_ZONE_ID = '538e5229b00f5660508a1c7fcd097f97';
const CLOUDFLARE_DOMAIN = 'firstovertheline.com';

/**
 * Parse command line arguments
 */
function parseArgs(): CleanupOptions {
  const args = process.argv.slice(2);

  const slugArg = args.find(arg => arg.startsWith('--slug='));
  if (!slugArg) {
    console.error('Error: --slug=<org-slug> is required');
    console.error('\nUsage:');
    console.error('  npm run cleanup:org -- --slug=my-org-slug');
    console.error('  npm run cleanup:org -- --slug=my-org-slug --dry-run');
    console.error('  npm run cleanup:org -- --slug=my-org-slug --skip-dns');
    process.exit(1);
  }

  const slug = slugArg.split('=')[1];
  if (!slug) {
    console.error('Error: --slug value cannot be empty');
    process.exit(1);
  }

  return {
    slug,
    dryRun: args.includes('--dry-run'),
    skipDns: args.includes('--skip-dns')
  };
}

/**
 * Read Cloudflare API token from frontend/.env.local
 */
function getCloudflareToken(): string | null {
  const envPath = path.resolve(__dirname, '../../../frontend/.env.local');

  try {
    const content = fs.readFileSync(envPath, 'utf-8');
    const match = content.match(/^CLOUDFLARE_API_TOKEN=(.+)$/m);
    return match && match[1] ? match[1].trim() : null;
  } catch {
    return null;
  }
}

/**
 * Delete DNS record from Cloudflare
 */
async function deleteDnsRecord(slug: string, token: string): Promise<boolean> {
  const fqdn = `${slug}.${CLOUDFLARE_DOMAIN}`;

  try {
    // Search for the DNS record
    const searchUrl = `https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/dns_records?search=${slug}`;
    const searchResponse = await fetch(searchUrl, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    if (!searchResponse.ok) {
      console.log(`   ❌ Failed to search DNS records: ${searchResponse.status}`);
      return false;
    }

    const searchData = await searchResponse.json() as { result: Array<{ id: string; name: string }> };
    const record = searchData.result?.find((r: { name: string }) => r.name === fqdn);

    if (!record) {
      console.log(`   ℹ️  No DNS record found for ${fqdn}`);
      return true; // Not an error, just doesn't exist
    }

    // Delete the record
    const deleteUrl = `https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/dns_records/${record.id}`;
    const deleteResponse = await fetch(deleteUrl, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    if (!deleteResponse.ok) {
      console.log(`   ❌ Failed to delete DNS record: ${deleteResponse.status}`);
      return false;
    }

    console.log(`   ✅ Deleted DNS record: ${fqdn}`);
    return true;
  } catch (error) {
    console.log(`   ❌ DNS deletion error: ${error instanceof Error ? error.message : 'Unknown'}`);
    return false;
  }
}

/**
 * Main cleanup function
 *
 * NOTE: Database operations are performed by the Claude Code agent using Supabase MCP.
 * This script outputs the SQL statements and guides the agent through the process.
 */
async function cleanup(options: CleanupOptions): Promise<void> {
  console.log('='.repeat(60));
  console.log('🧹 Organization Cleanup Script');
  console.log('='.repeat(60));

  if (options.dryRun) {
    console.log('\n⚠️  DRY RUN MODE - No changes will be made\n');
  }

  console.log(`\nLooking up organization: ${options.slug}`);
  console.log('\n📋 The Claude Code agent should execute the following steps:\n');

  // Step 1: Lookup organization
  console.log('Step 1: Look up organization by slug');
  console.log('─'.repeat(40));
  console.log(`SQL: SELECT id, name, slug FROM organizations_projection WHERE slug = '${options.slug}';`);
  console.log('\nIf no organization found, abort the cleanup.\n');

  // Step 2: Count records
  console.log('Step 2: Count records to delete (replace {ORG_ID} with actual ID)');
  console.log('─'.repeat(40));
  console.log(`SQL:
SELECT 'organization_contacts' as table_name, COUNT(*) as count FROM organization_contacts WHERE organization_id = '{ORG_ID}'
UNION ALL SELECT 'organization_addresses', COUNT(*) FROM organization_addresses WHERE organization_id = '{ORG_ID}'
UNION ALL SELECT 'organization_phones', COUNT(*) FROM organization_phones WHERE organization_id = '{ORG_ID}'
UNION ALL SELECT 'invitations_projection', COUNT(*) FROM invitations_projection WHERE organization_id = '{ORG_ID}'
UNION ALL SELECT 'contacts_projection', COUNT(*) FROM contacts_projection WHERE organization_id = '{ORG_ID}'
UNION ALL SELECT 'addresses_projection', COUNT(*) FROM addresses_projection WHERE organization_id = '{ORG_ID}'
UNION ALL SELECT 'phones_projection', COUNT(*) FROM phones_projection WHERE organization_id = '{ORG_ID}'
UNION ALL SELECT 'organizations_projection', COUNT(*) FROM organizations_projection WHERE id = '{ORG_ID}'
UNION ALL SELECT 'domain_events', COUNT(*) FROM domain_events WHERE stream_id = '{ORG_ID}';
`);

  if (options.dryRun) {
    console.log('\n⚠️  DRY RUN - Stop here. No deletions will be performed.\n');
    return;
  }

  // Step 3: Delete records
  console.log('Step 3: Delete records (in FK-safe order)');
  console.log('─'.repeat(40));
  console.log(`SQL:
-- Junction tables first
DELETE FROM organization_contacts WHERE organization_id = '{ORG_ID}';
DELETE FROM organization_addresses WHERE organization_id = '{ORG_ID}';
DELETE FROM organization_phones WHERE organization_id = '{ORG_ID}';

-- Dependent projections
DELETE FROM invitations_projection WHERE organization_id = '{ORG_ID}';
DELETE FROM contacts_projection WHERE organization_id = '{ORG_ID}';
DELETE FROM addresses_projection WHERE organization_id = '{ORG_ID}';
DELETE FROM phones_projection WHERE organization_id = '{ORG_ID}';

-- Organization projection
DELETE FROM organizations_projection WHERE id = '{ORG_ID}';

-- Domain events
DELETE FROM domain_events WHERE stream_id = '{ORG_ID}';
`);

  // Step 4: DNS cleanup
  if (!options.skipDns) {
    console.log('\nStep 4: Delete Cloudflare DNS record');
    console.log('─'.repeat(40));

    const token = getCloudflareToken();
    if (!token) {
      console.log('   ⚠️  CLOUDFLARE_API_TOKEN not found in frontend/.env.local');
      console.log('   Skipping DNS deletion. Delete manually if needed.');
    } else {
      console.log(`   Deleting DNS record for: ${options.slug}.${CLOUDFLARE_DOMAIN}`);
      await deleteDnsRecord(options.slug, token);
    }
  } else {
    console.log('\nStep 4: DNS deletion skipped (--skip-dns flag)');
  }

  console.log('\n' + '='.repeat(60));
  console.log('✅ Cleanup script completed');
  console.log('='.repeat(60));
}

/**
 * Main entry point
 */
async function main() {
  try {
    const options = parseArgs();
    await cleanup(options);
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error:', error instanceof Error ? error.message : 'Unknown error');
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

export { cleanup };
export type { CleanupOptions };
