import { test, expect } from '@playwright/test';

test('Test SearchableDropdown focus trap issues', async ({ page }) => {
  console.log('\n=== Testing SearchableDropdown Focus Trap ===\n');
  
  // Add console logging for debugging
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('UAT-') || text.includes('useTabAsArrows') || text.includes('FocusBehavior')) {
      console.log(`[Browser]:`, text);
    }
  });
  
  // Inject logging
  await page.addInitScript(() => {
    document.addEventListener('focusin', (e) => {
      const target = e.target as Element;
      const id = target.id || '';
      if (id.includes('medication') || target.closest('#medication-dropdown')) {
        console.log(`[UAT-FOCUS] Focus: #${id || target.tagName}`);
      }
    }, true);
    
    document.addEventListener('keydown', (e) => {
      const target = e.target as Element;
      if (target.id?.includes('medication') || target.closest('#medication-dropdown')) {
        console.log(`[UAT-KEY] "${e.key}" on #${target.id || target.tagName}, prevented: ${e.defaultPrevented}`);
      }
    }, true);
  });
  
  // Step 1: Navigate to app
  await page.goto('http://localhost:3456');
  await page.waitForLoadState('networkidle');
  console.log('✓ Page loaded');
  
  // Step 2: Click on a client card (they are DIVs with client info)
  console.log('Selecting client...');
  // Click on John Smith (first client)
  await page.locator('text="John Smith"').click();
  console.log('✓ Clicked on John Smith');
  
  await page.waitForTimeout(500);
  
  // Step 3: Look for Add Medication button (should appear after client selection)
  console.log('Looking for Add Medication button...');
  await page.waitForSelector('button:has-text("Add Medication")', { timeout: 5000 });
  await page.locator('button:has-text("Add Medication")').click();
  console.log('✓ Clicked Add Medication');
  
  await page.waitForTimeout(300);
  
  // Step 4: Select "Prescribed Medication" from dropdown
  console.log('Selecting Prescribed Medication...');
  await page.locator('text="Prescribed Medication"').click();
  console.log('✓ Selected Prescribed Medication');
  
  // Wait for medication modal
  await page.waitForSelector('#medication-search', { timeout: 5000 });
  console.log('✓ Medication search modal opened');
  
  // Now test the SearchableDropdown issues
  console.log('\n=== Testing Focus Trap Issues ===\n');
  
  const searchInput = page.locator('input#medication-search');
  
  // Issue 1: Test typing and filtering
  console.log('1. Testing search filtering with "lo" for Lorazepam...');
  await searchInput.fill('lo');
  await page.waitForTimeout(600); // Wait for debounce
  
  // Wait for dropdown to appear
  await page.waitForSelector('#medication-dropdown', { timeout: 2000 }).catch(() => {
    console.log('   Dropdown did not appear within 2 seconds');
  });
  
  const dropdownVisible = await page.locator('#medication-dropdown').isVisible();
  console.log(`   Dropdown visible: ${dropdownVisible}`);
  
  if (dropdownVisible) {
    // Get all results
    const results = await page.locator('#medication-dropdown [role="option"]').all();
    console.log(`   Results for "lo": ${results.length}`);
    
    // Log first 3 results
    for (let i = 0; i < Math.min(3, results.length); i++) {
      const text = await results[i].textContent();
      console.log(`     - ${text?.trim().substring(0, 50)}`);
    }
    
    // Type more to see if it narrows
    await searchInput.fill('loraz');
    await page.waitForTimeout(600);
    
    const narrowedCount = await page.locator('#medication-dropdown [role="option"]').count();
    console.log(`   Results for "loraz": ${narrowedCount}`);
    
    if (results.length === narrowedCount && results.length > 1) {
      console.log('   ❌ ISSUE: Typing does not narrow results');
    } else {
      console.log('   ✓ Results narrow correctly');
    }
  }
  
  // Issue 2: Test Tab behavior
  console.log('\n2. Testing Tab navigation (with enableTabAsArrows=true)...');
  await searchInput.clear();
  await searchInput.fill('lo');
  await page.waitForTimeout(600);
  
  console.log('   Pressing Tab 5 times...');
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Tab');
    await page.waitForTimeout(100);
    
    const focusInfo = await page.evaluate(() => {
      const el = document.activeElement;
      return {
        id: el?.id || el?.tagName || 'unknown',
        inDropdown: el?.closest('#medication-dropdown') !== null,
        inModal: el?.closest('[data-testid="add-new-prescribed-medication-modal"]') !== null,
        text: (el?.textContent || '').substring(0, 20).trim()
      };
    });
    
    console.log(`     Tab ${i + 1}: ${focusInfo.id} (dropdown: ${focusInfo.inDropdown}, text: "${focusInfo.text}")`);
    
    if (!focusInfo.inDropdown && i < 3) {
      console.log('   ❌ ISSUE: Tab escaped dropdown too early');
      break;
    }
  }
  
  // Issue 3: Test Arrow Keys
  console.log('\n3. Testing Arrow Keys...');
  await searchInput.focus();
  await searchInput.clear();
  await searchInput.fill('lo');
  await page.waitForTimeout(600);
  
  // Check initial state
  const beforeArrow = await page.evaluate(() => {
    const highlighted = document.querySelector('#medication-dropdown [aria-selected="true"]');
    return {
      found: !!highlighted,
      text: highlighted?.textContent?.trim().substring(0, 30) || 'none'
    };
  });
  console.log(`   Before ArrowDown: ${beforeArrow.text}`);
  
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(100);
  
  const afterArrow = await page.evaluate(() => {
    const highlighted = document.querySelector('#medication-dropdown [aria-selected="true"]');
    return {
      found: !!highlighted,
      text: highlighted?.textContent?.trim().substring(0, 30) || 'none'
    };
  });
  console.log(`   After ArrowDown: ${afterArrow.text}`);
  
  if (!afterArrow.found || afterArrow.text === beforeArrow.text) {
    console.log('   ❌ ISSUE: Arrow keys not working');
  } else {
    console.log('   ✓ Arrow keys work');
  }
  
  // Issue 4: Test Shift+Tab
  console.log('\n4. Testing Shift+Tab...');
  await searchInput.focus();
  
  await page.keyboard.press('Shift+Tab');
  await page.waitForTimeout(100);
  
  const afterShiftTab = await page.evaluate(() => {
    const el = document.activeElement;
    return {
      id: el?.id || el?.tagName || 'unknown',
      inDropdown: el?.closest('#medication-dropdown') !== null,
      dropdownStillVisible: !!document.querySelector('#medication-dropdown')
    };
  });
  
  console.log(`   After Shift+Tab: focus on ${afterShiftTab.id}`);
  console.log(`   Focus in dropdown: ${afterShiftTab.inDropdown}`);
  console.log(`   Dropdown still visible: ${afterShiftTab.dropdownStillVisible}`);
  
  if (!afterShiftTab.inDropdown && afterShiftTab.dropdownStillVisible) {
    console.log('   ❌ ISSUE: Shift+Tab exits focus trap while dropdown stays open');
  }
  
  // Issue 5: Test Escape Key
  console.log('\n5. Testing Escape Key...');
  await searchInput.focus();
  await searchInput.clear();
  await searchInput.fill('lo');
  await page.waitForTimeout(600);
  
  const beforeEscape = {
    modal: await page.locator('[data-testid="add-new-prescribed-medication-modal"]').isVisible(),
    dropdown: await page.locator('#medication-dropdown').isVisible()
  };
  
  console.log(`   Before Escape: modal=${beforeEscape.modal}, dropdown=${beforeEscape.dropdown}`);
  
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500); // Give more time for React to update
  
  const afterEscape = {
    modal: await page.locator('[data-testid="add-new-prescribed-medication-modal"]').isVisible(),
    dropdown: await page.locator('#medication-dropdown').isVisible()
  };
  
  console.log(`   After Escape: modal=${afterEscape.modal}, dropdown=${afterEscape.dropdown}`);
  
  if (!afterEscape.modal && beforeEscape.modal) {
    console.log('   ❌ ISSUE: Escape closes entire modal (should only close dropdown)');
  } else if (!afterEscape.dropdown && afterEscape.modal) {
    console.log('   ✓ Escape correctly closed only dropdown');
  }
  
  console.log('\n=== Test Complete ===');
  console.log('Issues confirmed are marked with ❌');
  console.log('SearchableDropdown should behave like AutocompleteDropdown:');
  console.log('- When enableTabAsArrows=true, Tab should navigate items');
  console.log('- Arrow keys should always work');
  console.log('- Escape should only close the dropdown');
});