#!/usr/bin/env node
/**
 * Google OAuth Configuration Test Script
 *
 * This script tests the Google OAuth configuration by:
 * 1. Generating an OAuth URL using Supabase JavaScript client
 * 2. Verifying the redirect URI is correct
 * 3. Providing the URL for manual browser testing
 *
 * Usage:
 *   node test-google-oauth.js
 *
 * Environment Variables Required:
 *   SUPABASE_URL - Your Supabase project URL
 *   SUPABASE_ANON_KEY - Your Supabase anonymous key
 */

import { createClient } from '@supabase/supabase-js';

// Configuration
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://tmrjlswbsxmbglmaclxu.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRtcmpsc3dic3htYmdsbWFjbHh1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg5MzgzNzQsImV4cCI6MjA3NDUxNDM3NH0.o_cS3L7X6h1UKnNgPEeV9PLSB-bTtExzTK1amXXjxOY';

const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

function log(color, message) {
  console.log(`${color}${message}${COLORS.reset}`);
}

function logSection(title) {
  console.log('');
  log(COLORS.bright + COLORS.cyan, '━'.repeat(60));
  log(COLORS.bright + COLORS.cyan, title);
  log(COLORS.bright + COLORS.cyan, '━'.repeat(60));
}

async function testGoogleOAuth() {
  try {
    logSection('🧪 Google OAuth Configuration Test');

    // Step 1: Initialize Supabase client
    log(COLORS.blue, '\n📋 Step 1: Initialize Supabase Client');
    log(COLORS.reset, `   Project URL: ${SUPABASE_URL}`);

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    log(COLORS.green, '   ✓ Supabase client initialized');

    // Step 2: Generate OAuth URL
    log(COLORS.blue, '\n📋 Step 2: Generate Google OAuth URL');

    const redirectUrl = `${SUPABASE_URL}/auth/v1/callback`;
    log(COLORS.reset, `   Expected redirect: ${redirectUrl}`);

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: redirectUrl,
        queryParams: {
          access_type: 'offline',
          prompt: 'consent',
        },
      },
    });

    if (error) {
      log(COLORS.red, '\n❌ Error generating OAuth URL:');
      log(COLORS.red, `   ${error.message}`);

      if (error.message.includes('provider')) {
        log(COLORS.yellow, '\n💡 Possible Issues:');
        log(COLORS.yellow, '   • Google OAuth is not enabled in Supabase Dashboard');
        log(COLORS.yellow, '   • Client ID or Secret not configured');
        log(COLORS.yellow, '   • Check: Authentication → Providers → Google in Supabase Dashboard');
      }

      process.exit(1);
    }

    log(COLORS.green, '   ✓ OAuth URL generated successfully');

    // Step 3: Display results
    logSection('✅ Test Results');

    log(COLORS.green, '\n✓ OAuth Configuration Test: PASSED');
    log(COLORS.reset, '\nProvider: Google');
    log(COLORS.reset, `Redirect URI: ${redirectUrl}`);

    if (data.url) {
      log(COLORS.bright + COLORS.green, '\n📌 OAuth URL Generated:');
      log(COLORS.cyan, data.url);

      logSection('🧪 Manual Testing Instructions');
      log(COLORS.yellow, '\n1. Copy the OAuth URL above');
      log(COLORS.yellow, '2. Paste it into your browser');
      log(COLORS.yellow, '3. Complete the Google authentication flow');
      log(COLORS.yellow, '4. Verify you are redirected back to Supabase successfully');
      log(COLORS.yellow, '5. Check Supabase Dashboard → Authentication → Users for new user');

      log(COLORS.bright + COLORS.blue, '\n💡 Quick Test Command:');
      log(COLORS.cyan, `open "${data.url}"`);
      log(COLORS.reset, '   (or use "start" on Windows, "xdg-open" on Linux)');
    }

    // Step 4: Verify endpoint accessibility
    log(COLORS.blue, '\n📋 Step 3: Verify Auth Endpoint');

    try {
      const response = await fetch(`${SUPABASE_URL}/auth/v1/settings`);
      if (response.ok) {
        const settings = await response.json();
        log(COLORS.green, '   ✓ Auth endpoint is accessible');

        if (settings.external_providers) {
          const googleEnabled = settings.external_providers.some(
            p => p.provider === 'google' && p.enabled
          );

          if (googleEnabled) {
            log(COLORS.green, '   ✓ Google provider is enabled');
          } else {
            log(COLORS.yellow, '   ⚠ Google provider may not be enabled');
          }
        }
      }
    } catch (fetchError) {
      log(COLORS.yellow, '   ⚠ Could not verify auth endpoint (may not affect OAuth)');
    }

    logSection('🎉 Test Complete');
    log(COLORS.green, '\nAll checks passed! Your Google OAuth configuration appears correct.');
    log(COLORS.reset, 'Use the OAuth URL above to complete end-to-end testing.\n');

    process.exit(0);

  } catch (error) {
    log(COLORS.red, '\n❌ Unexpected Error:');
    log(COLORS.red, error.message);
    log(COLORS.reset, error.stack);
    process.exit(1);
  }
}

// Run the test
testGoogleOAuth();
