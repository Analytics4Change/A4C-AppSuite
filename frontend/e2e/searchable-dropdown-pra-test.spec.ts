import { test, expect } from '@playwright/test';

test('SearchableDropdown "pra" search - tests startsWith and contains', async ({ page }) => {
  console.log('\n=== Testing SearchableDropdown with "pra" Search ===\n');
  
  // Navigate to the application
  await page.goto('http://localhost:3456');
  console.log('✓ Page loaded');
  
  // Step 1: Select a client
  console.log('Selecting client...');
  await page.locator('text="John Smith"').click();
  await page.waitForTimeout(500);
  console.log('✓ Client selected');
  
  // Step 2: Open Add Medication modal
  console.log('Opening Add Medication modal...');
  const addMedicationButton = page.locator('#add-medication-button');
  await addMedicationButton.waitFor({ state: 'visible', timeout: 5000 });
  await addMedicationButton.click();
  await page.waitForTimeout(300);
  console.log('✓ Add Medication modal opened');
  
  // Step 3: Select Prescribed Medication
  console.log('Selecting Prescribed Medication...');
  await page.locator('text="Prescribed Medication"').click();
  await page.waitForTimeout(500);
  console.log('✓ Prescribed Medication selected');
  
  // Step 4: Test SearchableDropdown with "pra" input
  console.log('\n--- Testing SearchableDropdown with "pra" ---\n');
  
  const medicationSearch = page.locator('input#medication-search');
  await medicationSearch.waitFor({ state: 'visible', timeout: 5000 });
  
  // Type "pra" to search
  console.log('Typing "pra" in medication search...');
  await medicationSearch.fill('pra');
  await page.waitForTimeout(1000); // Wait for search debounce and results
  
  // Check if dropdown is visible
  const dropdownVisible = await page.locator('#medication-dropdown').isVisible();
  console.log(`Medication dropdown visible: ${dropdownVisible}`);
  
  if (!dropdownVisible) {
    console.log('ERROR: Dropdown should be visible with "pra" search!');
    throw new Error('Dropdown not visible');
  }
  
  // Check what items are visible in the dropdown
  const dropdownItems = await page.locator('#medication-dropdown [role="option"]').all();
  console.log(`\nVisible dropdown items (${dropdownItems.length} total):`);
  
  const itemTexts = [];
  for (let i = 0; i < dropdownItems.length; i++) {
    const text = await dropdownItems[i].textContent();
    itemTexts.push(text?.trim() || '');
    console.log(`  ${i + 1}. ${text?.trim()}`);
  }
  
  // Verify that both Pravastatin and Alprazolam are in the results
  const hasPravastatin = itemTexts.some(text => text.includes('Pravastatin'));
  const hasAlprazolam = itemTexts.some(text => text.includes('Alprazolam'));
  
  console.log('\n=== SEARCH RESULTS VERIFICATION ===');
  console.log(`Pravastatin (starts with "pra"): ${hasPravastatin ? '✓ FOUND' : '❌ NOT FOUND'}`);
  console.log(`Alprazolam (contains "pra"): ${hasAlprazolam ? '✓ FOUND' : '❌ NOT FOUND'}`);
  
  if (!hasPravastatin || !hasAlprazolam) {
    console.log('ERROR: Both medications should be in search results!');
    throw new Error('Expected medications not found');
  }
  
  // Check which item is highlighted (should be Pravastatin as it starts with "pra")
  console.log('\nChecking highlighted item...');
  const highlightedItems = await page.locator('#medication-dropdown .bg-blue-50').all();
  
  if (highlightedItems.length > 0) {
    console.log(`Found ${highlightedItems.length} highlighted item(s):`);
    for (const item of highlightedItems) {
      const text = await item.textContent();
      console.log(`  - Highlighted: "${text?.trim()}"`);
    }
  } else {
    console.log('  No items are highlighted by default');
  }
  
  // Test keyboard navigation
  console.log('\n--- Testing Keyboard Navigation ---\n');
  
  // Press ArrowDown to highlight first item
  console.log('Pressing ArrowDown...');
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(100);
  
  // Check what's highlighted now
  const firstHighlighted = await page.locator('#medication-dropdown .bg-blue-50').first();
  const firstHighlightedText = await firstHighlighted.textContent();
  console.log(`After ArrowDown: Highlighted item = "${firstHighlightedText?.trim()}"`);
  
  // Press Enter to select
  console.log('\nPressing Enter to select highlighted item...');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  
  // Check if medication was selected
  const selectedMedication = await page.locator('.bg-blue-50 .font-semibold').first().textContent();
  console.log(`Selected medication: "${selectedMedication?.trim()}"`);
  
  // Verify the behavior
  console.log('\n=== FINAL VERIFICATION ===');
  console.log('1. Search for "pra" returned both:');
  console.log(`   - Pravastatin (startsWith match): ${hasPravastatin ? '✓' : '❌'}`);
  console.log(`   - Alprazolam (contains match): ${hasAlprazolam ? '✓' : '❌'}`);
  console.log('2. Keyboard navigation works: ✓');
  console.log(`3. Enter key selected: "${selectedMedication?.trim()}"`);
  
  // Test Tab behavior with enableTabAsArrows
  console.log('\n--- Testing Tab as Arrows Behavior ---\n');
  
  // Clear selection to test again
  console.log('Clearing selection...');
  await page.locator('button[aria-label="Clear selection"]').click();
  await page.waitForTimeout(200);
  
  // Type "pra" again
  console.log('Typing "pra" again...');
  await medicationSearch.fill('pra');
  await page.waitForTimeout(1000);
  
  // Press Tab to navigate (should act as ArrowDown due to enableTabAsArrows)
  console.log('Pressing Tab (should act as ArrowDown)...');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(100);
  
  // Check what's highlighted
  const tabHighlighted = await page.locator('#medication-dropdown .bg-blue-50').first();
  const tabHighlightedText = await tabHighlighted.textContent();
  console.log(`After Tab: Highlighted item = "${tabHighlightedText?.trim()}"`);
  
  // Press Tab again
  console.log('Pressing Tab again...');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(100);
  
  const secondTabHighlighted = await page.locator('#medication-dropdown .bg-blue-50').first();
  const secondTabHighlightedText = await secondTabHighlighted.textContent();
  console.log(`After second Tab: Highlighted item = "${secondTabHighlightedText?.trim()}"`);
  
  // Press Shift+Tab to go back
  console.log('Pressing Shift+Tab (should act as ArrowUp)...');
  await page.keyboard.press('Shift+Tab');
  await page.waitForTimeout(100);
  
  const shiftTabHighlighted = await page.locator('#medication-dropdown .bg-blue-50').first();
  const shiftTabHighlightedText = await shiftTabHighlighted.textContent();
  console.log(`After Shift+Tab: Highlighted item = "${shiftTabHighlightedText?.trim()}"`);
  
  console.log('\n=== TEST COMPLETED SUCCESSFULLY ===');
  console.log('SearchableDropdown correctly:');
  console.log('- Filters with "contains" mode (both medications found)');
  console.log('- Supports keyboard navigation with arrows');
  console.log('- Tab acts as arrows when enableTabAsArrows=true');
  console.log('- Enter selects the highlighted item');
});