#!/usr/bin/env node
/**
 * Add title property to ALL nested type:object definitions
 * This eliminates anonymous schemas in Modelina TypeScript generation
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

// Helper to convert snake_case or kebab-case to PascalCase
function toPascalCase(str) {
  return str
    .split(/[-_]/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('');
}

// Track if any changes were made
let anyChanges = false;

// Recursively process all object schemas and add title where missing
function processSchema(schema, path, parentName = '') {
  if (!schema || typeof schema !== 'object') return;

  // Skip $ref schemas - they already have titles in the referenced schema
  if (schema.$ref) return;

  // If this is a type: object without title, add one
  if (schema.type === 'object' && !schema.title) {
    // Determine title from context
    const contextName = path[path.length - 1];
    let title;

    // Special cases for common nested objects
    if (contextName === 'event_data') {
      title = parentName ? `${parentName}Data` : 'EventData';
    } else if (contextName === 'event_metadata') {
      // Skip - this uses $ref
    } else if (contextName === 'filters') {
      title = parentName ? `${parentName}Filters` : 'Filters';
    } else if (contextName === 'metadata') {
      title = parentName ? `${parentName}Metadata` : 'Metadata';
    } else if (contextName === 'target') {
      title = parentName ? `${parentName}Target` : 'Target';
    } else if (contextName === 'impersonator') {
      title = parentName ? `${parentName}Impersonator` : 'Impersonator';
    } else if (contextName === 'original_user') {
      title = parentName ? `${parentName}OriginalUser` : 'OriginalUser';
    } else if (contextName === 'context') {
      title = parentName ? `${parentName}Context` : 'Context';
    } else if (contextName === 'access_info') {
      title = parentName ? `${parentName}AccessInfo` : 'AccessInfo';
    } else if (contextName === 'changes') {
      title = parentName ? `${parentName}Changes` : 'Changes';
    } else if (contextName === 'old_value') {
      title = parentName ? `${parentName}OldValue` : 'OldValue';
    } else if (contextName === 'new_value') {
      title = parentName ? `${parentName}NewValue` : 'NewValue';
    } else if (contextName === 'actor') {
      title = parentName ? `${parentName}Actor` : 'Actor';
    } else if (contextName === 'actor_info') {
      title = parentName ? `${parentName}ActorInfo` : 'ActorInfo';
    } else if (contextName === 'provider_info') {
      title = parentName ? `${parentName}ProviderInfo` : 'ProviderInfo';
    } else if (contextName === 'active_ingredient') {
      title = 'ActiveIngredient';
    } else if (contextName === 'address') {
      title = parentName ? `${parentName}Address` : 'Address';
    } else if (contextName === 'contact') {
      title = parentName ? `${parentName}Contact` : 'Contact';
    } else if (contextName === 'phone') {
      title = parentName ? `${parentName}Phone` : 'Phone';
    } else if (contextName === 'result') {
      title = parentName ? `${parentName}Result` : 'Result';
    } else if (contextName === 'details') {
      title = parentName ? `${parentName}Details` : 'Details';
    } else if (contextName === 'claim') {
      title = 'Claim';
    } else if (contextName === 'items') {
      // Array items - use parent context
      title = parentName ? `${parentName}Item` : 'Item';
    } else if (contextName) {
      // Generic: use context name as title
      title = toPascalCase(contextName);
    }

    if (title) {
      schema.title = title;
      anyChanges = true;
    }
  }

  // Update parent name for nested processing
  let newParentName = parentName;
  if (schema.title) {
    // Use the existing or just-added title as parent context
    newParentName = schema.title.replace(/Event$/, '').replace(/Data$/, '');
  }

  // Process properties
  if (schema.properties) {
    for (const [propName, propSchema] of Object.entries(schema.properties)) {
      processSchema(propSchema, [...path, propName], newParentName);
    }
  }

  // Process array items
  if (schema.items) {
    processSchema(schema.items, [...path, 'items'], newParentName);
  }

  // Process additionalProperties if it's an object schema
  if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
    processSchema(schema.additionalProperties, [...path, 'additionalProperties'], newParentName);
  }

  // Process allOf, anyOf, oneOf
  for (const combiner of ['allOf', 'anyOf', 'oneOf']) {
    if (Array.isArray(schema[combiner])) {
      schema[combiner].forEach((item, idx) => {
        processSchema(item, [...path, `${combiner}[${idx}]`], newParentName);
      });
    }
  }
}

function processFile(filePath) {
  console.log(`Processing: ${filePath}`);

  const content = fs.readFileSync(filePath, 'utf-8');
  const doc = yaml.load(content);

  if (!doc || !doc.components) {
    console.log(`  Skipping - no components`);
    return;
  }

  // Reset change tracker for this file
  anyChanges = false;

  // Process schemas
  if (doc.components.schemas) {
    for (const [schemaName, schema] of Object.entries(doc.components.schemas)) {
      processSchema(schema, [schemaName], schemaName.replace(/Event$/, ''));
    }
  }

  if (anyChanges) {
    // Custom YAML dump that preserves formatting better
    const output = yaml.dump(doc, {
      indent: 2,
      lineWidth: -1, // Don't wrap lines
      noRefs: true,
      quotingType: '"',
      forceQuotes: false,
      sortKeys: false,
      noCompatMode: true,
    });

    fs.writeFileSync(filePath, output);
    console.log(`  Updated: ${filePath}`);
  } else {
    console.log(`  No changes needed`);
  }
}

// Process all domain files
const domainsDir = path.join(__dirname, '..', 'asyncapi', 'domains');
const componentsDir = path.join(__dirname, '..', 'asyncapi', 'components');

const files = [
  ...fs.readdirSync(domainsDir).filter(f => f.endsWith('.yaml')).map(f => path.join(domainsDir, f)),
  path.join(componentsDir, 'schemas.yaml'),
];

files.forEach(processFile);

console.log('\nDone! Run npm run generate:types to verify.');
