import { test } from '@playwright/test';

test('Check page structure', async ({ page }) => {
  await page.goto('http://localhost:3456');
  
  // Take screenshot
  await page.screenshot({ path: 'page-structure.png' });
  
  // Log all buttons
  const buttons = await page.locator('button').all();
  console.log(`Found ${buttons.length} buttons:`);
  
  for (const button of buttons) {
    const text = await button.textContent();
    const testId = await button.getAttribute('data-testid');
    console.log(`  - "${text?.trim()}" (testid: ${testId || 'none'})`);
  }
  
  // Look for any element that might open medication modal
  const possibleTriggers = await page.locator('[data-testid*="add"], [data-testid*="medication"], button:has-text("Add")').all();
  console.log(`\nFound ${possibleTriggers.length} possible triggers`);
});