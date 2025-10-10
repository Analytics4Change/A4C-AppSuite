import { test, expect, Page } from '@playwright/test';

// Helper to capture and log console messages
class ConsoleLogger {
  logs: Array<{ type: string; text: string; timestamp: number }> = [];
  
  attach(page: Page) {
    page.on('console', msg => {
      const entry = {
        type: msg.type(),
        text: msg.text(),
        timestamp: Date.now()
      };
      this.logs.push(entry);
      console.log(`[Browser ${msg.type()}]:`, msg.text());
    });
    
    page.on('pageerror', error => {
      console.error('[Page Error]:', error.message);
    });
  }
  
  getLogsContaining(text: string) {
    return this.logs.filter(log => log.text.includes(text));
  }
  
  clear() {
    this.logs = [];
  }
}

test.describe('Focus Trap Comparison: SearchableDropdown vs AutocompleteDropdown', () => {
  let consoleLogger: ConsoleLogger;
  
  test.beforeEach(async ({ page }) => {
    consoleLogger = new ConsoleLogger();
    consoleLogger.attach(page);
    
    // Add custom logging to the page
    await page.addInitScript(() => {
      // Override console methods to add UAT prefix
      const originalLog = console.log;
      const originalWarn = console.warn;
      const originalError = console.error;
      
      console.log = (...args) => {
        originalLog('[UAT-LOG]:', ...args);
      };
      
      console.warn = (...args) => {
        originalWarn('[UAT-WARN]:', ...args);
      };
      
      console.error = (...args) => {
        originalError('[UAT-ERROR]:', ...args);
      };
      
      // Add focus tracking
      let lastFocusedElement: Element | null = null;
      document.addEventListener('focusin', (e) => {
        const target = e.target as Element;
        const id = target.id || target.className || target.tagName;
        console.log(`[UAT-FOCUS]: Focus moved to: ${id}`);
        lastFocusedElement = target;
      }, true);
      
      // Add keydown tracking
      document.addEventListener('keydown', (e) => {
        const target = e.target as Element;
        const id = target.id || target.className || target.tagName;
        console.log(`[UAT-KEY]: Key "${e.key}" pressed on: ${id}, Shift: ${e.shiftKey}`);
      }, true);
    });
  });
  
  test('SearchableDropdown (Medication Search) - Focus Trap Behavior', async ({ page }) => {
    console.log('\n=== Testing SearchableDropdown Focus Trap ===\n');
    
    // Navigate to medication entry modal
    await page.goto('http://localhost:3456');
    
    // Open medication modal (adjust selector as needed)
    await page.click('button:has-text("Add Medication")');
    await page.waitForSelector('#medication-search');
    
    // Start typing in medication search
    console.log('1. Testing typing and filtering...');
    await page.fill('#medication-search', 'Asp');
    await page.waitForTimeout(500); // Wait for debounce
    
    // Check if dropdown opened
    const dropdownVisible = await page.isVisible('#medication-dropdown');
    console.log(`   Dropdown visible after typing: ${dropdownVisible}`);
    
    // Count initial results
    const initialResults = await page.locator('#medication-dropdown [role="option"]').count();
    console.log(`   Initial results count: ${initialResults}`);
    
    // Continue typing to narrow results
    await page.fill('#medication-search', 'Aspirin');
    await page.waitForTimeout(500);
    
    const narrowedResults = await page.locator('#medication-dropdown [role="option"]').count();
    console.log(`   Results after typing "Aspirin": ${narrowedResults}`);
    console.log(`   ❌ ISSUE: Typing not narrowing results` + 
                (initialResults === narrowedResults ? ' - CONFIRMED' : ' - NOT REPRODUCED'));
    
    // Test Tab navigation
    console.log('\n2. Testing Tab navigation...');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(100);
    
    // Check focus location
    let focusedElement = await page.evaluate(() => {
      const el = document.activeElement;
      return {
        id: el?.id,
        className: el?.className,
        tagName: el?.tagName,
        isInDropdown: el?.closest('#medication-dropdown') !== null
      };
    });
    console.log(`   After 1st Tab - Focus on:`, focusedElement);
    
    // Press Tab multiple times and track focus
    const tabSequence = [];
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Tab');
      await page.waitForTimeout(100);
      
      focusedElement = await page.evaluate(() => {
        const el = document.activeElement;
        return {
          id: el?.id,
          className: el?.className,
          tagName: el?.tagName,
          text: el?.textContent?.substring(0, 30),
          isInDropdown: el?.closest('#medication-dropdown') !== null
        };
      });
      
      tabSequence.push(focusedElement);
      console.log(`   After Tab #${i + 2}:`, focusedElement);
    }
    
    // Check if focus escaped dropdown
    const escapedDropdown = tabSequence.some(el => !el.isInDropdown);
    console.log(`   ❌ ISSUE: Tab escapes dropdown - ${escapedDropdown ? 'CONFIRMED' : 'NOT REPRODUCED'}`);
    
    // Check if dropdown stayed open
    const dropdownStillOpen = await page.isVisible('#medication-dropdown');
    console.log(`   Dropdown still open: ${dropdownStillOpen}`);
    
    // Test Arrow Keys
    console.log('\n3. Testing Arrow Keys...');
    // Reset focus to input
    await page.click('#medication-search');
    
    // Try arrow down
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(100);
    
    const afterArrowDown = await page.evaluate(() => {
      const highlighted = document.querySelector('#medication-dropdown [aria-selected="true"]');
      return {
        found: !!highlighted,
        text: highlighted?.textContent
      };
    });
    console.log(`   After ArrowDown:`, afterArrowDown);
    console.log(`   ❌ ISSUE: Arrow keys not working - ${!afterArrowDown.found ? 'CONFIRMED' : 'NOT REPRODUCED'}`);
    
    // Test Shift+Tab
    console.log('\n4. Testing Shift+Tab...');
    await page.keyboard.press('Shift+Tab');
    await page.waitForTimeout(100);
    
    focusedElement = await page.evaluate(() => {
      const el = document.activeElement;
      return {
        id: el?.id,
        isInDropdown: el?.closest('#medication-dropdown') !== null,
        isInModal: el?.closest('[data-testid="add-new-prescribed-medication-modal"]') !== null
      };
    });
    console.log(`   After Shift+Tab:`, focusedElement);
    console.log(`   ❌ ISSUE: Shift+Tab exits focus trap - ${!focusedElement.isInDropdown ? 'CONFIRMED' : 'NOT REPRODUCED'}`);
    
    const dropdownOpenAfterShiftTab = await page.isVisible('#medication-dropdown');
    console.log(`   Dropdown still open: ${dropdownOpenAfterShiftTab}`);
    
    // Test Escape Key
    console.log('\n5. Testing Escape Key...');
    await page.click('#medication-search');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    
    const modalStillOpen = await page.isVisible('[data-testid="add-new-prescribed-medication-modal"]');
    const dropdownClosed = !(await page.isVisible('#medication-dropdown'));
    
    console.log(`   Modal still open: ${modalStillOpen}`);
    console.log(`   Dropdown closed: ${dropdownClosed}`);
    console.log(`   ❌ ISSUE: Escape closes entire modal - ${!modalStillOpen ? 'CONFIRMED' : 'NOT REPRODUCED'}`);
    
    // Log all captured console messages
    console.log('\n=== Browser Console Summary ===');
    const focusLogs = consoleLogger.getLogsContaining('[UAT-FOCUS]');
    const keyLogs = consoleLogger.getLogsContaining('[UAT-KEY]');
    console.log(`Total focus changes: ${focusLogs.length}`);
    console.log(`Total key presses tracked: ${keyLogs.length}`);
  });
  
  test('AutocompleteDropdown - Focus Trap Behavior (Baseline)', async ({ page }) => {
    console.log('\n=== Testing AutocompleteDropdown Focus Trap (Baseline) ===\n');
    
    // Navigate to a page with AutocompleteDropdown (adjust as needed)
    await page.goto('http://localhost:3456');
    
    // Open medication modal
    await page.click('button:has-text("Add Medication")');
    
    // First select a medication to show dosage form
    await page.fill('#medication-search', 'Aspirin');
    await page.waitForTimeout(500);
    await page.keyboard.press('Enter'); // Select first result
    await page.click('#medication-continue-button');
    
    // Now test AutocompleteDropdown in dosage form (e.g., Unit dropdown)
    console.log('1. Testing Unit dropdown (AutocompleteDropdown)...');
    
    // Click on unit input to open dropdown
    await page.click('#dosage-unit-input');
    await page.waitForTimeout(100);
    
    // Type to filter
    await page.fill('#dosage-unit-input', 'm');
    await page.waitForTimeout(100);
    
    const unitDropdownVisible = await page.isVisible('[data-testid="dosage-unit-dropdown"]');
    console.log(`   Dropdown visible: ${unitDropdownVisible}`);
    
    // Test Tab behavior
    console.log('\n2. Testing Tab in AutocompleteDropdown...');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(100);
    
    let focusedElement = await page.evaluate(() => {
      const el = document.activeElement;
      return {
        id: el?.id,
        className: el?.className,
        tagName: el?.tagName
      };
    });
    console.log(`   After Tab:`, focusedElement);
    console.log(`   ✓ Expected: Tab should move focus to next field (auto-selecting if match exists)`);
    
    // Check if dropdown closed
    const dropdownClosedAfterTab = !(await page.isVisible('[data-testid="dosage-unit-dropdown"]'));
    console.log(`   Dropdown closed after Tab: ${dropdownClosedAfterTab}`);
    
    // Test Arrow Keys
    console.log('\n3. Testing Arrow Keys in AutocompleteDropdown...');
    await page.click('#dosage-unit-input');
    await page.fill('#dosage-unit-input', 'm');
    await page.waitForTimeout(100);
    
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(100);
    
    const highlightedItem = await page.evaluate(() => {
      const highlighted = document.querySelector('[data-testid="dosage-unit-dropdown"] .highlighted-item');
      return {
        found: !!highlighted,
        text: highlighted?.textContent
      };
    });
    console.log(`   After ArrowDown:`, highlightedItem);
    console.log(`   ✓ Expected: Arrow keys should navigate through options`);
    
    // Test Escape
    console.log('\n4. Testing Escape in AutocompleteDropdown...');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    
    const modalStillOpenAfterEscape = await page.isVisible('[data-testid="add-new-prescribed-medication-modal"]');
    const dropdownClosedAfterEscape = !(await page.isVisible('[data-testid="dosage-unit-dropdown"]'));
    
    console.log(`   Modal still open: ${modalStillOpenAfterEscape}`);
    console.log(`   Dropdown closed: ${dropdownClosedAfterEscape}`);
    console.log(`   ✓ Expected: Escape should only close dropdown, not modal`);
  });
  
  test('Side-by-side Comparison Summary', async ({ page }) => {
    console.log('\n=== COMPARISON SUMMARY ===\n');
    console.log('SearchableDropdown Issues:');
    console.log('1. ❌ Typing does not narrow down results');
    console.log('2. ❌ Tab alternates between dropdown items and external elements');
    console.log('3. ❌ Arrow keys do not work for navigation');
    console.log('4. ❌ Shift+Tab exits focus trap while dropdown stays open');
    console.log('5. ❌ Escape closes entire modal instead of just dropdown');
    console.log('\nAutocompleteDropdown Expected Behavior:');
    console.log('1. ✓ Tab moves focus to next field (with auto-select)');
    console.log('2. ✓ Arrow keys navigate through options');
    console.log('3. ✓ Escape closes only the dropdown');
    console.log('4. ✓ Consistent soft focus trap behavior');
    
    // Add diagnostic injection to track focus behavior
    await page.goto('http://localhost:3456');
    await page.evaluate(() => {
      console.log('[UAT-DIAGNOSTIC] Focus trap comparison complete');
      console.log('[UAT-DIAGNOSTIC] SearchableDropdown needs alignment with AutocompleteDropdown behavior');
    });
  });
});