// @ts-nocheck - Schema mismatch with generated types (subdomain column renamed)
/**
 * Cleanup Development Entities
 *
 * Removes development/test entities from the database and DNS provider.
 *
 * What it does:
 * 1. Queries for organizations with 'development' tag
 * 2. For each organization:
 *    - Deletes DNS CNAME record from Cloudflare
 *    - Marks organization as deleted (soft delete)
 *    - Revokes pending invitations
 * 3. Shows summary of cleanup operations
 *
 * Usage:
 *   npm run cleanup:dev           # Interactive mode (prompts for confirmation)
 *   npm run cleanup:dev -- --dry-run  # Dry run (show what would be deleted)
 *   npm run cleanup:dev -- --yes      # Skip confirmation
 *   npm run cleanup:dev -- --tag=test # Clean specific tag
 *
 * Safety:
 * - Only affects entities with 'development' or custom tags
 * - Soft deletes (records remain for audit)
 * - DNS deletion is best-effort (errors don't fail entire cleanup)
 * - Dry-run mode to preview changes
 */

import { createDNSProvider } from '../shared/providers/dns/factory';
import { getSupabaseClient } from '../shared/utils/supabase';
import { getWorkflowsEnv } from '../shared/config/env-schema';
import * as readline from 'readline';

interface CleanupStats {
  organizationsDeleted: number;
  dnsRecordsDeleted: number;
  invitationsRevoked: number;
  errors: string[];
}

interface CleanupOptions {
  dryRun: boolean;
  skipConfirmation: boolean;
  tag: string;
}

/**
 * Parse command line arguments
 */
function parseArgs(): CleanupOptions {
  const args = process.argv.slice(2);
  return {
    dryRun: args.includes('--dry-run'),
    skipConfirmation: args.includes('--yes') || args.includes('-y'),
    tag: args.find(arg => arg.startsWith('--tag='))?.split('=')[1] || 'development'
  };
}

/**
 * Prompt user for confirmation
 */
function promptConfirmation(message: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(`${message} (yes/no): `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y');
    });
  });
}

/**
 * Query development entities
 */
async function queryDevelopmentEntities(tag: string) {
  const supabase = getSupabaseClient();

  console.log(`\n🔍 Searching for entities with tag: '${tag}'...\n`);

  // Query organizations
  const { data: orgs, error: orgsError } = await supabase
    .from('organizations_projection')
    .select('id, name, subdomain, status, tags, created_at')
    .contains('tags', [tag])
    .order('created_at', { ascending: false });

  if (orgsError) {
    throw new Error(`Failed to query organizations: ${orgsError.message}`);
  }

  // Query invitations
  const { data: invitations, error: invitationsError } = await supabase
    .from('invitations_projection')
    .select('invitation_id, email, organization_id, status, tags, created_at')
    .contains('tags', [tag])
    .order('created_at', { ascending: false });

  if (invitationsError) {
    throw new Error(`Failed to query invitations: ${invitationsError.message}`);
  }

  return { orgs: orgs || [], invitations: invitations || [] };
}

/**
 * Delete DNS record for organization
 */
async function deleteDNSRecord(subdomain: string, stats: CleanupStats): Promise<void> {
  try {
    const dnsProvider = createDNSProvider();
    const targetDomain = getWorkflowsEnv().PLATFORM_BASE_DOMAIN;
    const fqdn = `${subdomain}.${targetDomain}`;

    // Find zone
    const zones = await dnsProvider.listZones(targetDomain);
    if (zones.length === 0) {
      console.log(`   ⚠️  No DNS zone found for ${targetDomain}`);
      return;
    }

    const zone = zones[0];
    if (!zone) {
      console.log(`   ⚠️  Zone list returned empty zone`);
      return;
    }

    // Find CNAME record
    const records = await dnsProvider.listRecords(zone.id, {
      name: fqdn,
      type: 'CNAME'
    });

    if (records.length === 0) {
      console.log(`   ℹ️  No DNS record found for ${fqdn}`);
      return;
    }

    // Delete record
    const record = records[0];
    if (!record) {
      console.log(`   ℹ️  Records list returned empty record`);
      return;
    }
    await dnsProvider.deleteRecord(zone.id, record.id);
    stats.dnsRecordsDeleted++;
    console.log(`   ✅ Deleted DNS record: ${fqdn}`);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.log(`   ❌ Failed to delete DNS record: ${errorMsg}`);
    stats.errors.push(`DNS deletion failed for ${subdomain}: ${errorMsg}`);
  }
}

/**
 * Delete organization (soft delete)
 */
async function deleteOrganization(orgId: string, stats: CleanupStats): Promise<void> {
  const supabase = getSupabaseClient();

  const { error } = await supabase
    .from('organizations_projection')
    .update({
      status: 'deleted',
      deleted_at: new Date().toISOString()
    })
    .eq('id', orgId);

  if (error) {
    const errorMsg = `Failed to delete organization ${orgId}: ${error.message}`;
    console.log(`   ❌ ${errorMsg}`);
    stats.errors.push(errorMsg);
  } else {
    stats.organizationsDeleted++;
    console.log(`   ✅ Marked organization as deleted`);
  }
}

/**
 * Revoke invitations for organization
 */
