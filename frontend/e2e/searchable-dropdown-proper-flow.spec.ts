import { test, expect } from '@playwright/test';

test.describe('SearchableDropdown Focus Behavior - Proper Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Add console logging
    page.on('console', msg => {
      const text = msg.text();
      if (text.includes('UAT-') || text.includes('useTabAsArrows') || text.includes('FocusBehavior')) {
        console.log(`[Browser ${msg.type()}]:`, text);
      }
    });
    
    // Inject UAT logging
    await page.addInitScript(() => {
      // Track focus changes
      document.addEventListener('focusin', (e) => {
        const target = e.target as Element;
        const id = target.id || 'no-id';
        const className = (target.className || 'no-class').toString().substring(0, 50);
        console.log(`[UAT-FOCUS] Focus moved to: #${id} (${className})`);
      }, true);
      
      // Track key presses on important elements
      document.addEventListener('keydown', (e) => {
        const target = e.target as Element;
        if (target.id?.includes('medication') || target.closest('#medication-dropdown')) {
          const id = target.id || 'no-id';
          console.log(`[UAT-KEY] Key "${e.key}" on #${id}, Shift: ${e.shiftKey}, prevented: ${e.defaultPrevented}`);
        }
      }, true);
    });
  });
  
  test('Navigate to medication search and test focus trap behaviors', async ({ page }) => {
    console.log('\n=== Testing SearchableDropdown with Proper Navigation Flow ===\n');
    
    // Step 1: Navigate to the app
    await page.goto('http://localhost:3456');
    await page.waitForLoadState('networkidle');
    console.log('✓ Page loaded');
    
    // Step 2: Select a client
    console.log('\nStep 1: Selecting a client...');
    // Wait for client selector to be available
    // Try multiple possible selectors
    const clientSelectors = [
      'select',  // if it's a select dropdown
      '[data-testid*="client"]',  // if it has a client testid
      'input[placeholder*="client" i]',  // if it's an input with client placeholder
      'button:has-text("Select Client")',  // if it's a button
      '.client-selector',  // if it has a class
    ];
    
    let clientSelected = false;
    for (const selector of clientSelectors) {
      try {
        const element = await page.locator(selector).first();
        if (await element.count() > 0) {
          // If it's a select, choose first option
          if (selector === 'select') {
            await element.selectOption({ index: 1 });
            console.log('  ✓ Selected client from dropdown');
          } else {
            await element.click();
            // If clicking opens a dropdown, select first item
            await page.locator('[role="option"]').first().click().catch(() => {});
            console.log('  ✓ Selected client');
          }
          clientSelected = true;
          break;
        }
      } catch (e) {
        // Try next selector
      }
    }
    
    if (!clientSelected) {
      // Try clicking the first available interactive element that might be a client
      await page.locator('button, [role="button"]').first().click();
      console.log('  ⚠ Clicked first button (assuming client selection)');
    }
    
    await page.waitForTimeout(500); // Wait for any transitions
    
    // Step 3: Click "Add Medication"
    console.log('\nStep 2: Clicking Add Medication...');
    const addMedicationButton = await page.locator('button:has-text("Add Medication")').first();
    if (await addMedicationButton.count() > 0) {
      await addMedicationButton.click();
      console.log('  ✓ Clicked Add Medication button');
    } else {
      // Try alternative text
      await page.locator('button').filter({ hasText: /add/i }).first().click();
      console.log('  ⚠ Clicked Add button');
    }
    
    await page.waitForTimeout(300);
    
    // Step 4: Select "Prescribed Medication" from dropdown
    console.log('\nStep 3: Selecting Prescribed Medication...');
    const prescribedOption = await page.locator('text="Prescribed Medication"').first();
    if (await prescribedOption.count() > 0) {
      await prescribedOption.click();
      console.log('  ✓ Selected Prescribed Medication');
    } else {
      // Try clicking first option in any visible dropdown
      await page.locator('[role="option"], .dropdown-item').first().click();
      console.log('  ⚠ Selected first dropdown option');
    }
    
    // Wait for medication modal to appear
    await page.waitForSelector('#medication-search', { timeout: 5000 });
    console.log('  ✓ Medication search modal opened');
    
    // Now test the SearchableDropdown behaviors
    console.log('\n=== Testing SearchableDropdown Focus Trap Issues ===\n');
    
    const searchInput = page.locator('#medication-search');
    
    // Issue 1: Test typing and filtering
    console.log('1. Testing if typing "lo" for Lorazepam narrows results...');
    await searchInput.fill('lo');
    await page.waitForTimeout(600); // Wait for debounce
    
    const dropdownVisible = await page.locator('#medication-dropdown').isVisible();
    console.log(`   Dropdown visible: ${dropdownVisible}`);
    
    if (dropdownVisible) {
      const results = await page.locator('#medication-dropdown [role="option"]').all();
      console.log(`   Results found: ${results.length}`);
      
      // Check first few results
      for (let i = 0; i < Math.min(3, results.length); i++) {
        const text = await results[i].textContent();
        console.log(`   - Result ${i + 1}: ${text?.substring(0, 50)}`);
      }
      
      // Now type more
      await searchInput.fill('loraz');
      await page.waitForTimeout(600);
      
      const narrowedResults = await page.locator('#medication-dropdown [role="option"]').count();
      console.log(`   Results after typing "loraz": ${narrowedResults}`);
      
      if (results.length === narrowedResults && results.length > 1) {
        console.log('   ❌ ISSUE CONFIRMED: Typing does not narrow results');
      }
    }
    
    // Issue 2: Test Tab behavior with enableTabAsArrows
    console.log('\n2. Testing Tab navigation (should use arrows with enableTabAsArrows=true)...');
    await searchInput.clear();
    await searchInput.fill('lo');
    await page.waitForTimeout(600);
    
    // Track Tab presses
    const tabSequence = [];
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Tab');
      await page.waitForTimeout(100);
      
      const focusInfo = await page.evaluate(() => {
        const el = document.activeElement;
        const dropdownItem = el?.closest('[role="option"]');
        return {
          id: el?.id || '',
          className: (el?.className || '').toString().substring(0, 30),
          tagName: el?.tagName || '',
          isInDropdown: el?.closest('#medication-dropdown') !== null,
          isDropdownItem: !!dropdownItem,
          itemText: dropdownItem?.textContent?.substring(0, 30) || '',
          ariaSelected: el?.getAttribute('aria-selected') || ''
        };
      });
      
      tabSequence.push(focusInfo);
      console.log(`   Tab ${i + 1}: ${focusInfo.id || focusInfo.tagName} (inDropdown: ${focusInfo.isInDropdown}, item: "${focusInfo.itemText}")`);
    }
    
    // Check for alternating behavior
    const escapesDropdown = tabSequence.some(item => !item.isInDropdown);
    if (escapesDropdown) {
      console.log('   ❌ ISSUE CONFIRMED: Tab escapes dropdown (should navigate items like arrows)');
    }
    
    // Issue 3: Test Arrow Keys
    console.log('\n3. Testing Arrow Keys...');
    await searchInput.focus();
    await searchInput.clear();
    await searchInput.fill('lo');
    await page.waitForTimeout(600);
    
    // Get initial state
    const beforeArrow = await page.evaluate(() => {
      const highlighted = document.querySelector('#medication-dropdown [aria-selected="true"]');
      return highlighted?.textContent?.substring(0, 30) || 'none';
    });
    console.log(`   Before ArrowDown: highlighted = "${beforeArrow}"`);
    
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(100);
    
    const afterArrow = await page.evaluate(() => {
      const highlighted = document.querySelector('#medication-dropdown [aria-selected="true"]');
      return highlighted?.textContent?.substring(0, 30) || 'none';
    });
    console.log(`   After ArrowDown: highlighted = "${afterArrow}"`);
    
    if (beforeArrow === afterArrow && afterArrow === 'none') {
      console.log('   ❌ ISSUE CONFIRMED: Arrow keys do not work');
    }
    
    // Issue 4: Test Shift+Tab
    console.log('\n4. Testing Shift+Tab behavior...');
    await searchInput.focus();
    
    const beforeShiftTab = await page.evaluate(() => ({
      focused: document.activeElement?.id || document.activeElement?.tagName || '',
      dropdownOpen: !!document.querySelector('#medication-dropdown')
    }));
    
    await page.keyboard.press('Shift+Tab');
    await page.waitForTimeout(100);
    
    const afterShiftTab = await page.evaluate(() => ({
      focused: document.activeElement?.id || document.activeElement?.tagName || '',
      isInDropdown: document.activeElement?.closest('#medication-dropdown') !== null,
      dropdownOpen: !!document.querySelector('#medication-dropdown')
    }));
    
    console.log(`   Before: focus="${beforeShiftTab.focused}", dropdown=${beforeShiftTab.dropdownOpen}`);
    console.log(`   After: focus="${afterShiftTab.focused}", inDropdown=${afterShiftTab.isInDropdown}, dropdown=${afterShiftTab.dropdownOpen}`);
    
    if (!afterShiftTab.isInDropdown && afterShiftTab.dropdownOpen) {
      console.log('   ❌ ISSUE CONFIRMED: Shift+Tab exits focus trap but dropdown stays open');
    }
    
    // Issue 5: Test Escape Key
    console.log('\n5. Testing Escape Key behavior...');
    await searchInput.focus();
    await searchInput.clear();
    await searchInput.fill('lo');
    await page.waitForTimeout(600);
    
    const beforeEscape = await page.evaluate(() => ({
      modalOpen: !!document.querySelector('[data-testid="add-new-prescribed-medication-modal"]'),
      dropdownOpen: !!document.querySelector('#medication-dropdown')
    }));
    
    console.log(`   Before Escape: modal=${beforeEscape.modalOpen}, dropdown=${beforeEscape.dropdownOpen}`);
    
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    
    const afterEscape = await page.evaluate(() => ({
      modalOpen: !!document.querySelector('[data-testid="add-new-prescribed-medication-modal"]'),
      dropdownOpen: !!document.querySelector('#medication-dropdown')
    }));
    
    console.log(`   After Escape: modal=${afterEscape.modalOpen}, dropdown=${afterEscape.dropdownOpen}`);
    
    if (!afterEscape.modalOpen && beforeEscape.modalOpen) {
      console.log('   ❌ ISSUE CONFIRMED: Escape closes entire modal (should only close dropdown)');
    } else if (!afterEscape.dropdownOpen && afterEscape.modalOpen) {
      console.log('   ✓ Escape correctly closed only the dropdown');
    }
    
    console.log('\n=== Summary ===');
    console.log('SearchableDropdown needs to match AutocompleteDropdown behavior:');
    console.log('- Tab should navigate items when enableTabAsArrows=true');
    console.log('- Arrow keys should work for navigation');
    console.log('- Escape should only close dropdown, not modal');
    console.log('- Focus trap should keep Tab within dropdown when open');
  });
});