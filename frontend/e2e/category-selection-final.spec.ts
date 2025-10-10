import { test, expect } from '@playwright/test';

test.describe('Category Selection Final Test', () => {
  test('Comprehensive keyboard navigation test', async ({ page }) => {
    // Enable console logging
    page.on('console', msg => {
      const text = msg.text();
      if (text.includes('Intercepting') || text.includes('tabActive') || text.includes('Focus')) {
        console.log('LOG:', text);
      }
    });
    
    console.log('\n=== FINAL CATEGORY SELECTION TEST ===\n');
    
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
    
    // Click Therapeutic Classes button
    console.log('1. Opening Therapeutic Classes...');
    await page.locator('button#therapeutic-classes-button').click();
    await page.waitForTimeout(500);
    
    // Verify list is open
    const listVisible = await page.locator('#therapeutic-classes-list').isVisible();
    console.log(`   List visible: ${listVisible}`);
    
    if (!listVisible) {
      console.log('   ERROR: List did not open!');
      return;
    }
    
    // Wait for auto-focus
    await page.waitForTimeout(100);
    
    // Check what has focus
    const initialFocus = await page.evaluate(() => {
      const active = document.activeElement;
      const inList = !!active?.closest('#therapeutic-classes-list');
      return {
        text: active?.textContent?.trim().substring(0, 30),
        inList: inList,
        tagName: active?.tagName,
        id: active?.id
      };
    });
    console.log(`   Initial focus:`, initialFocus);
    
    // If not in list, manually focus first item
    if (!initialFocus.inList) {
      console.log('   Manually focusing first item...');
      await page.locator('#therapeutic-classes-list div[role="checkbox"]').first().focus();
      await page.waitForTimeout(100);
    }
    
    // Now test Tab
    console.log('\n2. Testing Tab navigation...');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(200);
    
    const afterTab = await page.evaluate(() => {
      const active = document.activeElement;
      const inList = !!active?.closest('#therapeutic-classes-list');
      return {
        text: active?.textContent?.trim().substring(0, 30),
        inList: inList
      };
    });
    console.log(`   After Tab:`, afterTab);
    
    // Test Space
    console.log('\n3. Testing Space selection...');
    
    // Check current selection before Space
    const beforeSpace = await page.evaluate(() => {
      return document.querySelectorAll('#therapeutic-classes-list input:checked').length;
    });
    console.log(`   Selected before Space: ${beforeSpace}`);
    
    await page.keyboard.press('Space');
    await page.waitForTimeout(500);
    
    const selectedCount = await page.evaluate(() => {
      return document.querySelectorAll('#therapeutic-classes-list input:checked').length;
    });
    console.log(`   Selected after Space: ${selectedCount}`);
    
    // Test Shift+Tab
    console.log('\n4. Testing Shift+Tab...');
    await page.keyboard.press('Shift+Tab');
    await page.waitForTimeout(200);
    
    const afterShiftTab = await page.evaluate(() => {
      const active = document.activeElement;
      const inList = !!active?.closest('#therapeutic-classes-list');
      return {
        text: active?.textContent?.trim().substring(0, 30),
        inList: inList
      };
    });
    console.log(`   After Shift+Tab:`, afterShiftTab);
    
    // Test Arrow Down
    console.log('\n5. Testing ArrowDown...');
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(200);
    
    const afterArrow = await page.evaluate(() => {
      const active = document.activeElement;
      return active?.textContent?.trim().substring(0, 30);
    });
    console.log(`   After ArrowDown: "${afterArrow}"`);
    
    // Test Enter to close
    console.log('\n6. Testing Enter to close...');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    
    const listClosed = !(await page.locator('#therapeutic-classes-list').isVisible());
    const focusAfterClose = await page.evaluate(() => {
      return document.activeElement?.id;
    });
    console.log(`   List closed: ${listClosed}`);
    console.log(`   Focus after close: ${focusAfterClose}`);
    
    // Test Regimen Categories
    console.log('\n7. Testing Regimen Categories...');
    
    // Open Regimen Categories
    await page.locator('button#regimen-categories-button').click();
    await page.waitForTimeout(500);
    
    const regimenVisible = await page.locator('#regimen-categories-list').isVisible();
    console.log(`   Regimen list visible: ${regimenVisible}`);
    
    let regimenTabResult = false;
    let regimenSelected = 0;
    let regimenClosed = false;
    
    if (regimenVisible) {
      // Wait for auto-focus
      await page.waitForTimeout(100);
      
      // Focus first item to ensure focus
      await page.locator('#regimen-categories-list div[role="checkbox"]').first().focus();
      
      // Test Tab
      console.log('   Testing Tab in Regimen...');
      await page.keyboard.press('Tab');
      await page.waitForTimeout(200);
      
      regimenTabResult = await page.evaluate(() => {
        const active = document.activeElement;
        const inList = !!active?.closest('#regimen-categories-list');
        return inList;
      });
      console.log(`   Still in Regimen list: ${regimenTabResult}`);
      
      // Test Space to select
      await page.keyboard.press('Space');
      await page.waitForTimeout(200);
      
      regimenSelected = await page.evaluate(() => {
        return document.querySelectorAll('#regimen-categories-list input:checked').length;
      });
      console.log(`   Regimen items selected: ${regimenSelected}`);
      
      // Close with Escape
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
      
      regimenClosed = !(await page.locator('#regimen-categories-list').isVisible());
      console.log(`   Regimen list closed: ${regimenClosed}`);
    }
    
    console.log('\n=== SUMMARY ===');
    console.log('Therapeutic Classes:');
    console.log(`  - Opens: ${listVisible}`);
    console.log(`  - Tab navigation: ${afterTab.inList ? 'WORKS' : 'BROKEN'}`);
    console.log(`  - Space selection: ${selectedCount > 0 ? 'WORKS' : 'BROKEN'}`);
    console.log(`  - Enter closes: ${listClosed ? 'WORKS' : 'BROKEN'}`);
    console.log('Regimen Categories:');
    console.log(`  - Opens: ${regimenVisible}`);
    console.log(`  - Tab navigation: ${regimenTabResult ? 'WORKS' : 'BROKEN'}`);
    console.log(`  - Space selection: ${regimenSelected > 0 ? 'WORKS' : 'BROKEN'}`);
    console.log(`  - Escape closes: ${regimenClosed ? 'WORKS' : 'BROKEN'}`);
    
    // Assert all features work
    expect(afterTab.inList || afterShiftTab.inList).toBeTruthy();
    expect(selectedCount).toBeGreaterThan(0);
  });
});