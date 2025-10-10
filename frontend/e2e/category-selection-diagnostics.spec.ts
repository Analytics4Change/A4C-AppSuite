import { test, expect, Page } from '@playwright/test';

/**
 * Diagnostic test suite to identify the root cause of Space key selection issue
 * This test captures detailed state information and callback chains
 */

// Helper to inject diagnostics into the page
async function injectDiagnostics(page: Page) {
  await page.addInitScript(() => {
    // Create global diagnostics object
    (window as any).__diagnostics = {
      focusedIndexHistory: [],
      callbackInvocations: [],
      stateSnapshots: [],
      capturedLogs: [],
      eventSequence: []
    };

    // Override console.log to capture diagnostic logs
    const originalLog = console.log;
    console.log = (...args: any[]) => {
      const logEntry = {
        timestamp: Date.now(),
        args: args.map(arg => {
          if (typeof arg === 'object') {
            try {
              return JSON.stringify(arg);
            } catch {
              return String(arg);
            }
          }
          return arg;
        })
      };
      (window as any).__diagnostics.capturedLogs.push(logEntry);
      originalLog(...args);
    };

    // Track events
    ['keydown', 'click', 'focus', 'blur'].forEach(eventType => {
      document.addEventListener(eventType, (e: Event) => {
        const target = e.target as HTMLElement;
        if (target?.closest('#therapeutic-classes-list') || target?.closest('#regimen-categories-list')) {
          (window as any).__diagnostics.eventSequence.push({
            type: eventType,
            timestamp: Date.now(),
            target: {
              id: target.id,
              className: target.className,
              textContent: target.textContent?.trim().substring(0, 30)
            },
            key: (e as KeyboardEvent).key
          });
        }
      }, true);
    });
  });
}

// Helper to extract React component state
async function captureComponentState(page: Page) {
  return await page.evaluate(() => {
    const diagnostics = (window as any).__diagnostics;
    
    // Try to access React Fiber to get component state
    const findReactFiber = (element: HTMLElement) => {
      const keys = Object.keys(element);
      const reactFiberKey = keys.find(key => key.startsWith('__reactFiber'));
      return reactFiberKey ? (element as any)[reactFiberKey] : null;
    };

    // Find dropdown element and extract state
    const dropdown = document.querySelector('#therapeutic-classes-list');
    if (dropdown) {
      const fiber = findReactFiber(dropdown as HTMLElement);
      if (fiber) {
        // Traverse up to find component with focusedIndex state
        let current = fiber;
        while (current) {
          if (current.memoizedState && typeof current.memoizedState === 'object') {
            diagnostics.stateSnapshots.push({
              timestamp: Date.now(),
              state: 'Found React state',
              fiber: true
            });
            break;
          }
          current = current.return;
        }
      }
    }

    // Capture current focused element
    const activeElement = document.activeElement;
    const focusInfo = {
      timestamp: Date.now(),
      focused: {
        id: activeElement?.id,
        textContent: activeElement?.textContent?.trim().substring(0, 30),
        tabIndex: (activeElement as HTMLElement)?.tabIndex
      }
    };

    return {
      diagnostics,
      focusInfo,
      checkboxStates: Array.from(document.querySelectorAll('#therapeutic-classes-list input[type="checkbox"]')).map(cb => ({
        checked: (cb as HTMLInputElement).checked,
        parent: (cb.parentElement?.parentElement?.textContent || '').trim().substring(0, 30)
      }))
    };
  });
}

