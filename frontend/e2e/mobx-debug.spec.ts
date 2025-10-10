import { test, expect } from '@playwright/test';

test.describe('MobX Reactivity Debug', () => {
  test('Debug Space key selection', async ({ page }) => {
    // Capture all console logs
    const logs: string[] = [];
    page.on('console', msg => {
      const text = msg.text();
      logs.push(text);
      console.log('BROWSER:', text);
    });
    
    console.log('\n=== MOBX REACTIVITY DEBUG TEST ===\n');
    
    // Navigate and setup
    await page.goto('http://localhost:3456');
    await page.locator('text="John Smith"').click();
    await page.locator('#add-medication-button').click();
    await page.locator('text="Prescribed Medication"').click();
    
    // Select medication
    const medicationSearch = page.locator('input#medication-search');
    await medicationSearch.fill('ibuprofen');
    await page.waitForTimeout(1500);
    await page.locator('#medication-dropdown >> div[role="option"]').first().click();
    
    // Continue to dosage form
    await page.locator('#medication-continue-button').click();
    await page.waitForTimeout(1000);
    
    // Quick fill required fields
    await page.locator('#dosage-category').click();
    await page.locator('text="Solid"').click();
    await page.locator('#form-type').click();
    await page.locator('text="Tablet"').click();
    await page.locator('#dosage-amount').fill('200');
    await page.locator('#dosage-unit').fill('mg');
    
    // Clear previous logs
    logs.length = 0;
    
    console.log('\n--- Opening Therapeutic Classes dropdown ---');
    await page.locator('#therapeutic-classes-button').click();
    await page.waitForTimeout(500);
    
    // Check MobX debugger state
    const debuggerState = await page.evaluate(() => {
      const debuggerEl = document.querySelector('[style*="MobX State Monitor"]');
      return debuggerEl ? debuggerEl.textContent : 'No debugger found';
    });
    console.log('MobX Debugger State:', debuggerState);
    
    // Clear logs for Space key test
    logs.length = 0;
    
    console.log('\n--- Testing Space key selection ---');
    
    // Focus first item and press Space
    await page.locator('#therapeutic-classes-listbox div[role="option"]').first().focus();
    await page.waitForTimeout(100);
    
    // Check current checkbox state (Radix UI checkboxes)
    const beforeSpace = await page.evaluate(() => {
      const checkboxes = document.querySelectorAll('#therapeutic-classes-listbox [data-slot="checkbox"]');
      return Array.from(checkboxes).map(cb => {
        const parent = cb.closest('[role="option"]');
        const label = parent?.querySelector('span.text-sm')?.textContent || 'unknown';
        const checked = cb.getAttribute('data-state') === 'checked';
        return { label, checked };
      });
    });
    console.log('Checkboxes before Space:', beforeSpace);
    
    // Press Space
    await page.keyboard.press('Space');
    await page.waitForTimeout(500);
    
    // Check checkbox state after Space (Radix UI checkboxes)
    const afterSpace = await page.evaluate(() => {
      const checkboxes = document.querySelectorAll('#therapeutic-classes-listbox [data-slot="checkbox"]');
      return Array.from(checkboxes).map(cb => {
        const parent = cb.closest('[role="option"]');
        const label = parent?.querySelector('span.text-sm')?.textContent || 'unknown';
        const checked = cb.getAttribute('data-state') === 'checked';
        return { label, checked };
      });
    });
    console.log('Checkboxes after Space:', afterSpace);
    
    // Print captured logs
    console.log('\n--- Captured Console Logs ---');
    logs.forEach(log => console.log('  ', log));
    
    // Check MobX debugger state again
    const debuggerStateAfter = await page.evaluate(() => {
      const debuggerEl = document.querySelector('[style*="MobX State Monitor"]');
      return debuggerEl ? debuggerEl.textContent : 'No debugger found';
    });
    console.log('\nMobX Debugger State After:', debuggerStateAfter);
    
    // Get ViewModel state directly
    const vmState = await page.evaluate(() => {
      // Try to access the ViewModel through window or React DevTools
      const getReactFiber = (dom: any) => {
        const key = Object.keys(dom).find(key => key.startsWith('__reactInternalInstance') || key.startsWith('__reactFiber'));
        return key ? dom[key] : null;
      };
      
      const modal = document.querySelector('[data-testid="add-new-prescribed-medication-modal"]');
      if (modal) {
        const parent = modal.parentElement;
        const fiber = parent ? getReactFiber(parent) : null;
        if (fiber) {
          // Try to find the ViewModel in the fiber tree
          let current = fiber;
          while (current) {
            if (current.memoizedProps?.viewModel || current.memoizedProps?.vm) {
              const vm = current.memoizedProps.viewModel || current.memoizedProps.vm;
              return {
                therapeutic: vm.selectedTherapeuticClasses,
                regimen: vm.selectedRegimenCategories
              };
            }
            current = current.return;
          }
        }
      }
      return 'Could not access ViewModel';
    });
    console.log('\nViewModel State:', vmState);
    
    console.log('\n=== END DEBUG TEST ===\n');
  });
});