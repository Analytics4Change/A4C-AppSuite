#!/usr/bin/env node

/**
 * Bootstrap roles and permissions to Zitadel
 * Run with: npm run bootstrap:roles
 *
 * This is a temporary script that just shows what would be bootstrapped.
 * The actual implementation requires running in a browser context with Vite.
 */

console.log('========================================');
console.log('Zitadel Role Bootstrap');
console.log('========================================\n');

console.log('This script needs to be run in a browser context.');
console.log('To bootstrap roles:\n');
console.log('1. Start the development server: npm run dev');
console.log('2. Open the browser console');
console.log('3. Run the following commands:\n');

console.log(`
import { getBootstrapService } from '/src/services/bootstrap/zitadel-bootstrap.service';

const service = getBootstrapService({ isDryRun: true });
const result = await service.dryRun();
console.log('Bootstrap Result:', result);

// To run for real (not dry-run):
// const service = getBootstrapService({ isDryRun: false });
// const result = await service.bootstrap();
`);

console.log('\n========================================');
console.log('Roles to be bootstrapped:');
console.log('========================================\n');
console.log('- super_admin: Full platform control');
console.log('- partner_onboarder: Can create and manage providers');
console.log('- administrator: Full control within organization\n');

console.log('Next steps:');
console.log('1. Run the commands above in browser console');
console.log('2. Grant super_admin role to lars.tice@gmail.com in Zitadel');
console.log('3. Log out and log back in to apply new roles\n');