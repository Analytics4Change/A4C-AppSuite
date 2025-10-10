import { test, expect } from '@playwright/test';

test('Debug navigation to medication search', async ({ page }) => {
  console.log('\n=== Debugging Navigation Flow ===\n');
  
  // Add console logging
  page.on('console', msg => {
    if (msg.type() === 'log' && msg.text().includes('UAT-')) {
      console.log(msg.text());
    }
  });
  
  // Navigate to the app
  await page.goto('http://localhost:3456');
  await page.waitForLoadState('networkidle');
  console.log('✓ Page loaded');
  
  // Take a screenshot to see what's on the page
  await page.screenshot({ path: 'step1-initial.png' });
  console.log('Screenshot saved: step1-initial.png');
  
  // Log all visible text on the page
  const visibleText = await page.evaluate(() => {
    return document.body.innerText.substring(0, 500);
  });
  console.log('Visible text on page:', visibleText);
  
  // Find all clickable elements
  const clickableElements = await page.evaluate(() => {
    const elements = document.querySelectorAll('button, [role="button"], select, input, [onclick]');
    return Array.from(elements).map(el => ({
      tag: el.tagName,
      text: (el as HTMLElement).innerText?.substring(0, 50) || '',
      id: el.id,
      className: el.className.substring(0, 50),
      type: (el as HTMLInputElement).type || ''
    }));
  });
  
  console.log('\nClickable elements found:');
  clickableElements.forEach(el => {
    console.log(`  ${el.tag}#${el.id || 'no-id'}: "${el.text}" (${el.className})`);
  });
  
  // Try to find client selector
  console.log('\nLooking for client selector...');
  
  // Check for a combobox or select with "client" in name/id/label
  const clientInput = await page.locator('input[role="combobox"], select, [aria-label*="client" i], [placeholder*="client" i]').first();
  
  if (await clientInput.count() > 0) {
    console.log('Found client input, attempting to interact...');
    await clientInput.click();
    await page.waitForTimeout(500);
    
    // Check if dropdown opened
    const hasOptions = await page.locator('[role="option"]').count() > 0;
    if (hasOptions) {
      console.log('Dropdown opened, selecting first client...');
      await page.locator('[role="option"]').first().click();
      console.log('✓ Client selected');
    } else {
      console.log('No dropdown options found');
    }
  } else {
    console.log('No client selector found with standard patterns');
    
    // If there's any select element, try that
    const anySelect = await page.locator('select').first();
    if (await anySelect.count() > 0) {
      const options = await anySelect.locator('option').count();
      console.log(`Found a select element with ${options} options`);
      if (options > 1) {
        await anySelect.selectOption({ index: 1 });
        console.log('✓ Selected first option');
      }
    }
  }
  
  await page.waitForTimeout(1000);
  
  // Take screenshot after client selection
  await page.screenshot({ path: 'step2-after-client.png' });
  console.log('Screenshot saved: step2-after-client.png');
  
  // Now look for Add Medication button
  console.log('\nLooking for Add Medication button...');
  const addMedButton = await page.locator('button').filter({ hasText: /add.*medication/i }).first();
  
  if (await addMedButton.count() > 0) {
    const buttonText = await addMedButton.textContent();
    console.log(`Found button: "${buttonText}"`);
    await addMedButton.click();
    console.log('✓ Clicked Add Medication');
    
    await page.waitForTimeout(500);
    
    // Look for Prescribed Medication option
    const prescribedOption = await page.locator('text=/prescribed.*medication/i').first();
    if (await prescribedOption.count() > 0) {
      console.log('Found Prescribed Medication option');
      await prescribedOption.click();
      console.log('✓ Selected Prescribed Medication');
      
      // Wait for modal
      try {
        await page.waitForSelector('#medication-search', { timeout: 3000 });
        console.log('✓ Medication search modal opened!');
        
        // Take final screenshot
        await page.screenshot({ path: 'step3-medication-modal.png' });
        console.log('Screenshot saved: step3-medication-modal.png');
        
        // Now we can test the actual issue
        console.log('\n=== Testing SearchableDropdown ===');
        
        const searchInput = page.locator('#medication-search');
        await searchInput.fill('lo');
        await page.waitForTimeout(600);
        
        // Check if dropdown appears
        const dropdownVisible = await page.locator('#medication-dropdown').isVisible();
        console.log(`Dropdown visible after typing "lo": ${dropdownVisible}`);
        
        if (dropdownVisible) {
          // Count results
          const resultCount = await page.locator('#medication-dropdown [role="option"]').count();
          console.log(`Number of results: ${resultCount}`);
          
          // Test Tab key
          console.log('\nTesting Tab key behavior...');
          await page.keyboard.press('Tab');
          await page.waitForTimeout(100);
          
          const focusAfterTab = await page.evaluate(() => {
            const el = document.activeElement;
            return {
              id: el?.id || '',
              inDropdown: el?.closest('#medication-dropdown') !== null
            };
          });
          console.log(`After Tab: focus on #${focusAfterTab.id}, in dropdown: ${focusAfterTab.inDropdown}`);
        }
        
      } catch (e) {
        console.log('❌ Medication search modal did not open');
      }
    }
  } else {
    console.log('❌ Could not find Add Medication button');
  }
  
  console.log('\n=== End of debug test ===');
});