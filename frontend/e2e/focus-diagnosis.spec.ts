import { test, expect } from '@playwright/test';

test.describe('Focus Navigation Diagnosis', () => {
  test('diagnose tab navigation from Psychotropic to Dosage Form', async ({ page }) => {
    // Enable console logging
    page.on('console', msg => {
      if (msg.type() === 'log' || msg.type() === 'info' || msg.type() === 'error') {
        console.log(`[Browser ${msg.type()}]:`, msg.text());
      }
    });

    // Navigate to the medication management page
    await page.goto('http://localhost:5173/clients/1/medications/add');
    
    // Wait for page to load
    await page.waitForSelector('text=Add New Medication');
    
    // If modal appears, select a medication
    const modal = await page.locator('[role="dialog"]');
    if (await modal.isVisible()) {
      // Type in search to select a medication
      await page.fill('#medication-search', 'Pravastatin');
      await page.waitForTimeout(500); // Wait for search
      
      // Select first result
      const firstResult = await page.locator('[data-testid*="medication-result"]').first();
      if (await firstResult.isVisible()) {
        await firstResult.click();
      }
      
      // Click Continue
      await page.click('text=Continue with Selection');
      await page.waitForTimeout(500);
    }
    
    // Focus on Psychotropic "Yes" radio button
    const psychotropicYes = await page.locator('input[name="psychotropic"][value="true"]');
    await psychotropicYes.focus();
    
    console.log('\n=== BEFORE TAB PRESS ===');
    console.log('Currently focused:', await page.evaluate(() => {
      const focused = document.activeElement;
      return {
        tagName: focused?.tagName,
        id: focused?.id,
        name: focused?.getAttribute('name'),
        tabIndex: focused?.getAttribute('tabIndex'),
        actualTabIndex: focused?.tabIndex
      };
    }));
    
    // Get all focusable elements in the form
    const focusableElements = await page.evaluate(() => {
      const form = document.querySelector('[data-focus-context="form"]');
      if (!form) return [];
      
      const elements = Array.from(form.querySelectorAll('input, button, [tabindex]:not([tabindex="-1"])'));
      return elements.map(el => ({
        tagName: el.tagName,
        id: el.id,
        type: el.getAttribute('type'),
        name: el.getAttribute('name'),
        ariaLabel: el.getAttribute('aria-label'),
        tabIndex: el.getAttribute('tabIndex'),
        actualTabIndex: el.tabIndex,
        className: el.className,
        isVisible: el.offsetParent !== null,
        rect: el.getBoundingClientRect()
      })).filter(el => el.actualTabIndex >= 0);
    });
    
    console.log('\n=== FOCUSABLE ELEMENTS (tabIndex >= 0) ===');
    focusableElements.forEach((el, i) => {
      console.log(`${i}: ${el.tagName}#${el.id || '(no-id)'} tabIndex=${el.tabIndex} actual=${el.actualTabIndex} visible=${el.isVisible}`);
    });
    
    // Press Tab
    await page.keyboard.press('Tab');
    await page.waitForTimeout(100);
    
    console.log('\n=== AFTER TAB PRESS ===');
    const newFocus = await page.evaluate(() => {
      const focused = document.activeElement;
      const parent = focused?.parentElement;
      return {
        tagName: focused?.tagName,
        id: focused?.id,
        className: focused?.className,
        tabIndex: focused?.getAttribute('tabIndex'),
        actualTabIndex: focused?.tabIndex,
        ariaLabel: focused?.getAttribute('aria-label'),
        parentTag: parent?.tagName,
        parentClass: parent?.className,
        isInput: focused?.tagName === 'INPUT',
        isButton: focused?.tagName === 'BUTTON',
        rect: focused?.getBoundingClientRect()
      };
    });
    console.log('Now focused:', newFocus);
    
    // Check what we expect vs what we got
    if (newFocus.id === 'dosage-form') {
      console.log('✅ SUCCESS: Focus correctly moved to Dosage Form input');
    } else if (newFocus.isButton && newFocus.className?.includes('absolute')) {
      console.log('❌ ISSUE CONFIRMED: Focus moved to dropdown button instead of input');
      
      // Get more details about the button
      const buttonDetails = await page.evaluate(() => {
        const button = document.activeElement as HTMLButtonElement;
        const svg = button?.querySelector('svg');
        return {
          innerHTML: button?.innerHTML?.substring(0, 100),
          hasSvg: !!svg,
          svgClass: svg?.getAttribute('class'),
          computedTabIndex: window.getComputedStyle(button).getPropertyValue('tab-index')
        };
      });
      console.log('Button details:', buttonDetails);
    } else {
      console.log('❓ UNEXPECTED: Focus moved to unknown element');
    }
    
    // Take a screenshot for visual confirmation
    await page.screenshot({ path: 'focus-diagnosis.png', fullPage: false });
    console.log('\n📸 Screenshot saved as focus-diagnosis.png');
  });
});