// @ts-nocheck - Uses dynamic table names not supported by typed client
/**
 * System Validation Script
 *
 * Validates the complete temporal workflows system is properly configured
 * and ready to run. Performs smoke tests without creating real resources.
 *
 * Usage:
 *   npm run validate
 *
 * Checks:
 * 1. Configuration validation
 * 2. Temporal connection
 * 3. Supabase connection
 * 4. Provider initialization
 * 5. Required database tables exist
 * 6. TypeScript compilation
 */

import { Connection } from '@temporalio/client';
import { validateConfiguration, getResolvedProviders } from '../shared/config';
import { getSupabaseClient } from '../shared/utils/supabase';
import { createDNSProvider } from '../shared/providers/dns/factory';
import { createEmailProvider } from '../shared/providers/email/factory';

interface ValidationResult {
  name: string;
  passed: boolean;
  message: string;
  error?: string;
}

const results: ValidationResult[] = [];

/**
 * Check 1: Configuration Validation
 */
async function checkConfiguration(): Promise<ValidationResult> {
  console.log('1️⃣  Validating configuration...');

  try {
    const result = validateConfiguration();

    if (result.valid) {
      const resolved = getResolvedProviders();
      return {
        name: 'Configuration',
        passed: true,
        message: `Valid configuration (Mode: ${resolved.workflowMode}, DNS: ${resolved.dnsProvider}, Email: ${resolved.emailProvider})`
      };
    } else {
      return {
        name: 'Configuration',
        passed: false,
        message: 'Invalid configuration',
        error: result.errors.join('; ')
      };
    }
  } catch (error) {
    return {
      name: 'Configuration',
      passed: false,
      message: 'Configuration validation failed',
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Check 2: Temporal Connection
 */
async function checkTemporalConnection(): Promise<ValidationResult> {
  console.log('2️⃣  Testing Temporal connection...');

  const address = process.env.TEMPORAL_ADDRESS || 'localhost:7233';

  try {
    const connection = await Connection.connect({
      address
    });

    await connection.close();

    return {
      name: 'Temporal Connection',
      passed: true,
      message: `Successfully connected to Temporal at ${address}`
    };
  } catch (error) {
    return {
      name: 'Temporal Connection',
      passed: false,
      message: `Failed to connect to Temporal at ${address}`,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Check 3: Supabase Connection
 */
async function checkSupabaseConnection(): Promise<ValidationResult> {
  console.log('3️⃣  Testing Supabase connection...');

  try {
    const supabase = getSupabaseClient();

    // Try a simple query to verify connection
    const { error } = await supabase
      .from('organizations_projection')
      .select('count')
      .limit(0);

    if (error) {
      return {
        name: 'Supabase Connection',
        passed: false,
        message: 'Failed to query Supabase',
        error: error.message
      };
    }

    return {
      name: 'Supabase Connection',
      passed: true,
      message: `Successfully connected to Supabase at ${process.env.SUPABASE_URL}`
    };
  } catch (error) {
    return {
      name: 'Supabase Connection',
      passed: false,
      message: 'Failed to connect to Supabase',
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Check 4: DNS Provider Initialization
 */
async function checkDNSProvider(): Promise<ValidationResult> {
  console.log('4️⃣  Testing DNS provider initialization...');

  try {
    // Test that provider can be created without errors
    void createDNSProvider();
    const resolved = getResolvedProviders();

    return {
      name: 'DNS Provider',
      passed: true,
      message: `Successfully initialized ${resolved.dnsProvider} DNS provider`
    };
  } catch (error) {
    return {
      name: 'DNS Provider',
      passed: false,
      message: 'Failed to initialize DNS provider',
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Check 5: Email Provider Initialization
 */
async function checkEmailProvider(): Promise<ValidationResult> {
  console.log('5️⃣  Testing email provider initialization...');

  try {
    // Test that provider can be created without errors
    void createEmailProvider();
    const resolved = getResolvedProviders();

    return {
      name: 'Email Provider',
      passed: true,
      message: `Successfully initialized ${resolved.emailProvider} email provider`
    };
  } catch (error) {
    return {
      name: 'Email Provider',
      passed: false,
      message: 'Failed to initialize email provider',
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Check 6: Required Database Tables
 */
async function checkDatabaseTables(): Promise<ValidationResult> {
  console.log('6️⃣  Verifying database tables...');

  const requiredTables = [
    'organizations_projection',
    'invitations_projection',
    'domain_events'
  ];

  try {
    const supabase = getSupabaseClient();
    const missingTables: string[] = [];

    for (const table of requiredTables) {
      const { error } = await supabase
        .from(table)
        .select('count')
        .limit(0);

      if (error) {
        missingTables.push(table);
      }
    }

    if (missingTables.length > 0) {
      return {
        name: 'Database Tables',
        passed: false,
        message: 'Missing required database tables',
        error: `Missing tables: ${missingTables.join(', ')}`
      };
    }

    return {
      name: 'Database Tables',
      passed: true,
      message: `All required tables exist (${requiredTables.length} tables verified)`
    };
  } catch (error) {
    return {
      name: 'Database Tables',
      passed: false,
      message: 'Failed to verify database tables',
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Check 7: TypeScript Compilation
 */
async function checkTypeScriptCompilation(): Promise<ValidationResult> {
  console.log('7️⃣  Checking TypeScript compilation...');

  try {
    // Check if dist directory exists and has compiled files
    const fs = await import('fs');
    const path = await import('path');

    const distPath = path.join(__dirname, '../../dist');

    if (!fs.existsSync(distPath)) {
      return {
        name: 'TypeScript Compilation',
        passed: false,
        message: 'dist/ directory not found',
        error: 'Run "npm run build" to compile TypeScript'
      };
    }

    const workerPath = path.join(distPath, 'worker/index.js');
    if (!fs.existsSync(workerPath)) {
      return {
        name: 'TypeScript Compilation',
        passed: false,
        message: 'Worker entry point not compiled',
        error: 'Run "npm run build" to compile TypeScript'
      };
    }

    return {
      name: 'TypeScript Compilation',
      passed: true,
      message: 'TypeScript compiled successfully'
    };
  } catch (error) {
    return {
      name: 'TypeScript Compilation',
      passed: false,
      message: 'Failed to check TypeScript compilation',
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Print results
 */
function printResults() {
  console.log('\n' + '='.repeat(60));
  console.log('Validation Results');
  console.log('='.repeat(60));
  console.log('');

  for (const result of results) {
    if (result.passed) {
      console.log(`✅ ${result.name}`);
      console.log(`   ${result.message}`);
    } else {
      console.log(`❌ ${result.name}`);
      console.log(`   ${result.message}`);
      if (result.error) {
        console.log(`   Error: ${result.error}`);
      }
    }
    console.log('');
  }

  const passedCount = results.filter(r => r.passed).length;
  const totalCount = results.length;

  console.log('='.repeat(60));
  console.log(`Summary: ${passedCount}/${totalCount} checks passed`);
  console.log('='.repeat(60));
  console.log('');

  if (passedCount === totalCount) {
    console.log('🎉 System validation passed! Ready to run workflows.\n');
  } else {
    console.log('❌ System validation failed. Please fix the errors above.\n');
  }
}

/**
 * Main function
 */
async function main() {
  console.log('='.repeat(60));
  console.log('🔍 System Validation');
  console.log('='.repeat(60));
  console.log('');

  // Load environment variables
  if (process.env.NODE_ENV !== 'production') {
    const dotenv = await import('dotenv');
    dotenv.config({ path: '.env.local' });
    dotenv.config();
  }

  // Run all checks
  results.push(await checkConfiguration());
  results.push(await checkTemporalConnection());
  results.push(await checkSupabaseConnection());
  results.push(await checkDNSProvider());
  results.push(await checkEmailProvider());
  results.push(await checkDatabaseTables());
  results.push(await checkTypeScriptCompilation());

  // Print results
  printResults();

  // Exit with appropriate code
  const allPassed = results.every(r => r.passed);
  process.exit(allPassed ? 0 : 1);
}

// Run if executed directly
if (require.main === module) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { main as validate };
