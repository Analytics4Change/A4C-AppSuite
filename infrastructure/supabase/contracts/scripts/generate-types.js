/**
 * AsyncAPI to TypeScript Type Generator
 *
 * Uses Modelina to generate TypeScript interfaces and enums from AsyncAPI spec.
 * The generated types are committed to git (not gitignored) to enable:
 * 1. CI validation that types are in sync with spec
 * 2. Zero build-time dependencies for consumers
 *
 * Usage: npm run generate:types
 */

const { TypeScriptGenerator } = require('@asyncapi/modelina');
const { Parser } = require('@asyncapi/parser');
const fs = require('fs');
const path = require('path');

const HEADER = `/**
 * AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
 *
 * Generated from AsyncAPI specification by Modelina
 * Source: infrastructure/supabase/contracts/asyncapi/
 * Generated: ${new Date().toISOString()}
 *
 * To regenerate: cd infrastructure/supabase/contracts && npm run generate:types
 *
 * IMPORTANT: These types are the source of truth for domain events.
 * If you need to change event structure, modify the AsyncAPI spec and regenerate.
 */

/* eslint-disable */
/* tslint:disable */

`;

// Base types that Modelina doesn't extract from components/schemas
// These are derived from asyncapi/components/schemas.yaml
const BASE_TYPES = `// =============================================================================
// Base Types (from components/schemas.yaml)
// =============================================================================

/**
 * Stream types for domain events.
 * Represents the different aggregates in the system.
 */
export type StreamType =
  | 'user'
  | 'organization'
  | 'organization_unit'
  | 'invitation'
  | 'program'
  | 'platform_admin'
  | 'impersonation'
  | 'role'
  | 'permission'
  | 'contact'
  | 'address'
  | 'phone'
  | 'access_grant'
  | 'medication';  // TODO: Add to AsyncAPI spec when medication domain is implemented

/**
 * Generic domain event structure for querying and displaying events.
 * For type-safe handling of specific events, use the specific event interfaces.
 */
export interface DomainEvent<TData = Record<string, unknown>> {
  'id': string;
  'stream_id': string;
  'stream_type': StreamType;
  'stream_version': number;
  'event_type': string;
  'event_data': TData;
  'event_metadata': EventMetadata;
  'created_at': string;
  'processed_at'?: string | null;
  'processing_error'?: string | null;
}

`;

async function generate() {
  const bundledPath = path.join(__dirname, '..', 'asyncapi-bundled.yaml');

  // Check if bundled file exists
  if (!fs.existsSync(bundledPath)) {
    console.error('ERROR: asyncapi-bundled.yaml not found');
    console.error('Run "npm run bundle" first to create the bundled specification');
    process.exit(1);
  }

  // Read the raw YAML content
  const asyncapiContent = fs.readFileSync(bundledPath, 'utf8');

  // Validate the AsyncAPI document first
  console.log('Validating AsyncAPI specification...');
  const parser = new Parser();
  const { document, diagnostics } = await parser.parse(asyncapiContent);

  // Check for parsing errors
  if (diagnostics && diagnostics.length > 0) {
    const errors = diagnostics.filter((d) => d.severity === 0);
    if (errors.length > 0) {
      console.error('AsyncAPI parsing errors:');
      errors.forEach((e) => console.error(`  - ${e.message}`));
      process.exit(1);
    }
  }

  if (!document) {
    console.error('ERROR: Failed to parse AsyncAPI document');
    process.exit(1);
  }

  console.log('Generating TypeScript types...');
  const generator = new TypeScriptGenerator({
    modelType: 'interface',
    enumType: 'enum',
    // Preserve snake_case property names (don't convert to camelCase)
    rawPropertyNames: true,
  });

  // Pass raw YAML content to Modelina (passing parsed document loses property info)
  const models = await generator.generate(asyncapiContent);

  // Build output
  let output = HEADER;

  // Add base types first (StreamType, DomainEvent)
  output += BASE_TYPES;

  // Group by type (enums first, then interfaces)
  // Add 'export' keyword to make them importable
  const enums = [];
  const interfaces = [];

  for (const model of models) {
    let result = model.result;
    // Add export keyword if not present
    if (!result.startsWith('export ')) {
      result = 'export ' + result;
    }
    if (result.includes('enum ')) {
      enums.push(result);
    } else {
      interfaces.push(result);
    }
  }

  // Add enums first (they may be referenced by interfaces)
  if (enums.length > 0) {
    output += '// =============================================================================\n';
    output += '// Enums\n';
    output += '// =============================================================================\n\n';
    output += enums.join('\n\n') + '\n\n';
  }

  // Add interfaces
  if (interfaces.length > 0) {
    output += '// =============================================================================\n';
    output += '// Interfaces\n';
    output += '// =============================================================================\n\n';
    output += interfaces.join('\n\n') + '\n';
  }

  // Write output
  const outputPath = path.join(__dirname, '..', 'types', 'generated-events.ts');
  fs.writeFileSync(outputPath, output);

  console.log(`\n✓ Generated ${enums.length} enums and ${interfaces.length} interfaces`);
  console.log(`✓ Output: types/generated-events.ts`);

  // Warn if any anonymous schemas were generated
  if (output.includes('AnonymousSchema')) {
    console.warn('\n⚠️  WARNING: Anonymous schemas detected!');
    console.warn('   This usually means some schemas are missing the "title" property.');
    console.warn('   Add "title: SchemaName" to each schema in the AsyncAPI spec.');
  }
}

generate().catch((err) => {
  console.error('Generation failed:', err.message);
  process.exit(1);
});
