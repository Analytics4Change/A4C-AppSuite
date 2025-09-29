#!/usr/bin/env node

/**
 * Bootstrap roles and permissions to Zitadel
 * Run with: npm run bootstrap:roles
 */

import { getBootstrapService } from '../services/bootstrap/zitadel-bootstrap.service';
import { BOOTSTRAP_ROLES } from '../config/roles.config';
import { PERMISSIONS } from '../config/permissions.config';

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const checkStatus = args.includes('--status');

async function main() {
  console.log('========================================');
  console.log('Zitadel Role Bootstrap');
  console.log('========================================\n');

  const service = getBootstrapService({
    isDryRun
  });

  if (checkStatus) {
    console.log('Checking bootstrap status...\n');
    const status = await service.getStatus();

    console.log(`Roles Configured: ${status.rolesConfigured}`);
    console.log(`Roles Synced: ${status.rolesSynced.join(', ') || 'None'}`);
    console.log(`Roles Not Synced: ${status.rolesNotSynced.join(', ') || 'None'}`);
    console.log(`Permissions Configured: ${status.permissionsConfigured}`);
    return;
  }

  console.log(`Mode: ${isDryRun ? 'DRY RUN' : 'LIVE'}\n`);

  console.log('Roles to bootstrap:');
  Object.entries(BOOTSTRAP_ROLES).forEach(([key, role]) => {
    console.log(`  - ${key}: ${role.displayName} (${role.permissions.length} permissions)`);
  });

  console.log(`\nTotal permissions defined: ${Object.keys(PERMISSIONS).length}`);
  console.log(`Initial admin email: ${process.env.VITE_BOOTSTRAP_ADMIN_EMAIL || 'Not configured'}`);

  console.log('\nStarting bootstrap...\n');

  const result = isDryRun ? await service.dryRun() : await service.bootstrap();

  console.log('\n========================================');
  console.log('Bootstrap Result');
  console.log('========================================\n');

  console.log(`Success: ${result.success ? '✅' : '❌'}`);
  console.log(`Roles Created: ${result.rolesCreated.join(', ') || 'None'}`);
  console.log(`Roles Failed: ${result.rolesFailed.join(', ') || 'None'}`);

  if (result.warnings.length > 0) {
    console.log('\nWarnings:');
    result.warnings.forEach(warning => console.log(`  ⚠️  ${warning}`));
  }

  if (result.errors.length > 0) {
    console.log('\nErrors:');
    result.errors.forEach(error => console.log(`  ❌ ${error}`));
  }

  if (!result.success) {
    console.log('\n❌ Bootstrap failed. Please check the errors above.');
    process.exit(1);
  }

  console.log('\n✅ Bootstrap completed successfully!');

  if (!isDryRun) {
    console.log('\nNext steps:');
    console.log('1. Ensure the application in Zitadel is configured to assert roles in tokens');
    console.log(`2. Grant super_admin role to ${process.env.VITE_BOOTSTRAP_ADMIN_EMAIL}`);
    console.log('3. Log out and log back in to apply new roles');
  }
}

main().catch(error => {
  console.error('Bootstrap failed:', error);
  process.exit(1);
});