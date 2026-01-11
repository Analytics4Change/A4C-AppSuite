#!/usr/bin/env node
/**
 * Simplify allOf patterns that reference EventMetadata
 * Replace allOf with simple $ref when the allOf only adds examples/descriptions
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

let changeCount = 0;

function simplifyAllOf(obj, key = '') {
  if (!obj || typeof obj !== 'object') return;

  // Check if this is an allOf that can be simplified
  if (obj.allOf && Array.isArray(obj.allOf) && obj.allOf.length === 2) {
    const hasEventMetadataRef = obj.allOf.some(item =>
      item.$ref && item.$ref.includes('EventMetadata')
    );

    if (hasEventMetadataRef) {
      // Check if the other item only has examples/required (no new fields)
      const otherItem = obj.allOf.find(item => !item.$ref);
      if (otherItem && (otherItem.type === 'object' || otherItem.properties)) {
        // Check if it only has examples/descriptions in properties (no new field definitions)
        let onlyExamplesOrDescriptions = true;
        if (otherItem.properties) {
          for (const [propName, propSchema] of Object.entries(otherItem.properties)) {
            // If property has type definition (new field), keep the allOf
            const keys = Object.keys(propSchema);
            if (keys.some(k => k === 'type' || k === 'format' || k === '$ref')) {
              onlyExamplesOrDescriptions = false;
              console.log(`  Keeping allOf at ${key}: property "${propName}" adds new field definition`);
              break;
            }
          }
        }

        if (onlyExamplesOrDescriptions) {
          // Simplify: replace allOf with just $ref
          const refItem = obj.allOf.find(item => item.$ref);
          delete obj.allOf;
          obj.$ref = refItem.$ref;
          delete obj.title; // Remove any title added to the allOf wrapper
          changeCount++;
          console.log(`  Simplified allOf at: ${key}`);
        }
      }
    }
  }

  // Recurse into nested objects and arrays
  for (const [k, v] of Object.entries(obj)) {
    if (Array.isArray(v)) {
      v.forEach((item, idx) => simplifyAllOf(item, `${key}.${k}[${idx}]`));
    } else if (v && typeof v === 'object') {
      simplifyAllOf(v, `${key}.${k}`);
    }
  }
}

function processFile(filePath) {
  console.log(`Processing: ${filePath}`);
  const content = fs.readFileSync(filePath, 'utf-8');
  const doc = yaml.load(content);

  const beforeCount = changeCount;
  simplifyAllOf(doc, path.basename(filePath));

  if (changeCount > beforeCount) {
    const output = yaml.dump(doc, {
      indent: 2,
      lineWidth: -1,
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

// Process domain files
const domainsDir = path.join(__dirname, '..', 'asyncapi', 'domains');
const files = fs.readdirSync(domainsDir)
  .filter(f => f.endsWith('.yaml'))
  .map(f => path.join(domainsDir, f));

files.forEach(processFile);

console.log(`\nTotal simplified: ${changeCount} allOf patterns`);
console.log('Run npm run generate:types to verify.');