test.describe('Category Selection Diagnostics', () => {
  test.beforeEach(async ({ page }) => {
    await injectDiagnostics(page);
  });

  test('Diagnose Space key after Tab - Focus Index Tracking', async ({ page }) => {
    console.log('\n=== DIAGNOSTIC TEST: FOCUS INDEX TRACKING ===\n');
    
    // Navigate to the application
    await page.goto('http://localhost:3456');
    await page.waitForTimeout(500);
    
    // Quick setup to get to category selection
    await page.locator('text="John Smith"').click();
    await page.locator('#add-medication-button').click();
    await page.locator('text="Prescribed Medication"').click();
    
    const medicationSearch = page.locator('input#medication-search');
    await medicationSearch.fill('ibuprofen');
    await page.waitForTimeout(1500);
    await page.locator('#medication-dropdown >> div[role="option"]').first().click();
    await page.locator('#medication-continue-button').click();
    await page.waitForTimeout(1000);
    
    // Fill minimum required fields
    await page.locator('#dosage-category').click();
    await page.locator('text="Solid"').click();
    await page.locator('#form-type').click();
    await page.locator('text="Tablet"').click();
    await page.locator('#dosage-amount').fill('200');
    await page.locator('#dosage-unit').fill('mg');
    
    // Open Therapeutic Classes
    console.log('1. Opening Therapeutic Classes dropdown...');
    await page.locator('button#therapeutic-classes-button').click();
    await page.waitForTimeout(500);
    
    // Capture initial state
    const initialState = await captureComponentState(page);
    console.log('Initial State:', {
      focusedElement: initialState.focusInfo.focused,
      checkboxes: initialState.checkboxStates
    });
    
    // Focus first item
    console.log('\n2. Focusing first item (Pain Relief)...');
    await page.locator('#therapeutic-classes-list div[role="checkbox"]').first().focus();
    await page.waitForTimeout(100);
    
    const afterFocusState = await captureComponentState(page);
    console.log('After Focus:', afterFocusState.focusInfo.focused);
    
    // Press Tab to move to second item
    console.log('\n3. Pressing Tab to move to second item...');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(200);
    
    const afterTabState = await captureComponentState(page);
    console.log('After Tab:', afterTabState.focusInfo.focused);
    
    // Extract logs about Tab handling
    const tabLogs = await page.evaluate(() => {
      return (window as any).__diagnostics.capturedLogs
        .filter((log: any) => log.args.some((arg: any) => String(arg).includes('Tab')))
        .map((log: any) => log.args.map((arg: any) => String(arg)).join(' '));
    });
    console.log('\n4. Tab Handler Logs:');
    tabLogs.forEach((log: string) => console.log('   ', log));
    
    // Now press Space
    console.log('\n5. Pressing Space...');
    await page.keyboard.press('Space');
    await page.waitForTimeout(500);
    
    // Capture state after Space
    const afterSpaceState = await captureComponentState(page);
    console.log('After Space:', {
      checkboxes: afterSpaceState.checkboxStates,
      focused: afterSpaceState.focusInfo.focused
    });
    
    // Extract Space handling logs
    const spaceLogs = await page.evaluate(() => {
      return (window as any).__diagnostics.capturedLogs
        .filter((log: any) => log.args.some((arg: any) => {
          const str = String(arg);
          return str.includes('Space') || str.includes('toggle');
        }))
        .map((log: any) => log.args.map((arg: any) => String(arg)).join(' '));
    });
    console.log('\n6. Space Handler & Toggle Logs:');
    spaceLogs.forEach((log: string) => console.log('   ', log));
    
    // Extract event sequence
    const events = await page.evaluate(() => {
      return (window as any).__diagnostics.eventSequence
        .filter((e: any) => e.type === 'keydown' || e.type === 'focus')
        .map((e: any) => `${e.type}: ${e.key || 'N/A'} on ${e.target.textContent}`);
    });
    console.log('\n7. Event Sequence:');
    events.forEach((event: string) => console.log('   ', event));
    
    // Diagnosis
    console.log('\n=== DIAGNOSIS ===');
    const diagnosis = {
      focusMovedCorrectly: afterTabState.focusInfo.focused.textContent?.includes('Cardiovascular'),
      spaceTargetedCorrectItem: spaceLogs.some(log => log.includes('Cardiovascular')),
      checkboxToggled: afterSpaceState.checkboxStates.some(cb => cb.checked),
      viewModelCalled: spaceLogs.some(log => log.includes('[MedicationEntryViewModel]'))
    };
    
    console.log('Focus moved to Cardiovascular:', diagnosis.focusMovedCorrectly);
    console.log('Space targeted Cardiovascular:', diagnosis.spaceTargetedCorrectItem);
    console.log('Any checkbox toggled:', diagnosis.checkboxToggled);
    console.log('ViewModel toggle called:', diagnosis.viewModelCalled);
    
    if (!diagnosis.spaceTargetedCorrectItem) {
      console.log('\n❌ ROOT CAUSE: Space handler using stale focusedIndex (closure issue)');
    }
    if (!diagnosis.viewModelCalled) {
      console.log('❌ SECONDARY ISSUE: Callback not reaching ViewModel');
    }
    
    // Generate detailed report
    const report = await page.evaluate(() => {
      const diag = (window as any).__diagnostics;
      return {
        totalLogs: diag.capturedLogs.length,
        totalEvents: diag.eventSequence.length,
        tabEvents: diag.eventSequence.filter((e: any) => e.key === 'Tab').length,
        spaceEvents: diag.eventSequence.filter((e: any) => e.key === ' ').length
      };
    });
    
    console.log('\n=== SUMMARY ===');
    console.log('Total logs captured:', report.totalLogs);
    console.log('Total events:', report.totalEvents);
    console.log('Tab key events:', report.tabEvents);
    console.log('Space key events:', report.spaceEvents);
  });

  test('Diagnose Callback Chain - ViewModel Integration', async ({ page }) => {
    console.log('\n=== DIAGNOSTIC TEST: CALLBACK CHAIN ===\n');
    
    // Inject spy into ViewModel
    await page.addInitScript(() => {
      // We'll override the toggle method when it's created
      const originalLog = console.log;
      (window as any).__vmToggleSpy = {
        calls: [],
        original: null
      };
    });
    
    // Navigate and setup
    await page.goto('http://localhost:3456');
    await page.waitForTimeout(500);
    
    await page.locator('text="John Smith"').click();
    await page.locator('#add-medication-button').click();
    await page.locator('text="Prescribed Medication"').click();
    
    const medicationSearch = page.locator('input#medication-search');
    await medicationSearch.fill('ibuprofen');
    await page.waitForTimeout(1500);
    await page.locator('#medication-dropdown >> div[role="option"]').first().click();
    await page.locator('#medication-continue-button').click();
    await page.waitForTimeout(1000);
    
    // Fill required fields
    await page.locator('#dosage-category').click();
    await page.locator('text="Solid"').click();
    await page.locator('#form-type').click();
    await page.locator('text="Tablet"').click();
    await page.locator('#dosage-amount').fill('200');
    await page.locator('#dosage-unit').fill('mg');
    
    // Open dropdown
    await page.locator('button#therapeutic-classes-button').click();
    await page.waitForTimeout(500);
    
    // Test direct click (should work)
    console.log('1. Testing direct mouse click on Pain Relief...');
    await page.locator('#therapeutic-classes-list div[role="checkbox"]').first().click();
    await page.waitForTimeout(200);
    
    const afterClickLogs = await page.evaluate(() => {
      return (window as any).__diagnostics.capturedLogs
        .filter((log: any) => log.args.some((arg: any) => {
          const str = String(arg);
          return str.includes('[MedicationEntryViewModel]');
        }))
        .map((log: any) => log.args.map((arg: any) => String(arg)).join(' '));
    });
    
    console.log('ViewModel logs after click:');
    afterClickLogs.forEach((log: string) => console.log('   ', log));
    
    // Reset by clicking again
    await page.locator('#therapeutic-classes-list div[role="checkbox"]').first().click();
    await page.waitForTimeout(200);
    
    // Now test keyboard
    console.log('\n2. Testing keyboard Space on first item...');
    await page.locator('#therapeutic-classes-list div[role="checkbox"]').first().focus();
    await page.waitForTimeout(100);
    await page.keyboard.press('Space');
    await page.waitForTimeout(200);
    
    const afterSpaceLogs = await page.evaluate(() => {
      return (window as any).__diagnostics.capturedLogs
        .filter((log: any) => 
          log.args.some((arg: any) => {
            const str = String(arg);
            return str.includes('[MedicationEntryViewModel]') || 
                   str.includes('toggle') ||
                   str.includes('Space');
          })
        )
        .slice(-5) // Last 5 relevant logs
        .map((log: any) => log.args.map((arg: any) => String(arg)).join(' '));
    });
    
    console.log('Logs after Space:');
    afterSpaceLogs.forEach((log: string) => console.log('   ', log));
    
    // Check if callback reached parent
    const callbackLogs = afterSpaceLogs.filter(log => 
      log.includes('toggleTherapeuticClass called')
    );
    
    console.log('\n=== CALLBACK CHAIN DIAGNOSIS ===');
    console.log('Mouse click reaches ViewModel:', afterClickLogs.length > 0 ? '✅' : '❌');
    console.log('Space key reaches ViewModel:', callbackLogs.length > 0 ? '✅' : '❌');
    
    if (callbackLogs.length === 0) {
      console.log('\n❌ Callback chain is broken between dropdown and ViewModel');
      console.log('Possible causes:');
      console.log('1. onToggleTherapeuticClass prop not passed correctly');
      console.log('2. Callback invoked with wrong parameter type');
      console.log('3. Error thrown in callback preventing propagation');
    }
  });

  test('Diagnose State Synchronization - Race Conditions', async ({ page }) => {
    console.log('\n=== DIAGNOSTIC TEST: STATE SYNCHRONIZATION ===\n');
    
    await injectDiagnostics(page);
    
    // Quick navigation to category selection
    await page.goto('http://localhost:3456');
    await page.locator('text="John Smith"').click();
    await page.locator('#add-medication-button').click();
    await page.locator('text="Prescribed Medication"').click();
    
    const medicationSearch = page.locator('input#medication-search');
    await medicationSearch.fill('ibuprofen');
    await page.waitForTimeout(1500);
    await page.locator('#medication-dropdown >> div[role="option"]').first().click();
    await page.locator('#medication-continue-button').click();
    
    await page.locator('#dosage-category').click();
    await page.locator('text="Solid"').click();
    await page.locator('#form-type').click();
    await page.locator('text="Tablet"').click();
    await page.locator('#dosage-amount').fill('200');
    await page.locator('#dosage-unit').fill('mg');
    
    await page.locator('button#therapeutic-classes-button').click();
    await page.waitForTimeout(500);
    
    // Test rapid Tab-Space sequence
    console.log('1. Testing rapid Tab-Space sequence...');
    await page.locator('#therapeutic-classes-list div[role="checkbox"]').first().focus();
    
    // Rapid sequence without delays
    await page.keyboard.press('Tab');
    await page.keyboard.press('Space');
    
    await page.waitForTimeout(500);
    
    const rapidLogs = await page.evaluate(() => {
      return (window as any).__diagnostics.capturedLogs
        .filter((log: any) => 
          log.args.some((arg: any) => {
            const str = String(arg);
            return str.includes('Intercepting') || 
                   str.includes('focusedIndex');
          })
        )
        .map((log: any) => ({
          time: log.timestamp,
          message: log.args.map((arg: any) => String(arg)).join(' ')
        }));
    });
    
    console.log('\nTiming Analysis:');
    if (rapidLogs.length >= 2) {
      const tabTime = rapidLogs.find(l => l.message.includes('Tab'))?.time;
      const spaceTime = rapidLogs.find(l => l.message.includes('Space'))?.time;
      if (tabTime && spaceTime) {
        console.log(`Time between Tab and Space: ${spaceTime - tabTime}ms`);
      }
    }
    
    // Test multiple Tabs then Space
    console.log('\n2. Testing multiple Tabs then Space...');
    await page.reload();
    await page.waitForTimeout(1000);
    
    // Reopen dropdown
    await page.locator('button#therapeutic-classes-button').click();
    await page.waitForTimeout(500);
    await page.locator('#therapeutic-classes-list div[role="checkbox"]').first().focus();
    
    // Multiple tabs
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(100);
    await page.keyboard.press('Space');
    
    await page.waitForTimeout(500);
    
    const multiTabLogs = await page.evaluate(() => {
      return (window as any).__diagnostics.capturedLogs
        .filter((log: any) => log.args.some((arg: any) => {
          const str = String(arg);
          return str.includes('for:');
        }))
        .map((log: any) => log.args.map((arg: any) => String(arg)).join(' '));
    });
    
    console.log('\nSpace pressed for item:');
    const lastSpaceLog = multiTabLogs[multiTabLogs.length - 1];
    if (lastSpaceLog) {
      console.log('   ', lastSpaceLog);
      const expectedItem = 'Gastrointestinal'; // 3 tabs from first item
      const correctItem = lastSpaceLog.includes(expectedItem);
      console.log(`   Expected: ${expectedItem}, Correct: ${correctItem ? '✅' : '❌'}`);
    }
    
    console.log('\n=== STATE SYNC DIAGNOSIS ===');
    console.log('Rapid sequences cause issues: Check timing analysis above');
    console.log('Multiple Tabs tracked correctly: Check expected vs actual above');
  });
});

test.describe('Summary Report', () => {
  test('Generate Diagnostic Summary', async ({ page }) => {
    console.log('\n' + '='.repeat(60));
    console.log('DIAGNOSTIC SUMMARY REPORT');
    console.log('='.repeat(60));
    console.log('\nTo fix the Space key selection issue:');
    console.log('1. Review the diagnostic output above');
    console.log('2. Identify which diagnosis shows ❌ failures');
    console.log('3. Apply the corresponding fix:');
    console.log('   - Stale closure → Use useRef pattern');
    console.log('   - Broken callback → Fix prop passing');
    console.log('   - Race condition → Add proper state sync');
    console.log('\n' + '='.repeat(60));
  });
});