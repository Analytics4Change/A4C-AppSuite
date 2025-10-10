#!/usr/bin/env node

/**
 * Grant Console Access Script
 *
 * Uses service account to grant ORG_OWNER role to a user for Zitadel console access.
 *
 * Usage: node scripts/grant-console-access.js <user-email>
 */

const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

// Configuration
const ZITADEL_INSTANCE = 'https://analytics4change-zdswvg.us1.zitadel.cloud';
const ORG_ID = '339658157368404786';
const SERVICE_KEY_FILE = path.join(__dirname, '..', '339916934214621265.json');

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function error(message) {
  log(`❌ ${message}`, 'red');
}

function success(message) {
  log(`✅ ${message}`, 'green');
}

function info(message) {
  log(`ℹ️  ${message}`, 'blue');
}

/**
 * Load service account key from file
 */
function loadServiceAccountKey() {
  try {
    const keyData = JSON.parse(fs.readFileSync(SERVICE_KEY_FILE, 'utf8'));
    info('Service account key loaded successfully');
    return keyData;
  } catch (err) {
    error(`Failed to load service account key: ${err.message}`);
    process.exit(1);
  }
}

/**
 * Generate JWT for service account authentication
 */
function generateJWT(keyData) {
  const now = Math.floor(Date.now() / 1000);

  const payload = {
    iss: keyData.userId,
    sub: keyData.userId,
    aud: ZITADEL_INSTANCE,
    iat: now,
    exp: now + 3600, // 1 hour expiration
  };

  try {
    const token = jwt.sign(payload, keyData.key, {
      algorithm: 'RS256',
      keyid: keyData.keyId,
    });

    info('JWT generated successfully');
    return token;
  } catch (err) {
    error(`Failed to generate JWT: ${err.message}`);
    process.exit(1);
  }
}

/**
 * Exchange JWT for access token
 */
async function getAccessToken(jwtToken) {
  const tokenUrl = `${ZITADEL_INSTANCE}/oauth/v2/token`;

  const params = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: jwtToken,
    scope: 'openid profile email urn:zitadel:iam:org:project:id:zitadel:aud',
  });

  try {
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Token exchange failed (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    info('Access token obtained successfully');
    return data.access_token;
  } catch (err) {
    error(`Failed to get access token: ${err.message}`);
    process.exit(1);
  }
}

/**
 * Search for user by email
 */
async function findUserByEmail(accessToken, email) {
  const searchUrl = `${ZITADEL_INSTANCE}/management/v1/users/_search`;

  const requestBody = {
    query: {
      offset: '0',
      limit: 10,
      asc: true,
    },
    queries: [
      {
        emailQuery: {
          emailAddress: email,
          method: 'TEXT_QUERY_METHOD_EQUALS',
        },
      },
    ],
  };

  try {
    const response = await fetch(searchUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`User search failed (${response.status}): ${errorText}`);
    }

    const data = await response.json();

    if (!data.result || data.result.length === 0) {
      throw new Error(`User not found: ${email}`);
    }

    const user = data.result[0];
    info(`User found: ${user.userName} (ID: ${user.id})`);
    return user;
  } catch (err) {
    error(`Failed to find user: ${err.message}`);
    process.exit(1);
  }
}

/**
 * Grant ORG_OWNER role to user
 */
async function grantOrgOwnerRole(accessToken, userId, userEmail) {
  // Use the Management API endpoint for adding org members
  // This operates in the context of the service account's current org
  const memberUrl = `${ZITADEL_INSTANCE}/management/v1/orgs/me/members`;

  const requestBody = {
    userId: userId,
    roles: ['ORG_OWNER'],
  };

  try {
    info(`Attempting to add member to organization...`);
    const response = await fetch(memberUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'x-zitadel-orgid': ORG_ID, // Set org context via header
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();

      // Check if user is already a member
      if (response.status === 409 || errorText.includes('already exists')) {
        info('User is already an organization member, updating roles...');
        return await updateOrgMemberRoles(accessToken, userId, userEmail);
      }

      throw new Error(`Failed to grant role (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    success(`ORG_OWNER role granted to ${userEmail}`);
    return data;
  } catch (err) {
    error(`Failed to grant ORG_OWNER role: ${err.message}`);
    process.exit(1);
  }
}

/**
 * Update existing member roles
 */
async function updateOrgMemberRoles(accessToken, userId, userEmail) {
  const memberUrl = `${ZITADEL_INSTANCE}/management/v1/orgs/me/members/${userId}`;

  const requestBody = {
    roles: ['ORG_OWNER'],
  };

  try {
    info(`Updating roles for existing member...`);
    const response = await fetch(memberUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'x-zitadel-orgid': ORG_ID, // Set org context via header
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to update roles (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    success(`ORG_OWNER role updated for ${userEmail}`);
    return data;
  } catch (err) {
    error(`Failed to update member roles: ${err.message}`);
    process.exit(1);
  }
}

/**
 * Main execution
 */
async function main() {
  const userEmail = process.argv[2];

  if (!userEmail) {
    error('Usage: node scripts/grant-console-access.js <user-email>');
    process.exit(1);
  }

  log('\n🔐 Starting console access grant process...', 'blue');
  log('─'.repeat(60), 'blue');

  info(`Target user: ${userEmail}`);
  info(`Organization ID: ${ORG_ID}`);
  info(`Zitadel instance: ${ZITADEL_INSTANCE}`);
  log('─'.repeat(60), 'blue');

  // Step 1: Load service account key
  const keyData = loadServiceAccountKey();

  // Step 2: Generate JWT
  const jwtToken = generateJWT(keyData);

  // Step 3: Get access token
  const accessToken = await getAccessToken(jwtToken);

  // Step 4: Find user by email
  const user = await findUserByEmail(accessToken, userEmail);

  // Step 5: Grant ORG_OWNER role
  await grantOrgOwnerRole(accessToken, user.id, userEmail);

  log('─'.repeat(60), 'green');
  success('Console access granted successfully!\n');
  info('Next steps:');
  info('1. Clear browser cookies and cache');
  info('2. Navigate to: https://analytics4change-zdswvg.us1.zitadel.cloud');
  info('3. Log in with your credentials');
  info('4. You should now have access to the management console\n');
}

// Run the script
main().catch((err) => {
  error(`Unexpected error: ${err.message}`);
  console.error(err);
  process.exit(1);
});
