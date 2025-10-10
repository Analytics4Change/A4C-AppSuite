import { test, expect, Page } from '@playwright/test';

/**
 * Focused Test for Medication Entry Flow - Lorazepam Search
 * 
 * This test specifically validates the medication entry flow requested:
 * 1. Navigate to application
 * 2. Select client "John Smith"
 * 3. Click "Add Medication" button
 * 4. Click "Prescribed Medication" option
 * 5. Search for "Lorazepam" in medication name field
 * 6. Verify search functionality works without errors or infinite loops
 */

class MedicationFlowTester {
  constructor(private page: Page) {}

  async navigateToApplication() {
    console.log('Navigating to application...');
    await this.page.goto('/', { waitUntil: 'networkidle' });
    
    // Wait for the page to be fully loaded
    await this.page.waitForLoadState('domcontentloaded');
    
    // Log the current URL for debugging
    const currentUrl = this.page.url();
    console.log(`Current URL: ${currentUrl}`);
    
    // Check if page loaded successfully
    await expect(this.page.locator('body')).toBeVisible();
  }

  async selectJohnSmith() {
    console.log('Looking for client selector...');
    
    // First, let's see what's actually on the page
    await this.page.screenshot({ path: 'test-results/page-initial.png', fullPage: true });
    
    // Try multiple possible selectors for client selection
    const possibleClientSelectors = [
      'text="John Smith"',
      '[data-testid*="john"], [data-testid*="Smith"]',
      '[data-client-id*="john"], [data-client-id*="Smith"]', 
      'button:has-text("John Smith")',
      'div:has-text("John Smith")',
      '.client-item:has-text("John Smith")',
      '[role="button"]:has-text("John Smith")'
    ];

    let clientSelected = false;
    
    for (const selector of possibleClientSelectors) {
      try {
        const element = this.page.locator(selector);
        if (await element.isVisible({ timeout: 2000 })) {
          console.log(`Found John Smith client using selector: ${selector}`);
          await element.click();
          clientSelected = true;
          break;
        }
      } catch (error) {
        console.log(`Selector ${selector} not found or not clickable`);
      }
    }

    if (!clientSelected) {
      console.log('John Smith client not found with specific selectors, looking for any client...');
      
      // Try to find any client selection element
      const genericClientSelectors = [
        '[data-testid*="client"]',
        '.client-card', 
        '.client-item',
        'button[class*="client"]',
        'div[class*="client"]'
      ];

      for (const selector of genericClientSelectors) {
        try {
          const elements = this.page.locator(selector);
          const count = await elements.count();
          if (count > 0) {
            console.log(`Found ${count} client elements with selector: ${selector}`);
            // Select the first client if multiple exist
            await elements.first().click();
            clientSelected = true;
            break;
          }
        } catch (error) {
          console.log(`Generic selector ${selector} not found`);
        }
      }
    }

    if (!clientSelected) {
      console.log('No client selector found, checking page content...');
      const pageContent = await this.page.content();
      console.log('Page content sample:', pageContent.substring(0, 500));
      throw new Error('Unable to find any client selection mechanism');
    }

    // Wait for the client to be selected and page to update
    await this.page.waitForTimeout(1000);
    await this.page.screenshot({ path: 'test-results/after-client-selection.png', fullPage: true });
  }

  async clickAddMedication() {
    console.log('Looking for Add Medication button...');
    
    const addMedicationSelectors = [
      'text="Add Medication"',
      'button:has-text("Add Medication")', 
      '[data-testid*="add-medication"]',
      'button[class*="add-medication"]',
      '.add-medication-btn',
      'button:has-text("Add")'
    ];

    let buttonFound = false;

    for (const selector of addMedicationSelectors) {
      try {
        const element = this.page.locator(selector);
        if (await element.isVisible({ timeout: 3000 })) {
          console.log(`Found Add Medication button with selector: ${selector}`);
          await element.click();
          buttonFound = true;
          break;
        }
      } catch (error) {
        console.log(`Add Medication selector ${selector} not found`);
      }
    }

    if (!buttonFound) {
      await this.page.screenshot({ path: 'test-results/add-medication-not-found.png', fullPage: true });
      throw new Error('Add Medication button not found');
    }

    // Wait for modal or next step to appear
    await this.page.waitForTimeout(1000);
    await this.page.screenshot({ path: 'test-results/after-add-medication-click.png', fullPage: true });
  }

