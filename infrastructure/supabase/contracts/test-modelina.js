const { TypeScriptGenerator } = require('@asyncapi/modelina');
const fs = require('fs');
const path = require('path');

async function main() {
  const asyncapiPath = path.join(__dirname, 'asyncapi-bundled.yaml');

  console.log('Using AsyncAPI file:', asyncapiPath);

  const generator = new TypeScriptGenerator({
    modelType: 'interface',
    enumType: 'enum',
  });

  const asyncapiContent = fs.readFileSync(asyncapiPath, 'utf8');

  try {
    const models = await generator.generate(asyncapiContent);

    console.log('\n=== Generated Models ===\n');
    console.log('Total models generated:', models.length, '\n');

    // Show first 5 models as sample
    for (let i = 0; i < Math.min(5, models.length); i++) {
      const model = models[i];
      console.log('--- Model ' + (i + 1) + ': ' + model.modelName + ' ---');
      console.log(model.result);
      console.log('\n');
    }

    // List all model names
    console.log('=== All Model Names ===');
    models.forEach(function(m) { console.log('  - ' + m.modelName); });

  } catch (error) {
    console.error('Error generating models:', error.message);
    console.error(error.stack);
  }
}

main();
