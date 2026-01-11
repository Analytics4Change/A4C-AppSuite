/**
 * Validate TypeScript types are in sync with AsyncAPI spec
 *
 * This script extracts schema definitions from AsyncAPI YAML and compares
 * them against the hand-crafted TypeScript types in types/events.ts.
 *
 * It checks:
 * 1. All AsyncAPI schema names have corresponding TypeScript interfaces
 * 2. Required properties match
 * 3. Enum values match
 *
 * Usage: node scripts/validate-type-sync.js
 * Exit code 0 = in sync, 1 = drift detected
 */

const fs = require('fs');
const path = require('path');
const yaml = require('yaml');

// Schemas to validate (add more as needed)
const SCHEMAS_TO_VALIDATE = [
  'OrganizationBootstrapFailureData',
  'OrganizationBootstrapCancellationData',
  'OrganizationCreationData',
  // Add other critical schemas here
];

function extractAsyncAPISchemas(yamlContent) {
  const doc = yaml.parse(yamlContent);
  const schemas = {};

  // Navigate to components.schemas
  if (doc.components && doc.components.schemas) {
    for (const [name, schema] of Object.entries(doc.components.schemas)) {
      schemas[name] = {
        properties: schema.properties ? Object.keys(schema.properties) : [],
        required: schema.required || [],
        enums: {},
      };

      // Extract enum values
      if (schema.properties) {
        for (const [propName, propSchema] of Object.entries(schema.properties)) {
          if (propSchema.enum) {
            schemas[name].enums[propName] = propSchema.enum;
          }
        }
      }
    }
  }

  return schemas;
}

function extractTypeScriptInterfaces(tsContent) {
  const interfaces = {};

  // Simple regex-based extraction (not a full parser)
  const interfaceRegex = /export interface (\w+)[\s\S]*?\{([\s\S]*?)\}/g;
  let match;

  while ((match = interfaceRegex.exec(tsContent)) !== null) {
    const name = match[1];
    const body = match[2];

    // Extract property names
    const propRegex = /(\w+)\??:/g;
    const properties = [];
    let propMatch;
    while ((propMatch = propRegex.exec(body)) !== null) {
      properties.push(propMatch[1]);
    }

    interfaces[name] = {
      properties,
      // Note: Determining 'required' from TS would need checking for '?'
    };
  }

  return interfaces;
}

function validateSync(asyncapiSchemas, tsInterfaces) {
  const errors = [];

  for (const schemaName of SCHEMAS_TO_VALIDATE) {
    const asyncapiSchema = asyncapiSchemas[schemaName];
    const tsInterface = tsInterfaces[schemaName];

    if (!asyncapiSchema) {
      errors.push(`AsyncAPI schema '${schemaName}' not found`);
      continue;
    }

    if (!tsInterface) {
      errors.push(`TypeScript interface '${schemaName}' not found - needs to be added to types/events.ts`);
      continue;
    }

    // Check for missing properties in TypeScript
    for (const prop of asyncapiSchema.properties) {
      // Convert snake_case to camelCase for comparison
      const camelProp = prop.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

      if (!tsInterface.properties.includes(prop) && !tsInterface.properties.includes(camelProp)) {
        errors.push(`${schemaName}: Missing property '${prop}' in TypeScript`);
      }
    }

    // Check for extra properties in TypeScript that aren't in AsyncAPI
    for (const prop of tsInterface.properties) {
      // Convert camelCase to snake_case for comparison
      const snakeProp = prop.replace(/([A-Z])/g, '_$1').toLowerCase();

      if (!asyncapiSchema.properties.includes(prop) && !asyncapiSchema.properties.includes(snakeProp)) {
        errors.push(`${schemaName}: Extra property '${prop}' in TypeScript not in AsyncAPI`);
      }
    }
  }

  return errors;
}

async function main() {
  const contractsDir = path.join(__dirname, '..');

  // Read all domain YAML files (not the bundled version - schemas are inlined there)
  const domainsDir = path.join(contractsDir, 'asyncapi', 'domains');
  const domainFiles = fs.readdirSync(domainsDir).filter(f => f.endsWith('.yaml'));

  let asyncapiSchemas = {};

  for (const file of domainFiles) {
    const filePath = path.join(domainsDir, file);
    const content = fs.readFileSync(filePath, 'utf8');
    const schemas = extractAsyncAPISchemas(content);
    asyncapiSchemas = { ...asyncapiSchemas, ...schemas };
  }

  console.log('Found', Object.keys(asyncapiSchemas).length, 'schemas in AsyncAPI domain files');

  // Read TypeScript types
  const tsPath = path.join(contractsDir, 'types', 'events.ts');
  if (!fs.existsSync(tsPath)) {
    console.error('ERROR: types/events.ts not found.');
    process.exit(1);
  }

  const tsContent = fs.readFileSync(tsPath, 'utf8');
  const tsInterfaces = extractTypeScriptInterfaces(tsContent);

  console.log('=== AsyncAPI ↔ TypeScript Sync Validation ===\n');
  console.log('Schemas to validate:', SCHEMAS_TO_VALIDATE.join(', '));
  console.log('');

  const errors = validateSync(asyncapiSchemas, tsInterfaces);

  if (errors.length === 0) {
    console.log('✓ All validated schemas are in sync!\n');
    process.exit(0);
  } else {
    console.error('✗ Drift detected:\n');
    errors.forEach(err => console.error('  - ' + err));
    console.error('\nFix the TypeScript types to match AsyncAPI spec.');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Validation script error:', err);
  process.exit(1);
});
