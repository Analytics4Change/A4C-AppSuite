import { test, expect } from '@playwright/test';

test.describe('Space Key Selection Fix Verification', () => {
  test('Space key toggles checkbox selection in multi-select dropdowns', async ({ page }) => {
    // Navigate and setup
    await page.goto('http://localhost:3456');
    await page.locator('text="John Smith"').click();
    await page.locator('#add-medication-button').click();
    await page.locator('text="Prescribed Medication"').click();
    
    // Select medication
    const medicationSearch = page.locator('input#medication-search');
    await medicationSearch.fill('ibuprofen');
    await page.waitForTimeout(1500);
    await page.locator('#medication-dropdown >> div[role="option"]').first().click();
    
    // Continue to dosage form
    await page.locator('#medication-continue-button').click();
    await page.waitForTimeout(1000);
    
    // Quick fill required fields
    await page.locator('#dosage-category').click();
    await page.locator('text="Solid"').click();
    await page.locator('#form-type').click();
    await page.locator('text="Tablet"').click();
    await page.locator('#dosage-amount').fill('200');
    await page.locator('#dosage-unit').fill('mg');
    
    // Test Therapeutic Classes dropdown
    console.log('\n=== TESTING THERAPEUTIC CLASSES ===');
    await page.locator('#therapeutic-classes-button').click();
    await page.waitForTimeout(500);
    
    // Get initial state
    const initialTherapeutic = await page.evaluate(() => {
      const checkboxes = document.querySelectorAll('#therapeutic-classes-listbox [data-slot="checkbox"]');
      return Array.from(checkboxes).map(cb => {
        const parent = cb.closest('[role="option"]');
        const label = parent?.querySelector('span.text-sm')?.textContent || 'unknown';
        const checked = cb.getAttribute('data-state') === 'checked';
        return { label, checked };
      });
    });
    console.log('Initial therapeutic classes:', initialTherapeutic);
    
    // Focus first item and press Space
    await page.locator('#therapeutic-classes-listbox div[role="option"]').first().focus();
    await page.keyboard.press('Space');
    await page.waitForTimeout(500);
    
    // Verify first item is now checked
    const afterSpaceTherapeutic = await page.evaluate(() => {
      const firstCheckbox = document.querySelector('#therapeutic-classes-listbox [data-slot="checkbox"]');
      return firstCheckbox?.getAttribute('data-state') === 'checked';
    });
    expect(afterSpaceTherapeutic).toBe(true);
    console.log('✅ Space key successfully toggles therapeutic class selection');
    
    // Navigate with arrow and select another
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Space');
    await page.waitForTimeout(500);
    
    // Verify two items are checked
    const twoCheckedTherapeutic = await page.evaluate(() => {
      const checkboxes = document.querySelectorAll('#therapeutic-classes-listbox [data-slot="checkbox"][data-state="checked"]');
      return checkboxes.length;
    });
    expect(twoCheckedTherapeutic).toBe(2);
    console.log('✅ Multiple selections work correctly');
    
    // Close with Escape
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    
    // Verify dropdown is closed
    const therapeuticDropdownClosed = await page.locator('#therapeutic-classes-listbox').isHidden();
    expect(therapeuticDropdownClosed).toBe(true);
    console.log('✅ Escape key closes dropdown');
    
    // Test Regimen Categories dropdown
    console.log('\n=== TESTING REGIMEN CATEGORIES ===');
    await page.locator('#regimen-categories-button').click();
    await page.waitForTimeout(500);
    
    // Focus first item and press Space
    await page.locator('#regimen-categories-listbox div[role="option"]').first().focus();
    await page.keyboard.press('Space');
    await page.waitForTimeout(500);
    
    // Verify first item is checked
    const afterSpaceRegimen = await page.evaluate(() => {
      const firstCheckbox = document.querySelector('#regimen-categories-listbox [data-slot="checkbox"]');
      return firstCheckbox?.getAttribute('data-state') === 'checked';
    });
    expect(afterSpaceRegimen).toBe(true);
    console.log('✅ Space key successfully toggles regimen category selection');
    
    // Tab navigation within dropdown
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Space');
    await page.waitForTimeout(500);
    
    // Verify multiple selections
    const multipleRegimen = await page.evaluate(() => {
      const checkboxes = document.querySelectorAll('#regimen-categories-listbox [data-slot="checkbox"][data-state="checked"]');
      return checkboxes.length;
    });
    expect(multipleRegimen).toBeGreaterThanOrEqual(2);
    console.log('✅ Tab navigation and multiple selections work');
    
    // Press Enter to accept selections
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    
    // Verify dropdown is closed
    const regimenDropdownClosed = await page.locator('#regimen-categories-listbox').isHidden();
    expect(regimenDropdownClosed).toBe(true);
    console.log('✅ Enter key accepts selections and closes dropdown');
    
    // Verify button shows selection count
    const therapeuticButtonText = await page.locator('#therapeutic-classes-button').textContent();
    const regimenButtonText = await page.locator('#regimen-categories-button').textContent();
    
    expect(therapeuticButtonText).toContain('selected');
    expect(regimenButtonText).toContain('selected');
    console.log('✅ Selection counts displayed correctly');
    
    console.log('\n🎉 ALL TESTS PASSED! Space key selection is working correctly.');
  });
});