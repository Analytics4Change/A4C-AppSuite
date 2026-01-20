// @ts-nocheck - Schema mismatch with generated types (status/subdomain columns changed)
/**
 * Query Development Entities
 *
 * Lists all development/test entities in the database without deleting them.
 * Useful for auditing and verifying what will be cleaned up.
 *
 * Usage:
 *   npm run query:dev                # Query 'development' tag
 *   npm run query:dev -- --tag=test  # Query specific tag
 *   npm run query:dev -- --json      # Output as JSON
 *   npm run query:dev -- --csv       # Output as CSV
 *
 * Output:
 * - Lists all organizations with specified tag
 * - Lists all invitations with specified tag
 * - Shows summary statistics
 */

import { getSupabaseClient } from '../shared/utils/supabase';

interface QueryOptions {
  tag: string;
  format: 'table' | 'json' | 'csv';
}

interface Organization {
  id: string;
  name: string;
  subdomain: string;
  status: string;
  type: string;
  tags: string[];
  created_at: string;
  activated_at?: string;
  deleted_at?: string;
}

interface Invitation {
  invitation_id: string;
  email: string;
  organization_id: string;
  status: string;
  role: string;
  tags: string[];
  created_at: string;
  expires_at: string;
}

interface QueryResult {
  organizations: Organization[];
  invitations: Invitation[];
  summary: {
    totalOrganizations: number;
    activeOrganizations: number;
    deletedOrganizations: number;
    totalInvitations: number;
    pendingInvitations: number;
    expiredInvitations: number;
    tags: string[];
  };
}

/**
 * Parse command line arguments
 */
function parseArgs(): QueryOptions {
  const args = process.argv.slice(2);
  let format: 'table' | 'json' | 'csv' = 'table';

  if (args.includes('--json')) {
    format = 'json';
  } else if (args.includes('--csv')) {
    format = 'csv';
  }

  return {
    tag: args.find(arg => arg.startsWith('--tag='))?.split('=')[1] || 'development',
    format
  };
}

/**
 * Query development entities
 */
async function queryDevelopmentEntities(tag: string): Promise<QueryResult> {
  const supabase = getSupabaseClient();

  // Query organizations
  const { data: orgs, error: orgsError } = await supabase
    .from('organizations_projection')
    .select('*')
    .contains('tags', [tag])
    .order('created_at', { ascending: false });

  if (orgsError) {
    throw new Error(`Failed to query organizations: ${orgsError.message}`);
  }

  // Query invitations
  const { data: invitations, error: invitationsError } = await supabase
    .from('invitations_projection')
    .select('*')
    .contains('tags', [tag])
    .order('created_at', { ascending: false });

  if (invitationsError) {
    throw new Error(`Failed to query invitations: ${invitationsError.message}`);
  }

  const organizations = orgs || [];
  const invitationsList = invitations || [];

  // Collect all unique tags
  const allTags = new Set<string>();
  organizations.forEach(org => org.tags?.forEach((t: string) => allTags.add(t)));
  invitationsList.forEach(inv => inv.tags?.forEach((t: string) => allTags.add(t)));

  // Calculate summary statistics
  const summary = {
    totalOrganizations: organizations.length,
    activeOrganizations: organizations.filter(o => o.status === 'active').length,
    deletedOrganizations: organizations.filter(o => o.status === 'deleted' || o.deleted_at).length,
    totalInvitations: invitationsList.length,
    pendingInvitations: invitationsList.filter(i => i.status === 'pending').length,
    expiredInvitations: invitationsList.filter(i =>
      i.status === 'pending' && new Date(i.expires_at) < new Date()
    ).length,
    tags: Array.from(allTags).sort()
  };

  return {
    organizations,
    invitations: invitationsList,
    summary
  };
}

/**
 * Format output as table
 */
