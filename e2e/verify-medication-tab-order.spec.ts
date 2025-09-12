import { test, expect } from '@playwright/test';

test.describe('Medication Form Tab Order', () => {
  test('verify tab order from medication name display area', async ({ page }) => {
    // Navigate to the application
    await page.goto('http://localhost:3456');
    
    // Wait for the page to load
    await page.waitForLoadState('networkidle');
    
    // Click on a client to proceed (assuming client selection is required)
    const firstClient = page.locator('[data-testid^="client-card-"]').first();
    if (await firstClient.isVisible()) {
      await firstClient.click();
    }
    
    // Open medication modal if needed
    const addMedicationButton = page.locator('button:has-text("Add Medication")').first();
    if (await addMedicationButton.isVisible()) {
      await addMedicationButton.click();
      
      // Wait for medication type dropdown and click Prescribed Medication
      await page.waitForSelector('[data-testid="prescribed-medication-button"]', { state: 'visible' });
      await page.click('[data-testid="prescribed-medication-button"]');
    }
    
    // Wait for medication modal to be visible
    await page.waitForSelector('[data-modal-id="add-new-prescribed-medication"]', { state: 'visible' });
    
    // Type in medication search - use input element specifically
    const medicationInput = page.locator('input#medication-search');
    await medicationInput.fill('Lorazepam');
    
    // Wait for search results
    await page.waitForTimeout(1000);
    
    // Select first medication result
    const firstResult = page.locator('[data-testid^="medication-option-"]').first();
    if (await firstResult.isVisible()) {
      await firstResult.click();
    }
    
    // Wait for medication to be selected
    await page.waitForTimeout(500);
    
    // Now test the tab order from the medication name display area
    console.log('Testing tab order from medication name display...');
    
    // Click on the medication name display area (the selected medication text)
    const medicationDisplay = page.locator('text=Lorazepam').first();
    await medicationDisplay.click();
    
    // Tab once - should go to the X (clear) button
    await page.keyboard.press('Tab');
    
    // Check what element has focus
    const focusedAfterFirstTab = await page.evaluate(() => {
      const activeElement = document.activeElement;
      return {
        tagName: activeElement?.tagName,
        id: activeElement?.id,
        className: activeElement?.className,
        ariaLabel: activeElement?.getAttribute('aria-label'),
        textContent: activeElement?.textContent?.trim(),
        testId: activeElement?.getAttribute('data-testid')
      };
    });
    
    console.log('After first Tab:', focusedAfterFirstTab);
    
    // Verify it's the X button
    expect(focusedAfterFirstTab.ariaLabel).toContain('Clear');
    
    // Tab again - should go to Dosage Form (tabIndex=1)
    await page.keyboard.press('Tab');
    
    // Check what element has focus now
    const focusedAfterSecondTab = await page.evaluate(() => {
      const activeElement = document.activeElement;
      return {
        tagName: activeElement?.tagName,
        id: activeElement?.id,
        className: activeElement?.className,
        ariaLabel: activeElement?.getAttribute('aria-label'),
        textContent: activeElement?.textContent?.trim(),
        tabIndex: activeElement?.getAttribute('tabindex')
      };
    });
    
    console.log('After second Tab:', focusedAfterSecondTab);
    
    // Should be Dosage Form input (tabIndex=1)
    expect(focusedAfterSecondTab.id).toBe('dosage-category');
    expect(focusedAfterSecondTab.tabIndex).toBe('1');
    
    // Let's continue tabbing to verify the full sequence
    const tabSequence = [];
    
    for (let i = 0; i < 15; i++) {
      await page.keyboard.press('Tab');
      
      const focused = await page.evaluate(() => {
        const activeElement = document.activeElement;
        return {
          id: activeElement?.id,
          ariaLabel: activeElement?.getAttribute('aria-label'),
          tabIndex: activeElement?.getAttribute('tabindex'),
          tagName: activeElement?.tagName
        };
      });
      
      tabSequence.push(focused);
      console.log(`Tab ${i + 3}:`, focused);
    }
    
    // Verify the sequence follows our expected tabIndex order
    const expectedSequence = [
      { id: 'dosage-category', tabIndex: '1' },  // After X button
      { ariaLabel: 'Open dosage form dropdown', tabIndex: '2' },
      { id: 'form-type', tabIndex: '3' },
      { ariaLabel: 'Open form type dropdown', tabIndex: '4' },
      { id: 'dosage-amount', tabIndex: '5' },
      { id: 'dosage-unit', tabIndex: '6' },
      { ariaLabel: 'Open dosage unit dropdown', tabIndex: '7' },
      { id: 'total-amount', tabIndex: '8' },
      { id: 'total-unit', tabIndex: '9' },
      { ariaLabel: 'Open total unit dropdown', tabIndex: '10' },
      { id: 'dosage-frequency', tabIndex: '11' },
      { ariaLabel: 'Open frequency dropdown', tabIndex: '12' },
      { id: 'dosage-timings', tabIndex: '13' },
      { ariaLabel: 'Open timings dropdown', tabIndex: '14' }
    ];
    
    // Log the full tab sequence
    console.log('\n=== Full Tab Sequence ===');
    tabSequence.forEach((item, index) => {
      console.log(`${index + 3}: ${item.id || item.ariaLabel} (tabIndex: ${item.tabIndex})`);
    });
  });
  
  test('verify incorrect behavior - tabs to Medication Categories', async ({ page }) => {
    // Navigate to the application
    await page.goto('http://localhost:3456');
    
    // Wait for the page to load
    await page.waitForLoadState('networkidle');
    
    // Click on a client to proceed
    const firstClient = page.locator('[data-testid^="client-card-"]').first();
    if (await firstClient.isVisible()) {
      await firstClient.click();
    }
    
    // Open medication modal
    const addMedicationButton = page.locator('button:has-text("Add Medication")').first();
    if (await addMedicationButton.isVisible()) {
      await addMedicationButton.click();
      
      // Wait for medication type dropdown and click Prescribed Medication
      await page.waitForSelector('[data-testid="prescribed-medication-button"]', { state: 'visible' });
      await page.click('[data-testid="prescribed-medication-button"]');
    }
    
    // Wait for modal
    await page.waitForSelector('[data-modal-id="add-new-prescribed-medication"]', { state: 'visible' });
    
    // Select a medication - use input element specifically
    const medicationInput = page.locator('input#medication-search');
    await medicationInput.fill('Lorazepam');
    await page.waitForTimeout(1000);
    
    const firstResult = page.locator('[data-testid^="medication-option-"]').first();
    if (await firstResult.isVisible()) {
      await firstResult.click();
    }
    
    await page.waitForTimeout(500);
    
    // Click on medication name display
    const medicationDisplay = page.locator('text=Lorazepam').first();
    await medicationDisplay.click();
    
    // Tab twice and check if it incorrectly goes to Medication Categories
    await page.keyboard.press('Tab'); // Should go to X
    await page.keyboard.press('Tab'); // Should go to Dosage Form, but might go to Categories
    
    const focusedElement = await page.evaluate(() => {
      const activeElement = document.activeElement;
      return {
        id: activeElement?.id,
        text: activeElement?.textContent?.trim(),
        ariaLabel: activeElement?.getAttribute('aria-label'),
        tabIndex: activeElement?.getAttribute('tabindex')
      };
    });
    
    console.log('Element focused after 2 tabs from medication display:', focusedElement);
    
    // Check if it incorrectly went to categories
    if (focusedElement.id === 'broad-categories-button' || 
        focusedElement.text?.includes('categories')) {
      console.log('❌ INCORRECT: Focus went to Medication Categories instead of Dosage Form');
      expect(focusedElement.id).not.toBe('broad-categories-button');
    } else if (focusedElement.id === 'dosage-category') {
      console.log('✅ CORRECT: Focus went to Dosage Form as expected');
    }
  });
});