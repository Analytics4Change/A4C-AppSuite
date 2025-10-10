import { test, expect } from '@playwright/test';

test.describe('Category Selection Direct Test', () => {
  test('Test keyboard navigation directly', async ({ page }) => {
    // Enable console logging
    page.on('console', msg => {
      if (msg.type() === 'log' && msg.text().includes('[')) {
        console.log('LOG:', msg.text());
      }
    });
    
    console.log('\n=== DIRECT CATEGORY SELECTION TEST ===\n');
    
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
    
    // Quick fill required fields using the actual workflow
    // Category dropdown
    await page.locator('#dosage-category').click();
    await page.locator('text="Solid"').click();
    await page.waitForTimeout(200);
    
    // Form type dropdown
    await page.locator('#form-type').click();
    await page.locator('text="Tablet"').click();
    await page.waitForTimeout(200);
    
    // Amount and unit
    await page.locator('#dosage-amount').fill('200');
    await page.locator('#dosage-unit').fill('mg');
    
    // Direct click on Therapeutic Classes button
    console.log('1. Clicking Therapeutic Classes button directly...');
    const therapeuticButton = page.locator('button#therapeutic-classes-button');
    await therapeuticButton.click();
    await page.waitForTimeout(500);
    
    // Check if list opened
    const listVisible = await page.locator('#therapeutic-classes-list').isVisible();
    console.log(`   Checklist opened via click: ${listVisible}`);
    
    if (listVisible) {
      // Check initial focus
      const initialFocus = await page.evaluate(() => {
        const active = document.activeElement;
        return active?.textContent?.trim().substring(0, 30);
      });
      console.log(`   Initial focus: "${initialFocus}"`);
      
      // Test Tab navigation
      console.log('\n2. Testing Tab navigation...');
      await page.keyboard.press('Tab');
      await page.waitForTimeout(200);
      
      const afterTab = await page.evaluate(() => {
        const active = document.activeElement;
        const isInList = !!active?.closest('#therapeutic-classes-list');
        return {
          text: active?.textContent?.trim().substring(0, 30),
          isInList: isInList
        };
      });
      console.log(`   After Tab: "${afterTab.text}" (in list: ${afterTab.isInList})`);
      
      // If we moved out of the list, refocus the first item
      if (!afterTab.isInList) {
        console.log('   Tab moved focus out of list. Refocusing first item...');
        const firstCheckbox = page.locator('#therapeutic-classes-list div[role="checkbox"]').first();
        await firstCheckbox.focus();
        await page.waitForTimeout(200);
      }
      
      // Test Space selection
      console.log('\n3. Testing Space selection...');
      await page.keyboard.press('Space');
      await page.waitForTimeout(200);
      
      const selectedCount = await page.evaluate(() => {
        return document.querySelectorAll('#therapeutic-classes-list input:checked').length;
      });
      console.log(`   Items selected: ${selectedCount}`);
      
      // Test Arrow navigation
      console.log('\n4. Testing Arrow Down...');
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(200);
      
      const afterArrow = await page.evaluate(() => {
        const active = document.activeElement;
        return active?.textContent?.trim().substring(0, 30);
      });
      console.log(`   After ArrowDown: "${afterArrow}"`);
      
      // Test Escape
      console.log('\n5. Testing Escape...');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
      
      const listClosed = !(await page.locator('#therapeutic-classes-list').isVisible());
      console.log(`   List closed: ${listClosed}`);
      
      const buttonFocused = await page.evaluate(() => {
        return document.activeElement?.id === 'therapeutic-classes-button';
      });
      console.log(`   Focus on button: ${buttonFocused}`);
    }
    
    console.log('\n=== TEST COMPLETE ===\n');
  });
});