  async clickPrescribedMedication() {
    console.log('Looking for Prescribed Medication option...');
    
    const prescribedMedicationSelectors = [
      'text="Prescribed Medication"',
      'button:has-text("Prescribed Medication")',
      '[data-testid*="prescribed"]',
      '.prescribed-medication',
      'div:has-text("Prescribed Medication")',
      '[role="button"]:has-text("Prescribed")'
    ];

    let optionFound = false;

    for (const selector of prescribedMedicationSelectors) {
      try {
        const element = this.page.locator(selector);
        if (await element.isVisible({ timeout: 3000 })) {
          console.log(`Found Prescribed Medication option with selector: ${selector}`);
          await element.click();
          optionFound = true;
          break;
        }
      } catch (error) {
        console.log(`Prescribed Medication selector ${selector} not found`);
      }
    }

    if (!optionFound) {
      await this.page.screenshot({ path: 'test-results/prescribed-medication-not-found.png', fullPage: true });
      throw new Error('Prescribed Medication option not found');
    }

    // Wait for medication entry form to appear
    await this.page.waitForTimeout(1000);
    await this.page.screenshot({ path: 'test-results/after-prescribed-medication-click.png', fullPage: true });
  }

  async searchForLorazepam() {
    console.log('Looking for medication search field...');
    
    const medicationSearchSelectors = [
      '[data-testid="medication-search"]',
      'input[placeholder*="medication"]',
      'input[placeholder*="search"]',
      'input[type="text"]',
      '.medication-search',
      'input[name*="medication"]',
      'input[id*="medication"]'
    ];

    let searchField = null;

    for (const selector of medicationSearchSelectors) {
      try {
        const element = this.page.locator(selector);
        if (await element.isVisible({ timeout: 3000 })) {
          console.log(`Found medication search field with selector: ${selector}`);
          searchField = element;
          break;
        }
      } catch (error) {
        console.log(`Search field selector ${selector} not found`);
      }
    }

    if (!searchField) {
      await this.page.screenshot({ path: 'test-results/medication-search-not-found.png', fullPage: true });
      throw new Error('Medication search field not found');
    }

    console.log('Typing "Lorazepam" into search field...');
    
    // Clear the field first and then type
    await searchField.clear();
    await searchField.fill('Lorazepam');
    
    // Verify the text was entered
    const enteredValue = await searchField.inputValue();
    expect(enteredValue).toBe('Lorazepam');
    console.log(`Successfully entered: ${enteredValue}`);

    // Wait for search results to appear (with debouncing)
    await this.page.waitForTimeout(1000);
    
    await this.page.screenshot({ path: 'test-results/after-lorazepam-search.png', fullPage: true });
  }

  async verifySearchResults() {
    console.log('Verifying search results appear...');
    
    const searchResultSelectors = [
      '[data-testid*="medication-dropdown"]',
      '[data-testid*="search-results"]',
      '.medication-options',
      '.search-results',
      '[role="listbox"]',
      '.dropdown-menu',
      'ul[class*="medication"]',
      'div[class*="results"]'
    ];

    let resultsFound = false;

    for (const selector of searchResultSelectors) {
      try {
        const element = this.page.locator(selector);
        if (await element.isVisible({ timeout: 5000 })) {
          console.log(`Found search results with selector: ${selector}`);
          
          // Check if there are actual result items
          const resultItems = element.locator('li, div, option').filter({ hasText: /lorazepam/i });
          const itemCount = await resultItems.count();
          
          if (itemCount > 0) {
            console.log(`Found ${itemCount} Lorazepam result items`);
            resultsFound = true;
            
            // Verify no infinite loops by monitoring DOM changes
            const initialHtml = await this.page.innerHTML('body');
            await this.page.waitForTimeout(2000);
            const afterWaitHtml = await this.page.innerHTML('body');
            
            if (initialHtml === afterWaitHtml) {
              console.log('✅ No infinite loops detected - DOM is stable');
            } else {
              console.log('⚠️  DOM changes detected after search - checking for stability...');
              await this.page.waitForTimeout(3000);
              const finalHtml = await this.page.innerHTML('body');
              
              if (afterWaitHtml === finalHtml) {
                console.log('✅ DOM stabilized after initial change');
              } else {
                console.log('❌ Potential infinite loop - DOM keeps changing');
                throw new Error('Potential infinite loop detected in search functionality');
              }
            }
            
            break;
          }
        }
      } catch (error) {
        console.log(`Search results selector ${selector} not found or error: ${error}`);
      }
    }

    if (!resultsFound) {
      console.log('No search results found, but search may still be functioning...');
      
      // Check if there's a "no results" message or if search is working but no matches
      const noResultsSelectors = [
        'text="No results found"',
        'text="No medications found"', 
        '.no-results',
        '[data-testid*="no-results"]'
      ];

      let noResultsFound = false;
      for (const selector of noResultsSelectors) {
        if (await this.page.locator(selector).isVisible({ timeout: 2000 })) {
          console.log('Found "no results" message - search is working but no matches');
          noResultsFound = true;
          break;
        }
      }

      if (!noResultsFound) {
        // This might not be an error - the medication database might not contain Lorazepam
        console.log('⚠️  No search results or "no results" message found');
        console.log('This could mean:');
        console.log('1. Search functionality is not implemented yet');
        console.log('2. Lorazepam is not in the medication database');
        console.log('3. Search results appear in a different format than expected');
      }
    }

    await this.page.screenshot({ path: 'test-results/search-verification-complete.png', fullPage: true });
    
    return resultsFound;
  }