function formatAsTable(result: QueryResult, tag: string): void {
  console.log('='.repeat(80));
  console.log(`🔍 Development Entities Query - Tag: '${tag}'`);
  console.log('='.repeat(80));

  // Organizations
  if (result.organizations.length > 0) {
    console.log('\n📦 Organizations:\n');
    console.log('ID'.padEnd(38) + 'Name'.padEnd(25) + 'Subdomain'.padEnd(20) + 'Status');
    console.log('-'.repeat(80));

    result.organizations.forEach(org => {
      const id = org.id.substring(0, 36);
      const name = org.name.length > 23 ? org.name.substring(0, 20) + '...' : org.name;
      const subdomain = org.subdomain.length > 18 ? org.subdomain.substring(0, 15) + '...' : org.subdomain;

      console.log(
        id.padEnd(38) +
        name.padEnd(25) +
        subdomain.padEnd(20) +
        org.status
      );

      // Show additional details
      console.log(`   Type: ${org.type} | Created: ${new Date(org.created_at).toLocaleString()}`);
      if (org.activated_at) {
        console.log(`   Activated: ${new Date(org.activated_at).toLocaleString()}`);
      }
      if (org.deleted_at) {
        console.log(`   Deleted: ${new Date(org.deleted_at).toLocaleString()}`);
      }
      console.log(`   Tags: ${org.tags.join(', ')}`);
      console.log('');
    });
  } else {
    console.log(`\n✅ No organizations found with tag '${tag}'\n`);
  }

  // Invitations
  if (result.invitations.length > 0) {
    console.log('\n📧 Invitations:\n');
    console.log('Email'.padEnd(35) + 'Status'.padEnd(15) + 'Role'.padEnd(20) + 'Expires');
    console.log('-'.repeat(80));

    result.invitations.forEach(inv => {
      const email = inv.email.length > 33 ? inv.email.substring(0, 30) + '...' : inv.email;
      const expiresAt = new Date(inv.expires_at);
      const isExpired = expiresAt < new Date() && inv.status === 'pending';
      const expiresStr = expiresAt.toLocaleDateString();

      console.log(
        email.padEnd(35) +
        (isExpired ? inv.status + ' (EXPIRED)' : inv.status).padEnd(15) +
        inv.role.padEnd(20) +
        expiresStr
      );

      console.log(`   Org ID: ${inv.organization_id}`);
      console.log(`   Created: ${new Date(inv.created_at).toLocaleString()}`);
      console.log(`   Tags: ${inv.tags.join(', ')}`);
      console.log('');
    });
  } else {
    console.log(`\n✅ No invitations found with tag '${tag}'\n`);
  }

  // Summary
  console.log('='.repeat(80));
  console.log('📊 Summary');
  console.log('='.repeat(80));
  console.log('');
  console.log(`Organizations:       ${result.summary.totalOrganizations}`);
  console.log(`  • Active:          ${result.summary.activeOrganizations}`);
  console.log(`  • Deleted:         ${result.summary.deletedOrganizations}`);
  console.log('');
  console.log(`Invitations:         ${result.summary.totalInvitations}`);
  console.log(`  • Pending:         ${result.summary.pendingInvitations}`);
  console.log(`  • Expired:         ${result.summary.expiredInvitations}`);
  console.log('');
  console.log(`All tags found:      ${result.summary.tags.join(', ')}`);
  console.log('');
}

/**
 * Format output as JSON
 */
function formatAsJSON(result: QueryResult): void {
  console.log(JSON.stringify(result, null, 2));
}

/**
 * Format output as CSV
 */
function formatAsCSV(result: QueryResult): void {
  // Organizations CSV
  console.log('# Organizations');
  console.log('id,name,subdomain,status,type,created_at,activated_at,deleted_at,tags');

  result.organizations.forEach(org => {
    console.log([
      org.id,
      `"${org.name}"`,
      org.subdomain,
      org.status,
      org.type,
      org.created_at,
      org.activated_at || '',
      org.deleted_at || '',
      `"${org.tags.join(';')}"`
    ].join(','));
  });

  console.log('');
  console.log('# Invitations');
  console.log('invitation_id,email,organization_id,status,role,created_at,expires_at,tags');

  result.invitations.forEach(inv => {
    console.log([
      inv.invitation_id,
      inv.email,
      inv.organization_id,
      inv.status,
      inv.role,
      inv.created_at,
      inv.expires_at,
      `"${inv.tags.join(';')}"`
    ].join(','));
  });
}

/**
 * Main query function
 */
async function query(options: QueryOptions): Promise<void> {
  const result = await queryDevelopmentEntities(options.tag);

  switch (options.format) {
    case 'json':
      formatAsJSON(result);
      break;
    case 'csv':
      formatAsCSV(result);
      break;
    case 'table':
    default:
      formatAsTable(result, options.tag);
      break;
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

    await query(options);

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

export { query, queryDevelopmentEntities };