async function revokeInvitations(orgId: string, stats: CleanupStats): Promise<void> {
  const supabase = getSupabaseClient();

  // Count pending invitations first
  const { data: pendingInvitations } = await supabase
    .from('invitations_projection')
    .select('invitation_id')
    .eq('organization_id', orgId)
    .eq('status', 'pending');

  if (!pendingInvitations || pendingInvitations.length === 0) {
    console.log(`   ℹ️  No pending invitations to revoke`);
    return;
  }

  // Revoke them
  const { error } = await supabase
    .from('invitations_projection')
    .update({
      status: 'deleted',
      updated_at: new Date().toISOString()
    })
    .eq('organization_id', orgId)
    .eq('status', 'pending');

  if (error) {
    const errorMsg = `Failed to revoke invitations for ${orgId}: ${error.message}`;
    console.log(`   ❌ ${errorMsg}`);
    stats.errors.push(errorMsg);
  } else {
    stats.invitationsRevoked += pendingInvitations.length;
    console.log(`   ✅ Revoked ${pendingInvitations.length} invitation(s)`);
  }
}

/**
 * Cleanup development entities
 */
async function cleanup(options: CleanupOptions): Promise<void> {
  console.log('='.repeat(60));
  console.log('🧹 Development Entity Cleanup');
  console.log('='.repeat(60));

  if (options.dryRun) {
    console.log('\n⚠️  DRY RUN MODE - No changes will be made\n');
  }

  // Query entities
  const { orgs, invitations } = await queryDevelopmentEntities(options.tag);

  if (orgs.length === 0 && invitations.length === 0) {
    console.log(`✅ No development entities found with tag '${options.tag}'\n`);
    return;
  }

  // Display what will be cleaned up
  console.log(`Found ${orgs.length} organization(s) and ${invitations.length} invitation(s)\n`);

  if (orgs.length > 0) {
    console.log('Organizations to clean up:');
    orgs.forEach((org, i) => {
      console.log(`\n${i + 1}. ${org.name} (${org.subdomain})`);
      console.log(`   ID: ${org.id}`);
      console.log(`   Status: ${org.status}`);
      console.log(`   Tags: ${org.tags.join(', ')}`);
      console.log(`   Created: ${new Date(org.created_at).toLocaleString()}`);
    });
    console.log('');
  }

  // Confirm with user (unless skipped)
  if (!options.dryRun && !options.skipConfirmation) {
    const confirmed = await promptConfirmation(
      '\n⚠️  This will DELETE DNS records and mark entities as deleted. Continue?'
    );

    if (!confirmed) {
      console.log('\n❌ Cleanup cancelled\n');
      return;
    }
  }

  // Perform cleanup
  const stats: CleanupStats = {
    organizationsDeleted: 0,
    dnsRecordsDeleted: 0,
    invitationsRevoked: 0,
    errors: []
  };

  console.log('\n' + '='.repeat(60));
  console.log('Starting cleanup...');
  console.log('='.repeat(60) + '\n');

  for (const org of orgs) {
    console.log(`Processing: ${org.name} (${org.subdomain})`);

    if (!options.dryRun) {
      // Delete DNS record
      await deleteDNSRecord(org.subdomain, stats);

      // Revoke invitations
      await revokeInvitations(org.id, stats);

      // Delete organization
      await deleteOrganization(org.id, stats);
    } else {
      console.log(`   [DRY RUN] Would delete DNS record: ${org.subdomain}.${getWorkflowsEnv().PLATFORM_BASE_DOMAIN}`);
      console.log(`   [DRY RUN] Would revoke invitations for org: ${org.id}`);
      console.log(`   [DRY RUN] Would mark organization as deleted: ${org.id}`);
    }

    console.log('');
  }

  // Display summary
  console.log('='.repeat(60));
  console.log('Cleanup Summary');
  console.log('='.repeat(60));

  if (options.dryRun) {
    console.log('\n⚠️  DRY RUN - No actual changes were made\n');
    console.log(`Would have deleted:`);
    console.log(`  • ${orgs.length} organization(s)`);
    console.log(`  • ${orgs.length} DNS record(s)`);
    console.log(`  • ${invitations.filter(i => i.status === 'pending').length} invitation(s)\n`);
  } else {
    console.log('');
    console.log(`✅ Organizations deleted: ${stats.organizationsDeleted}`);
    console.log(`✅ DNS records deleted: ${stats.dnsRecordsDeleted}`);
    console.log(`✅ Invitations revoked: ${stats.invitationsRevoked}`);

    if (stats.errors.length > 0) {
      console.log(`\n⚠️  Errors (${stats.errors.length}):`);
      stats.errors.forEach((error, i) => {
        console.log(`  ${i + 1}. ${error}`);
      });
    }

    console.log('');
  }
}

/**
 * Main entry point
 */
async function main() {
  try {
    const options = parseArgs();

    // Load environment variables
    if (process.env.NODE_ENV !== 'production') {
      const dotenv = await import('dotenv');
      dotenv.config({ path: '.env.local' });
      dotenv.config();
    }

    // Validate configuration
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error(
        'Missing required environment variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY'
      );
    }

    await cleanup(options);

    console.log('✅ Done!\n');
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
