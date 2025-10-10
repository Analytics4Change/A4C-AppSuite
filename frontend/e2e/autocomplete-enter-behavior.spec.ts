import { test, expect } from '@playwright/test';

test('AutocompleteDropdown Enter key behavior - Type field with "tab" search', async ({ page }) => {
  console.log('\n=== Testing AutocompleteDropdown Enter Key Behavior ===\n');
  
  // Navigate to the application
  await page.goto('http://localhost:3456');
  console.log('✓ Page loaded');
  
  // Step 1: Select a client
  console.log('Selecting client...');
  // Use the same selector that worked in previous tests
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
  
  // Step 4: Select a medication to proceed to dosage form
  console.log('Selecting a medication...');
  const medicationSearch = page.locator('input#medication-search');
  await medicationSearch.waitFor({ state: 'visible', timeout: 5000 });
  
  // Type to search for medication
  await medicationSearch.fill('lo');
  await page.waitForTimeout(1000); // Wait for search debounce and results
  
  // Check if dropdown is visible
  const dropdownVisible = await page.locator('#medication-dropdown').isVisible();
  console.log(`Medication dropdown visible: ${dropdownVisible}`);
  
  if (!dropdownVisible) {
    console.log('Dropdown not visible, trying to type more...');
    await medicationSearch.clear();
    await medicationSearch.fill('aspirin');
    await page.waitForTimeout(1000);
  }
  
  // Select first medication result using a more flexible selector
  const firstMedication = page.locator('#medication-dropdown >> div[role="option"]').first();
  await firstMedication.click();
  console.log('✓ Medication selected');
  
  // Click Continue to proceed to dosage form
  const continueButton = page.locator('#medication-continue-button');
  await continueButton.waitFor({ state: 'visible', timeout: 5000 });
  await continueButton.click();
  await page.waitForTimeout(500);
  console.log('✓ Proceeded to dosage form');
  
  // Step 5: Select "Solid" as Dosage Form Category
  console.log('\n--- Testing Type Field Dropdown ---\n');
  console.log('Selecting "Solid" as Dosage Form Category...');
  
  const categoryInput = page.locator('#dosage-category');
  await categoryInput.waitFor({ state: 'visible', timeout: 5000 });
  await categoryInput.click();
  await categoryInput.fill('Solid');
  await page.waitForTimeout(200);
  
  // Select "Solid" from dropdown
  const solidOption = page.locator('[data-testid="dosage-category-dropdown"] >> text="Solid"').first();
  await solidOption.waitFor({ state: 'visible', timeout: 3000 });
  await solidOption.click();
  console.log('✓ Selected "Solid" category');
  
  // Step 6: Test Type field with "tab" input
  console.log('\nTesting Type field with "tab" input...');
  
  const typeInput = page.locator('#form-type');
  await typeInput.waitFor({ state: 'visible', timeout: 5000 });
  await typeInput.click();
  await typeInput.fill('tab');
  await page.waitForTimeout(300); // Wait for dropdown to populate
  
  // Check what items are visible in the dropdown
  const dropdownItems = await page.locator('[data-testid="form-type-dropdown"] [role="option"]').all();
  console.log(`\nVisible dropdown items (${dropdownItems.length} total):`);
  
  const itemTexts = [];
  for (let i = 0; i < dropdownItems.length; i++) {
    const text = await dropdownItems[i].textContent();
    itemTexts.push(text?.trim() || '');
    console.log(`  ${i + 1}. ${text?.trim()}`);
  }
  
  // Check which item is highlighted
  console.log('\nChecking highlighted item...');
  const highlightedItems = await page.locator('[data-testid="form-type-dropdown"] .bg-blue-50').all();
  
  if (highlightedItems.length > 0) {
    console.log(`Found ${highlightedItems.length} highlighted item(s):`);
    for (const item of highlightedItems) {
      const text = await item.textContent();
      console.log(`  - Highlighted: "${text?.trim()}"`);
    }
  } else {
    console.log('  ❌ No items are highlighted!');
  }
  
  // Check if "Tablet" specifically is highlighted
  const tabletHighlighted = await page.locator('[data-testid="form-type-dropdown"] >> text="Tablet"').first().evaluate(el => {
    return el.classList.contains('bg-blue-50') || el.parentElement?.classList.contains('bg-blue-50');
  });
  
  console.log(`\n"Tablet" is highlighted: ${tabletHighlighted ? '✓ YES' : '❌ NO'}`);
  
  // Press Enter and see what gets selected
  console.log('\nPressing Enter...');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  
  // Check what value is now in the Type field
  const selectedValue = await typeInput.inputValue();
  console.log(`\nAfter pressing Enter:`);
  console.log(`  Type field value: "${selectedValue}"`);
  
  // Verify the behavior
  console.log('\n=== VERIFICATION ===');
  
  if (tabletHighlighted && selectedValue === 'Tablet') {
    console.log('✓ CORRECT: "Tablet" was highlighted and got selected on Enter');
  } else if (tabletHighlighted && selectedValue !== 'Tablet') {
    console.log(`❌ ISSUE: "Tablet" was highlighted but "${selectedValue}" got selected instead`);
    console.log('This confirms the user\'s experience - Enter is not selecting the highlighted item!');
  } else if (!tabletHighlighted && selectedValue) {
    console.log(`❌ ISSUE: Nothing was highlighted but "${selectedValue}" got selected`);
  } else {
    console.log('❌ ISSUE: Unexpected behavior - no clear selection pattern');
  }
  
  // Additional check: Was the dropdown closed after Enter?
  const dropdownStillVisible = await page.locator('[data-testid="form-type-dropdown"]').isVisible();
  console.log(`\nDropdown still visible after Enter: ${dropdownStillVisible ? 'YES' : 'NO'}`);
  
  // Log all findings
  console.log('\n=== SUMMARY ===');
  console.log(`1. User typed: "tab"`);
  console.log(`2. Items shown: ${itemTexts.join(', ')}`);
  console.log(`3. Item highlighted: ${tabletHighlighted ? 'Tablet' : 'None or other'}`);
  console.log(`4. Item selected on Enter: "${selectedValue}"`);
  console.log(`5. Expected behavior: Enter selects highlighted item`);
  console.log(`6. Actual behavior: ${selectedValue === 'Tablet' && tabletHighlighted ? 'Matches expectation' : 'Does NOT match expectation'}`);
});