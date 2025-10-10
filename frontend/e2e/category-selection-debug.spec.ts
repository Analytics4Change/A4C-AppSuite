import { test, expect, Page } from '@playwright/test';

test.describe('Category Selection Debug', () => {
  test('Debug keyboard navigation with isolated context', async ({ page }) => {
    // Enable console logging
    page.on('console', msg => {
      if (msg.type() === 'log') {
        console.log('PAGE LOG:', msg.text());
      }
    });
    
    console.log('\n=== CATEGORY SELECTION DEBUG TEST ===\n');
    
    // Navigate to the application
    await page.goto('http://localhost:3456');
    await page.waitForTimeout(1000);
    
    // Select a client
    console.log('1. Selecting client...');
    await page.locator('text="John Smith"').click();
    await page.waitForTimeout(500);
    
    // Open Add Medication modal
    console.log('2. Opening Add Medication modal...');
    const addMedicationButton = page.locator('#add-medication-button');
    await addMedicationButton.click();
    await page.waitForTimeout(500);
    
    // Select Prescribed Medication
    console.log('3. Selecting Prescribed Medication...');
    await page.locator('text="Prescribed Medication"').click();
    await page.waitForTimeout(500);
    
    // Search and select a medication
    console.log('4. Selecting a medication...');
    const medicationSearch = page.locator('input#medication-search');
    await medicationSearch.fill('ibuprofen');
    await page.waitForTimeout(1500);
    
    const firstMedication = page.locator('#medication-dropdown >> div[role="option"]').first();
    await firstMedication.click();
    await page.waitForTimeout(500);
    
    // Click Continue
    console.log('5. Clicking Continue...');
    const continueButton = page.locator('#medication-continue-button');
    await continueButton.click();
    await page.waitForTimeout(1000);
    
    // Fill dosage form
    console.log('6. Filling dosage form...');
    
    const categoryInput = page.locator('#dosage-category').first();
    await categoryInput.click();
    await categoryInput.fill('Solid');
    await page.keyboard.press('Tab');
    
    const formTypeInput = page.locator('#form-type').first();
    await formTypeInput.click();
    await formTypeInput.fill('Tablet');
    await page.keyboard.press('Tab');
    
    const amountInput = page.locator('#dosage-amount').first();
    await amountInput.click();
    await amountInput.fill('200');
    await page.keyboard.press('Tab');
    
    const unitInput = page.locator('#dosage-unit').first();
    await unitInput.click();
    await unitInput.fill('mg');
    
    // Navigate to Therapeutic Classes button
    console.log('7. Navigating to Therapeutic Classes...');
    const therapeuticButton = page.locator('button#therapeutic-classes-button');
    await therapeuticButton.focus();
    await page.waitForTimeout(200);
    
    // Open the checklist
    console.log('8. Opening Therapeutic Classes checklist...');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1000);
    
    // Check if list opened
    const listVisible = await page.locator('#therapeutic-classes-list').isVisible();
    console.log(`✓ Checklist opened: ${listVisible}`);
    
    // Check what element has focus
    const initialFocus = await page.evaluate(() => {
      const active = document.activeElement;
      return {
        tagName: active?.tagName,
        id: active?.id,
        className: active?.className,
        textContent: active?.textContent?.trim().substring(0, 50),
        tabIndex: (active as HTMLElement)?.tabIndex,
        role: active?.getAttribute('role')
      };
    });
    console.log('Initial focus after opening:', initialFocus);
    
    // Check if the FocusBehaviorProvider is present
    const contextInfo = await page.evaluate(() => {
      const list = document.querySelector('#therapeutic-classes-list');
      const parent = list?.parentElement?.parentElement;
      return {
        listDataContext: list?.getAttribute('data-focus-context'),
        parentNodeName: parent?.nodeName,
        parentClassName: parent?.className
      };
    });
    console.log('Context info:', contextInfo);
    
    // Now test Tab key
    console.log('\n9. Testing Tab key navigation...');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(500);
    
    const afterTabFocus = await page.evaluate(() => {
      const active = document.activeElement;
      return {
        tagName: active?.tagName,
        id: active?.id,
        textContent: active?.textContent?.trim().substring(0, 50),
        isInList: !!active?.closest('#therapeutic-classes-list'),
        tabIndex: (active as HTMLElement)?.tabIndex
      };
    });
    console.log('Focus after Tab:', afterTabFocus);
    
    // Test Space key
    console.log('\n10. Testing Space key...');
    await page.keyboard.press('Space');
    await page.waitForTimeout(500);
    
    const selectedCount = await page.evaluate(() => {
      return document.querySelectorAll('#therapeutic-classes-list input:checked').length;
    });
    console.log(`Items selected after Space: ${selectedCount}`);
    
    // Test Arrow Down
    console.log('\n11. Testing Arrow Down...');
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(500);
    
    const afterArrowFocus = await page.evaluate(() => {
      const active = document.activeElement;
      return {
        textContent: active?.textContent?.trim().substring(0, 50),
        isInList: !!active?.closest('#therapeutic-classes-list')
      };
    });
    console.log('Focus after ArrowDown:', afterArrowFocus);
    
    // Test Escape
    console.log('\n12. Testing Escape...');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    
    const listClosedAfterEscape = !(await page.locator('#therapeutic-classes-list').isVisible());
    const buttonHasFocus = await page.evaluate(() => {
      return document.activeElement?.id === 'therapeutic-classes-button';
    });
    
    console.log(`Checklist closed: ${listClosedAfterEscape}`);
    console.log(`Focus returned to button: ${buttonHasFocus}`);
    
    console.log('\n=== TEST COMPLETE ===');
  });
});