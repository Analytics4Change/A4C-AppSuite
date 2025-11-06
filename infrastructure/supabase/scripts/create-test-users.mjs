#!/usr/bin/env node

/**
 * Create test users in Supabase Auth
 * Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TEST_USER_PASSWORD
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Validate environment variables
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TEST_USER_PASSWORD = process.env.TEST_USER_PASSWORD;

if (!SUPABASE_URL) {
  console.error('❌ Error: SUPABASE_URL is not set');
  process.exit(1);
}

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Error: SUPABASE_SERVICE_ROLE_KEY is not set');
  process.exit(1);
}

if (!TEST_USER_PASSWORD) {
  console.error('❌ Error: TEST_USER_PASSWORD is not set');
  process.exit(1);
}

console.log('🔧 Creating test users...');
console.log(`📡 Connecting to: ${SUPABASE_URL}`);

// Create Supabase admin client
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

// Load test users configuration
const configPath = join(__dirname, '../config/test-users.json');
const config = JSON.parse(readFileSync(configPath, 'utf8'));

let created = 0;
let skipped = 0;
let errors = 0;

for (const userConfig of config.users) {
  const { email, role, name } = userConfig;

  try {
    // Check if user already exists
    const { data: existingUsers, error: listError } = await supabase.auth.admin.listUsers();

    if (listError) {
      console.error(`❌ Error checking for user ${email}:`, listError.message);
      errors++;
      continue;
    }

    const existingUser = existingUsers.users.find(u => u.email === email);

    if (existingUser) {
      console.log(`⏭️  Skipping: ${email} (already exists)`);
      skipped++;
      continue;
    }

    // Create user
    console.log(`▶️  Creating: ${email} (${role})`);

    const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
      email: email,
      password: TEST_USER_PASSWORD,
      email_confirm: true, // Skip email verification
      user_metadata: {
        role: role,
        name: name
      }
    });

    if (createError) {
      console.error(`❌ Failed to create ${email}:`, createError.message);
      errors++;
      continue;
    }

    console.log(`✅ Created: ${email} (ID: ${newUser.user.id})`);
    created++;

  } catch (error) {
    console.error(`❌ Unexpected error for ${email}:`, error.message);
    errors++;
  }
}

console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('📊 Test User Creation Summary');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`Created:  ${created}`);
console.log(`Skipped:  ${skipped}`);
console.log(`Errors:   ${errors}`);
console.log('');

if (errors > 0) {
  console.log('❌ Some users failed to create');
  process.exit(1);
} else {
  console.log('✅ All test users ready!');
  process.exit(0);
}
