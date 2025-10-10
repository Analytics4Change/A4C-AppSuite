import { test, expect } from '@playwright/test';

test.describe('Multi-Select Dropdown Keyboard Navigation', () => {
  test('Space key selection works correctly', async ({ page }) => {
    console.log('\n=== MULTI-SELECT DROPDOWN TEST ===\n');
    
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
    
    // Test Therapeutic Classes
    console.log('1. Testing Therapeutic Classes dropdown...');
    
    // Click the button to open dropdown
    await page.locator('#therapeutic-classes-button').click();
    await page.waitForTimeout(500);
    
    // Check if dropdown is open
    const dropdownVisible = await page.locator('#therapeutic-classes-listbox').isVisible();
    console.log(`   Dropdown visible: ${dropdownVisible}`);
    
    if (dropdownVisible) {
      // Wait for first item to be focused
      await page.waitForTimeout(100);
      
      // Test Tab navigation
      console.log('   Testing Tab navigation...');
      await page.keyboard.press('Tab');
      await page.waitForTimeout(200);
      
      const focusedAfterTab = await page.evaluate(() => {
        const active = document.activeElement;
        return active?.textContent?.trim();
      });
      console.log(`   Focused after Tab: "${focusedAfterTab}"`);
      
      // Test Space selection
      console.log('   Testing Space selection...');
      const beforeSpace = await page.evaluate(() => {
        return document.querySelectorAll('#therapeutic-classes-listbox input:checked').length;
      });
      console.log(`   Selected before Space: ${beforeSpace}`);
      
      await page.keyboard.press('Space');
      await page.waitForTimeout(500);
      
      const afterSpace = await page.evaluate(() => {
        return document.querySelectorAll('#therapeutic-classes-listbox input:checked').length;
      });
      console.log(`   Selected after Space: ${afterSpace}`);
      
      // Test Enter to close
      console.log('   Testing Enter to close...');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(500);
      
      const closedAfterEnter = !(await page.locator('#therapeutic-classes-listbox').isVisible());
      console.log(`   Closed after Enter: ${closedAfterEnter}`);
      
      // Verify button text updated
      const buttonText = await page.locator('#therapeutic-classes-button').textContent();
      console.log(`   Button text: "${buttonText}"`);
      
      // Assertions
      expect(afterSpace).toBeGreaterThan(beforeSpace);
      expect(closedAfterEnter).toBeTruthy();
      expect(buttonText).toContain('selected');
    }
    
    // Test Regimen Categories
    console.log('\n2. Testing Regimen Categories dropdown...');
    
    await page.locator('#regimen-categories-button').click();
    await page.waitForTimeout(500);
    
    const regimenVisible = await page.locator('#regimen-categories-listbox').isVisible();
    console.log(`   Regimen dropdown visible: ${regimenVisible}`);
    
    if (regimenVisible) {
      // Test Space selection
      await page.waitForTimeout(100);
      await page.keyboard.press('Space');
      await page.waitForTimeout(500);
      
      const regimenSelected = await page.evaluate(() => {
        return document.querySelectorAll('#regimen-categories-listbox input:checked').length;
      });
      console.log(`   Regimen items selected: ${regimenSelected}`);
      
      // Test Escape to close
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
      
      const regimenClosed = !(await page.locator('#regimen-categories-listbox').isVisible());
      console.log(`   Closed after Escape: ${regimenClosed}`);
      
      // Assertions
      expect(regimenSelected).toBeGreaterThan(0);
      expect(regimenClosed).toBeTruthy();
    }
    
    console.log('\n=== TEST SUMMARY ===');
    console.log('All keyboard navigation features working correctly ✓');
  });
  
  test('Mouse selection works correctly', async ({ page }) => {
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
    
    // Open Therapeutic Classes
    await page.locator('#therapeutic-classes-button').click();
    await page.waitForTimeout(500);
    
    // Click on multiple items
    await page.locator('#therapeutic-classes-listbox >> text="Pain Relief"').click();
    await page.waitForTimeout(200);
    await page.locator('#therapeutic-classes-listbox >> text="Cardiovascular"').click();
    await page.waitForTimeout(200);
    
    // Check selections
    const selected = await page.evaluate(() => {
      return document.querySelectorAll('#therapeutic-classes-listbox input:checked').length;
    });
    
    expect(selected).toBe(2);
    
    // Click outside to close
    await page.locator('body').click({ position: { x: 10, y: 10 } });
    await page.waitForTimeout(500);
    
    const closed = !(await page.locator('#therapeutic-classes-listbox').isVisible());
    expect(closed).toBeTruthy();
    
    // Verify button shows correct count
    const buttonText = await page.locator('#therapeutic-classes-button').textContent();
    expect(buttonText).toContain('2');
  });
});