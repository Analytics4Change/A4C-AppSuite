import { test, expect } from '@playwright/test';

test('Test isolated FocusBehaviorProvider', async ({ page }) => {
  console.log('\n=== Testing Isolated FocusBehaviorProvider ===\n');
  
  // Add detailed console logging
  page.on('console', msg => {
    const text = msg.text();
    console.log(`[Browser ${msg.type()}]:`, text);
  });
  
  // Navigate and open medication modal
  await page.goto('http://localhost:3456');
  await page.waitForLoadState('networkidle');
  
  // Select client
  await page.locator('text="John Smith"').click();
  await page.waitForTimeout(500);
  
  // Click Add Medication
  await page.locator('button:has-text("Add Medication")').click();
  await page.waitForTimeout(300);
  
  // Select Prescribed Medication
  await page.locator('text="Prescribed Medication"').click();
  await page.waitForSelector('#medication-search');
  
  console.log('✓ Medication modal opened');
  
  // Add logging to check context
  await page.evaluate(() => {
    console.log('[TEST] Checking for nested FocusBehaviorProvider...');
    
    // Check if SearchableDropdown has its own context
    const searchInput = document.querySelector('input#medication-search');
    if (searchInput) {
      console.log('[TEST] Found search input');
      
      // Try to trigger dropdown
      const event = new Event('input', { bubbles: true });
      searchInput.dispatchEvent(event);
    }
  });
  
  // Type to open dropdown
  const searchInput = page.locator('input#medication-search');
  await searchInput.click(); // Focus the input first
  await searchInput.fill('lo');
  await page.waitForTimeout(1000); // Longer wait for search results
  
  // Check if dropdown is visible
  const dropdownVisible = await page.locator('#medication-dropdown').isVisible();
  console.log(`Dropdown visible: ${dropdownVisible}`);
  
  if (dropdownVisible) {
    // Now test Tab behavior
    console.log('Testing Tab with isolated context...');
    
    // Get initial highlighted index
    const initialHighlight = await page.evaluate(() => {
      const highlighted = document.querySelector('#medication-dropdown .bg-blue-50');
      return highlighted?.id || 'none';
    });
    
    await page.keyboard.press('Tab');
    await page.waitForTimeout(100);
    
    const afterTabInfo = await page.evaluate(() => {
      const el = document.activeElement;
      const highlighted = document.querySelector('#medication-dropdown .bg-blue-50');
      const ariaActiveDescendant = el?.getAttribute('aria-activedescendant');
      return {
        focusId: el?.id || el?.tagName || 'unknown',
        focusStillOnInput: el?.id === 'medication-search',
        highlightedOption: highlighted?.id || 'none',
        ariaActiveDescendant: ariaActiveDescendant || 'none'
      };
    });
    
    console.log(`After Tab: focus on ${afterTabInfo.focusId}, highlighted: ${afterTabInfo.highlightedOption}`);
    console.log(`aria-activedescendant: ${afterTabInfo.ariaActiveDescendant}`);
    
    // In proper Tab-as-arrows behavior:
    // 1. Focus should stay on the input
    // 2. The highlighted option should change (move to next)
    // 3. aria-activedescendant should update
    if (afterTabInfo.focusStillOnInput && 
        afterTabInfo.highlightedOption !== initialHighlight &&
        afterTabInfo.ariaActiveDescendant === afterTabInfo.highlightedOption) {
      console.log('✓ SUCCESS: Tab-as-arrows working (focus on input, highlight moved)');
    } else if (!afterTabInfo.focusStillOnInput) {
      console.log('❌ FAILED: Tab moved focus away from input');
    } else {
      console.log('❌ FAILED: Tab did not move highlight to next option');
    }
  } else {
    console.log('❌ Dropdown not visible - cannot test Tab behavior');
  }
});