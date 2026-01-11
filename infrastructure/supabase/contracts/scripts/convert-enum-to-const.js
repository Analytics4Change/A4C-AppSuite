/**
 * Script to convert single-value enums to JSON Schema const
 *
 * Transforms:
 *   enum: [single_value]
 * To:
 *   const: single_value
 *
 * This eliminates anonymous single-value enums in Modelina output,
 * replacing them with proper literal types.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('yaml');

function processSingleValueEnums(doc) {
  let conversions = 0;

  function processNode(node) {
    if (!node || typeof node !== 'object') return;

    if (yaml.isMap(node)) {
      const items = node.items;

      for (let i = 0; i < items.length; i++) {
        const pair = items[i];
        const key = pair.key?.value;
        const value = pair.value;

        // Check if this is a property with an enum
        if (yaml.isMap(value)) {
          const enumItem = value.items?.find(p => p.key?.value === 'enum');
          const typeItem = value.items?.find(p => p.key?.value === 'type');

          if (enumItem && yaml.isSeq(enumItem.value)) {
            const enumValues = enumItem.value.items;

            // Only convert single-value enums
            if (enumValues.length === 1) {
              const singleValue = yaml.isScalar(enumValues[0])
                ? enumValues[0].value
                : String(enumValues[0]);

              console.log(`  Converting ${key}: enum: [${singleValue}] → const: ${singleValue}`);

              // Remove enum, add const
              value.items = value.items.filter(p => p.key?.value !== 'enum');
              value.items.push(doc.createPair('const', singleValue));

              conversions++;
            }
          }
        }

        // Recurse into nested structures
        processNode(value);
      }
    } else if (yaml.isSeq(node)) {
      for (const item of node.items) {
        processNode(item);
      }
    }
  }

  processNode(doc.contents);
  return conversions;
}

function processFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const doc = yaml.parseDocument(content);

  const conversions = processSingleValueEnums(doc);

  if (conversions > 0) {
    fs.writeFileSync(filePath, doc.toString());
    console.log(`  Made ${conversions} conversions\n`);
  } else {
    console.log(`  No single-value enums found\n`);
  }

  return conversions;
}

// Main
const domainsDir = path.join(__dirname, '..', 'asyncapi', 'domains');

console.log('Converting single-value enums to const...\n');

let totalConversions = 0;

const files = fs.readdirSync(domainsDir).filter(f => f.endsWith('.yaml'));
for (const file of files) {
  const filePath = path.join(domainsDir, file);
  console.log(`Processing ${file}:`);
  totalConversions += processFile(filePath);
}

console.log(`Total conversions: ${totalConversions}`);
