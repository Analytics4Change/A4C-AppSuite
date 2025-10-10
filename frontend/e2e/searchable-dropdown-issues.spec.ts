import { test, expect } from '@playwright/test';

test.describe('SearchableDropdown Focus Trap Issues', () => {
  test.beforeEach(async ({ page }) => {
    // Add console logging
    page.on('console', msg => {
      if (msg.text().includes('UAT-')) {
        console.log(msg.text());
      }
    });
    
    // Inject UAT logging
    await page.addInitScript(() => {
      // Track focus changes
      document.addEventListener('focusin', (e) => {
        const target = e.target as Element;
        const id = target.id || 'no-id';
        const className = target.className || 'no-class';
        console.log(`[UAT-FOCUS] Focus moved to: #${id} (${className})`);
      }, true);
      
      // Track key presses
      document.addEventListener('keydown', (e) => {
        const target = e.target as Element;
        const id = target.id || 'no-id';
        console.log(`[UAT-KEY] Key "${e.key}" on #${id}, defaultPrevented: ${e.defaultPrevented}`);
      }, true);
    });
  });
  
  test('Verify SearchableDropdown Issues', async ({ page }) => {
    console.log('\n=== SearchableDropdown Issue Verification ===\n');
    
    // Navigate to the app
    await page.goto('http://localhost:3456');
    console.log('✓ Page loaded');
    
    // Look for a button to open medication modal
    // Adjust selector based on actual UI
    const addButton = page.locator('button').filter({ hasText: /add.*medication/i }).first();
    if (await addButton.count() > 0) {
      await addButton.click();
      console.log('✓ Clicked Add Medication button');
    } else {
      // Try alternative selectors
      await page.click('button:has-text("Add")').catch(() => {});
      await page.click('[data-testid*="add"]').catch(() => {});
      console.log('⚠ Could not find Add Medication button, trying alternatives');
    }
    
    // Wait for medication search to be visible
    await page.waitForSelector('#medication-search', { timeout: 5000 }).catch(() => {
      console.log('❌ Medication search not found');
    });
    
    // Issue 1: Test typing and filtering
    console.log('\n1. Testing if typing narrows results...');
    const searchInput = page.locator('#medication-search');
    
    // Type initial letters
    await searchInput.fill('As');
    await page.waitForTimeout(600); // Wait for debounce
    
    // Check if dropdown is visible
    const dropdownVisible = await page.locator('#medication-dropdown').isVisible().catch(() => false);
    console.log(`   Dropdown visible: ${dropdownVisible}`);
    
    if (dropdownVisible) {
      // Count results
      const resultsCount1 = await page.locator('#medication-dropdown [role="option"]').count();
      console.log(`   Results for "As": ${resultsCount1}`);
      
      // Type more to narrow
      await searchInput.fill('Aspirin');
      await page.waitForTimeout(600);
      
      const resultsCount2 = await page.locator('#medication-dropdown [role="option"]').count();
      console.log(`   Results for "Aspirin": ${resultsCount2}`);
      
      if (resultsCount1 === resultsCount2 && resultsCount1 > 1) {
        console.log('   ❌ CONFIRMED: Typing does not narrow results');
      } else {
        console.log('   ✓ Typing narrows results correctly');
      }
    }
    
    // Issue 2: Test Tab behavior
    console.log('\n2. Testing Tab navigation behavior...');
    await searchInput.focus();
    
    // Clear and type again
    await searchInput.fill('Med');
    await page.waitForTimeout(600);
    
    // Press Tab multiple times and track focus
    const tabSequence = [];
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Tab');
      await page.waitForTimeout(100);
      
      const focusInfo = await page.evaluate(() => {
        const el = document.activeElement;
        return {
          id: el?.id || '',
          tagName: el?.tagName || '',
          isInDropdown: el?.closest('#medication-dropdown') !== null,
          text: (el?.textContent || '').substring(0, 20)
        };
      });
      
      tabSequence.push(focusInfo);
      console.log(`   Tab ${i + 1}: ${focusInfo.id || focusInfo.tagName} (inDropdown: ${focusInfo.isInDropdown})`);
    }
    
    // Check for alternating behavior
    const alternates = tabSequence.some((item, idx) => 
      idx > 0 && item.isInDropdown !== tabSequence[idx - 1].isInDropdown
    );
    
    if (alternates) {
      console.log('   ❌ CONFIRMED: Tab alternates between dropdown and external elements');
    } else {
      console.log('   ✓ Tab behavior is consistent');
    }
    
    // Issue 3: Test Arrow Keys
    console.log('\n3. Testing Arrow Keys...');
    await searchInput.focus();
    await searchInput.fill('Med');
    await page.waitForTimeout(600);
    
    // Try arrow down
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(100);
    
    const arrowWorking = await page.evaluate(() => {
      const highlighted = document.querySelector('#medication-dropdown [aria-selected="true"]');
      return !!highlighted;
    });
    
    if (!arrowWorking) {
      console.log('   ❌ CONFIRMED: Arrow keys do not work');
    } else {
      console.log('   ✓ Arrow keys work correctly');
    }
    
    // Issue 4: Test Shift+Tab
    console.log('\n4. Testing Shift+Tab behavior...');
    await searchInput.focus();
    
    await page.keyboard.press('Shift+Tab');
    await page.waitForTimeout(100);
    
    const afterShiftTab = await page.evaluate(() => {
      const el = document.activeElement;
      return {
        id: el?.id || '',
        isInDropdown: el?.closest('#medication-dropdown') !== null
      };
    });
    
    const dropdownStillOpen = await page.locator('#medication-dropdown').isVisible().catch(() => false);
    
    console.log(`   Focus after Shift+Tab: ${afterShiftTab.id} (inDropdown: ${afterShiftTab.isInDropdown})`);
    console.log(`   Dropdown still open: ${dropdownStillOpen}`);
    
    if (!afterShiftTab.isInDropdown && dropdownStillOpen) {
      console.log('   ❌ CONFIRMED: Shift+Tab exits focus trap but dropdown stays open');
    }
    
    // Issue 5: Test Escape Key
    console.log('\n5. Testing Escape Key behavior...');
    await searchInput.focus();
    await searchInput.fill('Med');
    await page.waitForTimeout(600);
    
    // Check modal is open before Escape
    const modalBeforeEscape = await page.locator('[data-testid="add-new-prescribed-medication-modal"]').isVisible().catch(() => false);
    
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    
    const modalAfterEscape = await page.locator('[data-testid="add-new-prescribed-medication-modal"]').isVisible().catch(() => false);
    const dropdownAfterEscape = await page.locator('#medication-dropdown').isVisible().catch(() => false);
    
    console.log(`   Modal before Escape: ${modalBeforeEscape}`);
    console.log(`   Modal after Escape: ${modalAfterEscape}`);
    console.log(`   Dropdown after Escape: ${dropdownAfterEscape}`);
    
    if (!modalAfterEscape && modalBeforeEscape) {
      console.log('   ❌ CONFIRMED: Escape closes entire modal instead of just dropdown');
    } else if (!dropdownAfterEscape && modalAfterEscape) {
      console.log('   ✓ Escape correctly closes only dropdown');
    }
    
    console.log('\n=== Summary of Issues Found ===');
    console.log('Review the output above for confirmed issues marked with ❌');
  });
});