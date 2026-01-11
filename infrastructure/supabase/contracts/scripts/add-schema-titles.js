/**
 * Script to add title properties to AsyncAPI schema definitions.
 *
 * Modelina uses the 'title' property to name generated interfaces.
 * Without it, schemas get names like AnonymousSchema_X.
 *
 * This script:
 * 1. Finds all schema definitions under components/schemas
 * 2. Adds title: SchemaName to each schema that doesn't have one
 */

const fs = require('fs');
const path = require('path');
const yaml = require('yaml');

function addTitlesToSchemas(doc) {
  let additions = 0;

  function processNode(node, parentKey = '') {
    if (!node || typeof node !== 'object') return;

    if (yaml.isMap(node)) {
      const items = node.items;

      for (let i = 0; i < items.length; i++) {
        const pair = items[i];
        const key = pair.key?.value;
        const value = pair.value;

        // Check if we're in a schemas section and this is a schema definition
        if (parentKey === 'schemas' && yaml.isMap(value)) {
          // Check if it has 'type' property (indicates it's a schema definition)
          const hasType = value.items?.some(p => p.key?.value === 'type');
          const hasRef = value.items?.some(p => p.key?.value === '$ref');
          const hasAllOf = value.items?.some(p => p.key?.value === 'allOf');
          const hasTitle = value.items?.some(p => p.key?.value === 'title');

          // Add title if this looks like a schema and doesn't have one
          if ((hasType || hasAllOf) && !hasRef && !hasTitle) {
            // Insert title as the first property
            const titlePair = doc.createPair('title', key);
            value.items.unshift(titlePair);
            console.log(`  Added title to: ${key}`);
            additions++;
          }
        }

        // Recurse into nested structures
        processNode(value, key);
      }
    } else if (yaml.isSeq(node)) {
      for (const item of node.items) {
        processNode(item, parentKey);
      }
    }
  }

  processNode(doc.contents);
  return additions;
}

function processFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const doc = yaml.parseDocument(content);

  const additions = addTitlesToSchemas(doc);

  if (additions > 0) {
    fs.writeFileSync(filePath, doc.toString());
    console.log(`  Added ${additions} titles\n`);
  } else {
    console.log(`  No schemas need titles\n`);
  }

  return additions;
}

// Main
const domainsDir = path.join(__dirname, '..', 'asyncapi', 'domains');
const componentsDir = path.join(__dirname, '..', 'asyncapi', 'components');

console.log('Adding title properties to AsyncAPI schemas...\n');

let totalAdditions = 0;

// Process domain files
const domainFiles = fs.readdirSync(domainsDir).filter(f => f.endsWith('.yaml'));
for (const file of domainFiles) {
  const filePath = path.join(domainsDir, file);
  console.log(`Processing ${file}:`);
  totalAdditions += processFile(filePath);
}

// Process component files
if (fs.existsSync(componentsDir)) {
  const componentFiles = fs.readdirSync(componentsDir).filter(f => f.endsWith('.yaml'));
  for (const file of componentFiles) {
    const filePath = path.join(componentsDir, file);
    console.log(`Processing components/${file}:`);
    totalAdditions += processFile(filePath);
  }
}

console.log(`Total titles added: ${totalAdditions}`);
