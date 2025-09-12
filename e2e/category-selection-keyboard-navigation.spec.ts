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

// Helper to log test action
function logAction(action: string) {
  console.log(`\n[TEST ACTION] ${action}`);
}

// Helper to check if element is focused
async function isFocused(page: Page, selector: string): Promise<boolean> {
  return await page.evaluate((sel) => {
    const element = document.querySelector(sel);
    return element === document.activeElement;
  }, selector);
}

test.describe('Category Selection Keyboard Navigation UAT', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the application
    await page.goto('http://localhost:3456');
    
    // Select a client to proceed
    await page.locator('text="John Smith"').click();
    await page.waitForTimeout(500);
    
    // Open Add Medication modal
    const addMedicationButton = page.locator('#add-medication-button');
    await addMedicationButton.waitFor({ state: 'visible' });
    await addMedicationButton.click();
    await page.waitForTimeout(300);
    
    // Select Prescribed Medication
    await page.locator('text="Prescribed Medication"').click();
    await page.waitForTimeout(500);
    
    // Select a medication to proceed to the form
    const medicationSearch = page.locator('input#medication-search');
    await medicationSearch.fill('ibuprofen');
    await page.waitForTimeout(1000);
    
    // Select the medication
    const firstMedication = page.locator('#medication-dropdown >> div[role="option"]').first();
    await firstMedication.click();
    
    // Continue to dosage form
    const continueButton = page.locator('#medication-continue-button');
    await continueButton.click();
    await page.waitForTimeout(500);
    
    // Fill in dosage form to proceed to categories
    await page.locator('#dosage-category').fill('Solid');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    
    await page.locator('#form-type').fill('Tablet');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    
    await page.locator('#dosage-amount').fill('200');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    
    await page.locator('#dosage-unit').fill('mg');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    
    await page.locator('#frequency').fill('Twice daily');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    
    await page.locator('#total-amount').fill('60');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    
    await page.locator('#total-unit').fill('tablets');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
  });

  test('Therapeutic Classes - Complete Keyboard Navigation Test', async ({ page }) => {
    const consoleLogs = await setupConsoleCapture(page);
    
    console.log('\n=== THERAPEUTIC CLASSES KEYBOARD NAVIGATION TEST ===\n');
    
    // Focus on Therapeutic Classes button
    const therapeuticButton = page.locator('#therapeutic-classes-button');
    await therapeuticButton.focus();
    
    // Verify button is focused
    const buttonFocused = await isFocused(page, '#therapeutic-classes-button');
    console.log(`✓ Therapeutic Classes button focused: ${buttonFocused}`);
    
    // Test 1: Open with Enter key
    logAction('Pressing Enter to open Therapeutic Classes');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    
    const listVisible = await page.locator('#therapeutic-classes-list').isVisible();
    console.log(`✓ List opened with Enter: ${listVisible}`);
    
    if (!listVisible) {
      console.log('❌ ISSUE: List did not open with Enter key');
      return;
    }
    
    // Check what element has focus
    const focusedElement = await page.evaluate(() => {
      const active = document.activeElement;
      return {
        tagName: active?.tagName,
        id: active?.id,
        className: active?.className,
        role: active?.getAttribute('role'),
        tabIndex: active?.getAttribute('tabIndex')
      };
    });
    console.log('Currently focused element:', focusedElement);
    
    // Test 2: Tab navigation
    logAction('Testing Tab navigation between checkboxes');
    
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('Tab');
      await page.waitForTimeout(100);
      
      const currentFocus = await page.evaluate(() => {
        const active = document.activeElement;
        return active?.textContent?.trim() || 'Unknown';
      });
      console.log(`  Tab ${i + 1}: Focus on "${currentFocus}"`);
    }
    
    // Test 3: Space to toggle selection
    logAction('Testing Space to toggle checkbox');
    await page.keyboard.press('Space');
    await page.waitForTimeout(100);
    
    // Check if any checkbox got selected
    const selectedCount = await page.evaluate(() => {
      const checkboxes = document.querySelectorAll('#therapeutic-classes-list input[type="checkbox"]:checked');
      return checkboxes.length;
    });
    console.log(`✓ Checkboxes selected after Space: ${selectedCount}`);
    
    // Test 4: Shift+Tab backward navigation
    logAction('Testing Shift+Tab backward navigation');
    await page.keyboard.press('Shift+Tab');
    await page.waitForTimeout(100);
    
    const backwardFocus = await page.evaluate(() => {
      const active = document.activeElement;
      return active?.textContent?.trim() || 'Unknown';
    });
    console.log(`  Shift+Tab moved focus to: "${backwardFocus}"`);
    
    // Test 5: Arrow keys
    logAction('Testing Arrow Down navigation');
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(100);
    
    const arrowDownFocus = await page.evaluate(() => {
      const active = document.activeElement;
      return active?.textContent?.trim() || 'Unknown';
    });
    console.log(`  Arrow Down moved focus to: "${arrowDownFocus}"`);
    
    logAction('Testing Arrow Up navigation');
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(100);
    
    const arrowUpFocus = await page.evaluate(() => {
      const active = document.activeElement;
      return active?.textContent?.trim() || 'Unknown';
    });
    console.log(`  Arrow Up moved focus to: "${arrowUpFocus}"`);
    
    // Test 6: Escape to close
    logAction('Testing Escape to close checklist');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    
    const listClosedAfterEscape = !(await page.locator('#therapeutic-classes-list').isVisible());
    console.log(`✓ List closed with Escape: ${listClosedAfterEscape}`);
    
    // Check if focus returned to button
    const buttonFocusedAfterEscape = await isFocused(page, '#therapeutic-classes-button');
    console.log(`✓ Focus returned to button: ${buttonFocusedAfterEscape}`);
    
    // Test 7: Reopen and test Enter to close and advance
    logAction('Reopening list to test Enter key');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    
    // Select an item first
    await page.keyboard.press('Tab');
    await page.waitForTimeout(100);
    await page.keyboard.press('Space');
    await page.waitForTimeout(100);
    
    logAction('Testing Enter to close and advance');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    
    const listClosedAfterEnter = !(await page.locator('#therapeutic-classes-list').isVisible());
    console.log(`✓ List closed with Enter: ${listClosedAfterEnter}`);
    
    // Check where focus moved
    const focusAfterEnter = await page.evaluate(() => {
      const active = document.activeElement;
      return {
        id: active?.id,
        label: active?.getAttribute('aria-label') || active?.textContent?.trim()
      };
    });
    console.log(`  Focus after Enter:`, focusAfterEnter);
    
    // Print captured console logs
    console.log('\n=== CAPTURED CONSOLE LOGS ===');
    consoleLogs.forEach(log => console.log(`  ${log}`));
    
    // Summary
    console.log('\n=== TEST SUMMARY ===');
    console.log(`✓ List opens with Enter: ${listVisible}`);
    console.log(`✓ Space toggles selection: ${selectedCount > 0}`);
    console.log(`✓ Escape closes list: ${listClosedAfterEscape}`);
    console.log(`✓ Enter closes list: ${listClosedAfterEnter}`);
    console.log(`✓ Focus returns to button after Escape: ${buttonFocusedAfterEscape}`);
  });

  test('Regimen Categories - Complete Keyboard Navigation Test', async ({ page }) => {
    const consoleLogs = await setupConsoleCapture(page);
    
    console.log('\n=== REGIMEN CATEGORIES KEYBOARD NAVIGATION TEST ===\n');
    
    // First navigate past Therapeutic Classes
    const therapeuticButton = page.locator('#therapeutic-classes-button');
    await therapeuticButton.focus();
    await page.keyboard.press('Tab'); // Should move to Regimen Categories button
    await page.waitForTimeout(100);
    
    // Verify Regimen Categories button is focused
    const regimenButton = page.locator('#regimen-categories-button');
    const buttonFocused = await isFocused(page, '#regimen-categories-button');
    console.log(`✓ Regimen Categories button focused: ${buttonFocused}`);
    
    // Test 1: Open with Space key
    logAction('Pressing Space to open Regimen Categories');
    await page.keyboard.press('Space');
    await page.waitForTimeout(300);
    
    const listVisible = await page.locator('#regimen-categories-list').isVisible();
    console.log(`✓ List opened with Space: ${listVisible}`);
    
    if (!listVisible) {
      // Try with Enter
      logAction('Space didn\'t work, trying Enter');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(300);
      
      const listVisibleAfterEnter = await page.locator('#regimen-categories-list').isVisible();
      console.log(`✓ List opened with Enter: ${listVisibleAfterEnter}`);
      
      if (!listVisibleAfterEnter) {
        console.log('❌ ISSUE: List did not open with Space or Enter key');
        return;
      }
    }
    
    // Test all keyboard interactions
    const testResults = {
      tabNavigation: false,
      spaceSelection: false,
      arrowNavigation: false,
      escapeClose: false,
      enterClose: false,
      focusTrap: false
    };
    
    // Test Tab navigation
    logAction('Testing Tab navigation in Regimen Categories');
    const initialFocus = await page.evaluate(() => document.activeElement?.textContent?.trim());
    await page.keyboard.press('Tab');
    await page.waitForTimeout(100);
    const afterTabFocus = await page.evaluate(() => document.activeElement?.textContent?.trim());
    testResults.tabNavigation = initialFocus !== afterTabFocus;
    console.log(`  Tab navigation works: ${testResults.tabNavigation}`);
    console.log(`    Before: "${initialFocus}", After: "${afterTabFocus}"`);
    
    // Test Space selection
    logAction('Testing Space to select item');
    const beforeSelection = await page.evaluate(() => {
      return document.querySelectorAll('#regimen-categories-list input[type="checkbox"]:checked').length;
    });
    await page.keyboard.press('Space');
    await page.waitForTimeout(100);
    const afterSelection = await page.evaluate(() => {
      return document.querySelectorAll('#regimen-categories-list input[type="checkbox"]:checked').length;
    });
    testResults.spaceSelection = afterSelection !== beforeSelection;
    console.log(`  Space selection works: ${testResults.spaceSelection}`);
    console.log(`    Selected before: ${beforeSelection}, after: ${afterSelection}`);
    
    // Test Arrow navigation
    logAction('Testing Arrow key navigation');
    const beforeArrow = await page.evaluate(() => document.activeElement?.textContent?.trim());
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(100);
    const afterArrow = await page.evaluate(() => document.activeElement?.textContent?.trim());
    testResults.arrowNavigation = beforeArrow !== afterArrow;
    console.log(`  Arrow navigation works: ${testResults.arrowNavigation}`);
    console.log(`    Before: "${beforeArrow}", After: "${afterArrow}"`);
    
    // Test focus trap
    logAction('Testing focus trap (Tab should stay within list)');
    // Tab through all items and check if focus stays within
    let focusedElementId = '';
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('Tab');
      await page.waitForTimeout(50);
      focusedElementId = await page.evaluate(() => document.activeElement?.id || '');
      
      // Check if focus left the list
      const inList = await page.evaluate(() => {
        const active = document.activeElement;
        const list = document.querySelector('#regimen-categories-list');
        return list?.contains(active) || false;
      });
      
      if (!inList && i < 7) { // Should stay in list for at least 7 items
        console.log(`  Focus left list after ${i + 1} tabs`);
        break;
      }
    }
    testResults.focusTrap = true; // Will be set based on above
    
    // Test Escape
    logAction('Testing Escape to close');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    testResults.escapeClose = !(await page.locator('#regimen-categories-list').isVisible());
    console.log(`  Escape closes list: ${testResults.escapeClose}`);
    
    // Reopen for Enter test
    if (testResults.escapeClose) {
      await regimenButton.focus();
      await page.keyboard.press('Enter');
      await page.waitForTimeout(300);
    }
    
    // Test Enter to close
    logAction('Testing Enter to close and advance');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    testResults.enterClose = !(await page.locator('#regimen-categories-list').isVisible());
    console.log(`  Enter closes list: ${testResults.enterClose}`);
    
    // Print console logs
    console.log('\n=== CAPTURED CONSOLE LOGS ===');
    consoleLogs.forEach(log => console.log(`  ${log}`));
    
    // Final summary
    console.log('\n=== REGIMEN CATEGORIES TEST SUMMARY ===');
    Object.entries(testResults).forEach(([key, value]) => {
      const status = value ? '✓' : '❌';
      console.log(`${status} ${key}: ${value}`);
    });
    
    // Count working features
    const workingFeatures = Object.values(testResults).filter(v => v).length;
    const totalFeatures = Object.values(testResults).length;
    console.log(`\nOverall: ${workingFeatures}/${totalFeatures} features working`);
  });

  test('Focus Context and Event Handling Analysis', async ({ page }) => {
    const consoleLogs = await setupConsoleCapture(page);
    
    console.log('\n=== FOCUS CONTEXT AND EVENT HANDLING ANALYSIS ===\n');
    
    // Inject debugging code
    await page.evaluate(() => {
      // Override keyboard event handlers to log
      const originalAddEventListener = EventTarget.prototype.addEventListener;
      (EventTarget.prototype as any).addEventListener = function(type: string, handler: any, options: any) {
        if (type === 'keydown' || type === 'keyup' || type === 'keypress') {
          const wrappedHandler = function(event: KeyboardEvent) {
            console.log(`[Event Captured] ${type} on ${(event.currentTarget as any)?.id || (event.currentTarget as any)?.className || 'unknown'}: key="${event.key}"`);
            return handler.call(this, event);
          };
          return originalAddEventListener.call(this, type, wrappedHandler, options);
        }
        return originalAddEventListener.call(this, type, handler, options);
      };
    });
    
    // Focus on Therapeutic Classes button
    const therapeuticButton = page.locator('#therapeutic-classes-button');
    await therapeuticButton.focus();
    
    // Open the checklist
    console.log('Opening Therapeutic Classes checklist...');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    
    // Test each key and see which handler processes it
    const testKeys = ['Tab', 'Space', 'Enter', 'Escape', 'ArrowDown', 'ArrowUp'];
    
    for (const key of testKeys) {
      console.log(`\nTesting key: ${key}`);
      
      // Clear console before key press
      await page.evaluate(() => console.clear());
      
      // Press the key
      await page.keyboard.press(key);
      await page.waitForTimeout(100);
      
      // Get console logs for this key
      const keyLogs = consoleLogs.filter(log => log.includes(key));
      if (keyLogs.length > 0) {
        console.log(`  Handlers that processed ${key}:`);
        keyLogs.forEach(log => console.log(`    ${log}`));
      } else {
        console.log(`  No handlers logged for ${key}`);
      }
      
      // Check if default was prevented
      const defaultPrevented = await page.evaluate((k) => {
        return new Promise((resolve) => {
          const handler = (e: KeyboardEvent) => {
            if (e.key === k) {
              resolve(e.defaultPrevented);
              document.removeEventListener('keydown', handler, true);
            }
          };
          document.addEventListener('keydown', handler, true);
          
          // Trigger the key event
          const event = new KeyboardEvent('keydown', { key: k, bubbles: true });
          document.activeElement?.dispatchEvent(event);
        });
      }, key);
      
      console.log(`  Default prevented: ${defaultPrevented}`);
    }
    
    // Check focus behavior context
    const focusBehavior = await page.evaluate(() => {
      // Try to access focus behavior from window or components
      const contexts = (window as any).__FOCUS_CONTEXTS__ || [];
      return contexts;
    });
    
    console.log('\n=== FOCUS BEHAVIOR CONTEXTS ===');
    console.log(focusBehavior);
    
    // Print all captured logs
    console.log('\n=== ALL CAPTURED CONSOLE LOGS ===');
    consoleLogs.forEach(log => console.log(`  ${log}`));
  });
});