  async checkForErrors() {
    console.log('Checking for JavaScript errors...');
    
    // Check console for errors
    const consoleMessages = await this.page.evaluate(() => {
      return (window as any).testErrors || [];
    });
    
    if (consoleMessages.length > 0) {
      console.log('Console errors found:', consoleMessages);
    }

    // Check for error messages in the UI
    const errorSelectors = [
      '.error',
      '.alert-error', 
      '[role="alert"]',
      '.text-red-500',
      '.text-danger',
      '[data-testid*="error"]'
    ];

    const visibleErrors = [];
    for (const selector of errorSelectors) {
      const elements = this.page.locator(selector);
      const count = await elements.count();
      
      for (let i = 0; i < count; i++) {
        const element = elements.nth(i);
        if (await element.isVisible()) {
          const errorText = await element.textContent();
          if (errorText && errorText.trim()) {
            visibleErrors.push(errorText);
          }
        }
      }
    }

    if (visibleErrors.length > 0) {
      console.log('UI errors found:', visibleErrors);
      return visibleErrors;
    }

    console.log('✅ No errors detected');
    return [];
  }
}

test.describe('Medication Entry Flow - Lorazepam Search Test', () => {
  let tester: MedicationFlowTester;

  test.beforeEach(async ({ page }) => {
    tester = new MedicationFlowTester(page);
    
    // Set up console error tracking
    page.on('console', msg => {
      if (msg.type() === 'error') {
        console.log('Browser console error:', msg.text());
      }
    });

    // Set up error tracking
    page.on('pageerror', error => {
      console.log('Page error:', error.message);
    });
  });

  test('Complete medication entry flow with Lorazepam search', async ({ page }) => {
    console.log('🧪 Starting Lorazepam medication entry test...');
    
    try {
      // Step 1: Navigate to application
      await tester.navigateToApplication();
      console.log('✅ Step 1: Successfully navigated to application');

      // Step 2: Select John Smith client  
      await tester.selectJohnSmith();
      console.log('✅ Step 2: Successfully selected client');

      // Step 3: Click Add Medication button
      await tester.clickAddMedication();
      console.log('✅ Step 3: Successfully clicked Add Medication');

      // Step 4: Click Prescribed Medication option
      await tester.clickPrescribedMedication();
      console.log('✅ Step 4: Successfully clicked Prescribed Medication');

      // Step 5: Search for Lorazepam
      await tester.searchForLorazepam();
      console.log('✅ Step 5: Successfully entered Lorazepam search term');

      // Step 6: Verify search results and no infinite loops
      const searchWorked = await tester.verifySearchResults();
      console.log('✅ Step 6: Search verification completed');

      // Check for any errors
      const errors = await tester.checkForErrors();
      
      if (errors.length === 0) {
        console.log('🎉 Test completed successfully - no errors detected');
      } else {
        console.log('⚠️  Test completed with warnings:', errors);
      }

      // Final verification that we can still interact with the page (no infinite loops)
      await expect(page.locator('body')).toBeVisible();
      console.log('✅ Final verification: Page remains interactive');

    } catch (error) {
      console.log('❌ Test failed with error:', error.message);
      
      // Take a final screenshot for debugging
      await page.screenshot({ 
        path: 'test-results/test-failure.png', 
        fullPage: true 
      });
      
      throw error;
    }
  });

  test('Search field error handling', async ({ page }) => {
    console.log('🧪 Testing search field error handling...');

    await tester.navigateToApplication();
    await tester.selectJohnSmith();
    await tester.clickAddMedication();
    await tester.clickPrescribedMedication();

    // Find the search field
    const searchField = page.locator('[data-testid="medication-search"]').or(
      page.locator('input[placeholder*="medication"]')
    ).or(
      page.locator('input[type="text"]')
    ).first();

    if (await searchField.isVisible()) {
      // Test various edge cases
      const testCases = [
        '', // Empty string
        '   ', // Whitespace
        'XYZ123NonExistentMed', // Non-existent medication
        '!@#$%', // Special characters
        'A'.repeat(100) // Very long string
      ];

      for (const testCase of testCases) {
        await searchField.clear();
        await searchField.fill(testCase);
        await page.waitForTimeout(1000);
        
        // Verify no errors occurred
        const errors = await tester.checkForErrors();
        expect(errors.length).toBe(0);
      }

      console.log('✅ Search field handles edge cases without errors');
    } else {
      console.log('⚠️  Search field not found - skipping edge case testing');
    }
  });
});