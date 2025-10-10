import { test } from '@playwright/test';

test('Check when dosage fields register behaviors', async ({ page }) => {
  console.log('\n=== Checking Dosage Fields Behavior Registration ===\n');
  
  // Log all console messages
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('FocusBehavior') || text.includes('enter-as-tab') || text.includes('tab-as-arrows')) {
      console.log(`[${msg.type()}]:`, text);
    }
  });
  
  // Navigate
  await page.goto('http://localhost:3456');
  await page.waitForLoadState('networkidle');
  
  // Select client
  await page.locator('text="John Smith"').click();
  await page.waitForTimeout(500);
  
  // Click Add Medication
  await page.locator('button:has-text("Add Medication")').click();
  await page.waitForTimeout(300);
  
  // Select Prescribed Medication
  await page.locator('text="Prescribed Medication"').click();
  await page.waitForSelector('#medication-search');
  
  console.log('✓ Medication modal opened (BEFORE selecting medication)');
  console.log('At this point, dosage fields should NOT be rendered yet');
  
  // Type in search
  const searchInput = page.locator('input#medication-search');
  await searchInput.click();
  await searchInput.fill('lo');
  await page.waitForTimeout(1000);
  
  console.log('Typed "lo" - checking for conflicts...');
  
  // Select a medication
  const firstResult = page.locator('#medication-dropdown [role="option"]').first();
  if (await firstResult.count() > 0) {
    await firstResult.click();
    console.log('✓ Selected medication');
    
    // Now click Continue to show dosage fields
    const continueButton = page.locator('#medication-continue-button');
    if (await continueButton.count() > 0) {
      console.log('\nClicking Continue - this should render dosage fields...');
      await continueButton.click();
      await page.waitForTimeout(500);
      
      console.log('Dosage fields should now be rendered and registering enter-as-tab');
      
      // Check if dosage fields are visible
      const dosageCategoryVisible = await page.locator('#dosage-category').isVisible();
      console.log(`Dosage category field visible: ${dosageCategoryVisible}`);
    }
  }
});