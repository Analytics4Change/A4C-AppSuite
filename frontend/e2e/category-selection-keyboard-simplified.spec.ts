import { test, expect, Page } from '@playwright/test';

// Helper to capture console logs
async function setupConsoleCapture(page: Page) {
  const consoleLogs: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'log') {
      consoleLogs.push(msg.text());
    }
  });
  return consoleLogs;
}

test.describe('Category Selection Keyboard Navigation', () => {
  test('Therapeutic Classes and Regimen Categories - Keyboard Test', async ({ page }) => {
    const consoleLogs = await setupConsoleCapture(page);
    
    console.log('\n=== CATEGORY SELECTION KEYBOARD NAVIGATION TEST ===\n');
    
    // Navigate to the application
    await page.goto('http://localhost:3456');
    await page.waitForTimeout(1000);
    
    // Select a client
    console.log('1. Selecting client...');
    await page.locator('text="John Smith"').click();
    await page.waitForTimeout(500);
    
    // Open Add Medication modal
    console.log('2. Opening Add Medication modal...');
    const addMedicationButton = page.locator('#add-medication-button');
    await addMedicationButton.waitFor({ state: 'visible', timeout: 5000 });
    await addMedicationButton.click();
    await page.waitForTimeout(500);
    
    // Select Prescribed Medication
    console.log('3. Selecting Prescribed Medication...');
    await page.locator('text="Prescribed Medication"').click();
    await page.waitForTimeout(500);
    
    // Search and select a medication
    console.log('4. Selecting a medication...');
    const medicationSearch = page.locator('input#medication-search');
    await medicationSearch.waitFor({ state: 'visible', timeout: 5000 });
    await medicationSearch.fill('ibuprofen');
    await page.waitForTimeout(1500);
    
    // Click the first medication result
    const firstMedication = page.locator('#medication-dropdown >> div[role="option"]').first();
    await firstMedication.waitFor({ state: 'visible', timeout: 5000 });
    await firstMedication.click();
    await page.waitForTimeout(500);
    
    // Click Continue
    console.log('5. Clicking Continue...');
    const continueButton = page.locator('#medication-continue-button');
    await continueButton.waitFor({ state: 'visible', timeout: 5000 });
    await continueButton.click();
    await page.waitForTimeout(1000);
    
    // Now we should be at the dosage form
    // Fill in the minimum required fields to get to categories
    console.log('6. Filling dosage form...');
    
    // Try different selectors for the dosage fields
    const categoryInput = page.locator('#dosage-category, [data-testid="dosage-category"], input[aria-label*="category" i]').first();
    await categoryInput.waitFor({ state: 'visible', timeout: 5000 });
    await categoryInput.click();
    await categoryInput.fill('Solid');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(500);
    
    // Form type
    const formTypeInput = page.locator('#form-type, [data-testid="form-type"], input[aria-label*="type" i]').first();
    await formTypeInput.click();
    await formTypeInput.fill('Tablet');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(500);
    
    // Amount
    const amountInput = page.locator('#dosage-amount, input[aria-label*="amount" i]').first();
    await amountInput.click();
    await amountInput.fill('200');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(500);
    
    // Unit
    const unitInput = page.locator('#dosage-unit, input[aria-label*="unit" i]').first();
    await unitInput.click();
    await unitInput.fill('mg');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(500);
    
    // Navigate through remaining fields with Tab until we reach Therapeutic Classes
    console.log('7. Navigating to Therapeutic Classes...');
    
    // Tab through fields until we find Therapeutic Classes button
    let therapeuticButtonFound = false;
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('Tab');
      await page.waitForTimeout(200);
      
      // Check if we've reached the Therapeutic Classes button
      const focusedElement = await page.evaluate(() => {
        const active = document.activeElement;
        return {
          id: active?.id,
          text: active?.textContent?.trim(),
          ariaLabel: active?.getAttribute('aria-label')
        };
      });
      
      console.log(`  Tab ${i + 1}: Focus on`, focusedElement);
      
      if (focusedElement.id === 'therapeutic-classes-button' || 
          focusedElement.text?.includes('Therapeutic') ||
          focusedElement.ariaLabel?.includes('therapeutic')) {
        therapeuticButtonFound = true;
        console.log('✓ Found Therapeutic Classes button!');
        break;
      }
    }
    
    if (!therapeuticButtonFound) {
      console.log('❌ Could not find Therapeutic Classes button via Tab navigation');
      
      // Try direct focus as fallback
      console.log('Trying direct focus...');
      const therapeuticButton = page.locator('#therapeutic-classes-button');
      const exists = await therapeuticButton.count() > 0;
      console.log(`Therapeutic Classes button exists: ${exists}`);
      
      if (exists) {
        await therapeuticButton.focus();
        await page.waitForTimeout(200);
      }
    }
    
    // Test opening the checklist
    console.log('\n8. Testing Therapeutic Classes keyboard navigation...');
    console.log('  Pressing Enter to open checklist...');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    
    // Check if list opened
    const listVisible = await page.locator('#therapeutic-classes-list').isVisible();
    console.log(`  ✓ Checklist opened: ${listVisible}`);
    
    if (listVisible) {
      // Test keyboard navigation within the checklist
      console.log('\n  Testing keyboard actions:');
      
      // Tab
      console.log('    - Pressing Tab...');
      await page.keyboard.press('Tab');
      await page.waitForTimeout(200);
      const afterTab = await page.evaluate(() => document.activeElement?.textContent?.trim());
      console.log(`      Focus after Tab: "${afterTab}"`);
      
      // Space
      console.log('    - Pressing Space...');
      await page.keyboard.press('Space');
      await page.waitForTimeout(200);
      const selectedAfterSpace = await page.evaluate(() => {
        return document.querySelectorAll('#therapeutic-classes-list input:checked').length;
      });
      console.log(`      Items selected after Space: ${selectedAfterSpace}`);
      
      // Arrow Down
      console.log('    - Pressing ArrowDown...');
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(200);
      const afterArrowDown = await page.evaluate(() => document.activeElement?.textContent?.trim());
      console.log(`      Focus after ArrowDown: "${afterArrowDown}"`);
      
      // Shift+Tab
      console.log('    - Pressing Shift+Tab...');
      await page.keyboard.press('Shift+Tab');
      await page.waitForTimeout(200);
      const afterShiftTab = await page.evaluate(() => document.activeElement?.textContent?.trim());
      console.log(`      Focus after Shift+Tab: "${afterShiftTab}"`);
      
      // Escape
      console.log('    - Pressing Escape...');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
      const listClosedAfterEscape = !(await page.locator('#therapeutic-classes-list').isVisible());
      console.log(`      Checklist closed after Escape: ${listClosedAfterEscape}`);
      
      // Check focus returned to button
      const buttonFocused = await page.evaluate(() => {
        return document.activeElement?.id === 'therapeutic-classes-button';
      });
      console.log(`      Focus returned to button: ${buttonFocused}`);
    }
    
    // Test Regimen Categories
    console.log('\n9. Testing Regimen Categories keyboard navigation...');
    
    // Tab to Regimen Categories button
    await page.keyboard.press('Tab');
    await page.waitForTimeout(200);
    
    const regimenFocused = await page.evaluate(() => {
      return document.activeElement?.id === 'regimen-categories-button';
    });
    console.log(`  Regimen Categories button focused: ${regimenFocused}`);
    
    if (regimenFocused) {
      // Open with Space
      console.log('  Pressing Space to open checklist...');
      await page.keyboard.press('Space');
      await page.waitForTimeout(500);
      
      const regimenListVisible = await page.locator('#regimen-categories-list').isVisible();
      console.log(`  ✓ Regimen checklist opened: ${regimenListVisible}`);
      
      if (regimenListVisible) {
        // Quick test of key actions
        console.log('    Testing Tab navigation...');
        await page.keyboard.press('Tab');
        await page.waitForTimeout(200);
        
        console.log('    Testing Space selection...');
        await page.keyboard.press('Space');
        await page.waitForTimeout(200);
        
        const regimenSelected = await page.evaluate(() => {
          return document.querySelectorAll('#regimen-categories-list input:checked').length;
        });
        console.log(`    Items selected: ${regimenSelected}`);
        
        // Close with Enter
        console.log('    Testing Enter to close...');
        await page.keyboard.press('Enter');
        await page.waitForTimeout(500);
        
        const regimenClosed = !(await page.locator('#regimen-categories-list').isVisible());
        console.log(`    Checklist closed: ${regimenClosed}`);
      }
    }
    
    // Print captured console logs
    console.log('\n10. Console logs from the application:');
    consoleLogs.forEach(log => {
      if (log.includes('Tab') || log.includes('Space') || log.includes('Enter') || 
          log.includes('Escape') || log.includes('Arrow') || log.includes('focus')) {
        console.log(`  ${log}`);
      }
    });
    
    // Summary
    console.log('\n=== TEST SUMMARY ===');
    console.log('Key findings:');
    console.log(`- Therapeutic Classes checklist opens: ${listVisible}`);
    console.log('- Keyboard navigation within checklists: Check logs above');
    console.log('- Focus management: Check logs above');
    console.log('\nReview the logs above to identify which keyboard actions are working and which are not.');
  });
});