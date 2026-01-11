#!/usr/bin/env node
/**
 * Add title to allOf extension objects that add new fields to EventMetadata
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

let changeCount = 0;

function addTitleToAllOfExtensions(obj, parentSchema = '') {
  if (!obj || typeof obj !== 'object') return;

  // Check if this is an allOf that extends EventMetadata with new fields
  if (obj.allOf && Array.isArray(obj.allOf) && obj.allOf.length === 2) {
    const refItem = obj.allOf.find(item =>
      item.$ref && item.$ref.includes('EventMetadata')
    );
    const extensionItem = obj.allOf.find(item => !item.$ref);

    if (refItem && extensionItem && (extensionItem.type === 'object' || extensionItem.properties)) {
      // Add title to the extension object if it doesn't have one
      if (!extensionItem.title && extensionItem.properties) {
        // Create title from parent schema name
        const baseName = parentSchema.replace(/Event$/, '');
        extensionItem.title = `${baseName}EventMetadata`;
        changeCount++;
        console.log(`  Added title "${extensionItem.title}" to allOf extension`);
      }
    }
  }

  // Recurse into nested objects
  for (const [key, value] of Object.entries(obj)) {
    if (Array.isArray(value)) {
      value.forEach((item) => addTitleToAllOfExtensions(item, parentSchema));
    } else if (value && typeof value === 'object') {
      // Track schema names
      let nextParent = parentSchema;
      if (value.title) {
        nextParent = value.title;
      } else if (obj.schemas && key !== 'properties') {
        nextParent = key;
      }
      addTitleToAllOfExtensions(value, nextParent);
    }
  }
}

function processFile(filePath) {
  console.log(`Processing: ${filePath}`);
  const content = fs.readFileSync(filePath, 'utf-8');
  const doc = yaml.load(content);

  const beforeCount = changeCount;
  addTitleToAllOfExtensions(doc);

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

console.log(`\nTotal titles added: ${changeCount}`);
console.log('Run npm run generate:types to verify.');
