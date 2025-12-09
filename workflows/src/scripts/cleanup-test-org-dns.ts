// Direct Cloudflare API call to remove DNS record
// Uses PLATFORM_BASE_DOMAIN from env config (or defaults to firstovertheline.com)
import { validateWorkflowsEnv } from '../shared/config/env-schema';

async function main() {
  const env = validateWorkflowsEnv();
  const subdomain = 'test-provider-001';
  const baseDomain = env.PLATFORM_BASE_DOMAIN;
  const fullDomain = `${subdomain}.${baseDomain}`;

  console.log(`Removing DNS record for: ${fullDomain}`);

  const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;

  if (!CLOUDFLARE_API_TOKEN) {
    console.error('CLOUDFLARE_API_TOKEN environment variable is required');
    process.exit(1);
  }

  try {
    // Step 1: List zones to find the zone ID for the base domain
    console.log(`Fetching zones for domain: ${baseDomain}`);
    const zonesResponse = await fetch(
      `https://api.cloudflare.com/client/v4/zones?name=${baseDomain}`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const zonesData = await zonesResponse.json() as any;

    if (!zonesData.success) {
      console.error('Failed to list zones:', JSON.stringify(zonesData.errors, null, 2));
      process.exit(1);
    }

    if (zonesData.result.length === 0) {
      console.log(`No zone found for ${baseDomain}`);
      process.exit(1);
    }

    const zone = zonesData.result[0];
    console.log(`Found zone: ${zone.id} (${zone.name})`);

    // Step 2: List DNS records to find the one for test-provider-001
    console.log(`Fetching DNS records for: ${fullDomain}`);
    const listResponse = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${zone.id}/dns_records?name=${fullDomain}`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const listData = await listResponse.json() as any;

    if (!listData.success) {
      console.error('Failed to list DNS records:', JSON.stringify(listData.errors, null, 2));
      process.exit(1);
    }

    if (listData.result.length === 0) {
      console.log(`No DNS record found for ${fullDomain} - already clean`);
      process.exit(0);
    }

    // Step 3: Delete each matching DNS record
    for (const record of listData.result) {
      console.log(`Deleting DNS record: ${record.id} (${record.type} ${record.name})`);

      const deleteResponse = await fetch(
        `https://api.cloudflare.com/client/v4/zones/${zone.id}/dns_records/${record.id}`,
        {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}`,
            'Content-Type': 'application/json',
          },
        }
      );

      const deleteData = await deleteResponse.json() as any;

      if (deleteData.success) {
        console.log(`✅ Successfully deleted DNS record: ${record.id}`);
      } else {
        console.error(`❌ Failed to delete DNS record ${record.id}:`, JSON.stringify(deleteData.errors, null, 2));
      }
    }

    console.log('DNS cleanup complete');
    process.exit(0);
  } catch (error) {
    console.error('DNS cleanup failed:', error);
    process.exit(1);
  }
}

main();
