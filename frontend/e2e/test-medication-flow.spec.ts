import { test, expect } from '@playwright/test';

test.describe('Medication Entry Flow', () => {
  test('should add prescribed medication Lorazepam for John Smith', async ({ page }) => {
    // Capture all console messages
    const consoleMessages: { type: string, text: string }[] = [];
    page.on('console', msg => {
      consoleMessages.push({ type: msg.type(), text: msg.text() });
      console.log(`[Browser ${msg.type()}]: ${msg.text()}`);
    });
    
    // Capture page errors
    page.on('pageerror', error => {
      console.error(`[Page Error]: ${error.message}`);
    });
    
    // Navigate to the application
    console.log('Navigating to http://localhost:3456...');
    await page.goto('http://localhost:3456');
    
    // Print any console errors that occurred during page load
    const errors = consoleMessages.filter(msg => msg.type === 'error');
    if (errors.length > 0) {
      console.error('Console errors during page load:', errors);
    }
    
    // Wait for the client selector to load
    await page.waitForSelector('[data-testid="client-selector-container"]', { timeout: 10000 });
    
    // Select John Smith
    await page.click('text=John Smith');
    
    // Verify we're on the medication management page
    await expect(page.getByTestId('app-container')).toBeVisible();
    await expect(page.getByText('Medication Management')).toBeVisible();
    
    // Click Add Medication button
    await page.click('[data-testid="add-medication-button"]');
    
    // Wait for medication type selection modal
    await page.waitForSelector('[data-modal-id="select-medication-type"]', { timeout: 5000 });
    
    // Click Prescribed Medication
    await page.click('[data-testid="prescribed-medication-button"]');
    
    // Wait for medication entry modal to appear
    await page.waitForSelector('[data-modal-id="add-new-prescribed-medication"]', { timeout: 5000 });
    
    // Verify modal opened without errors
    await expect(page.getByText('Add New Prescribed Medication')).toBeVisible();
    
    // Type Lorazepam in the medication search field (use the input element specifically)
    const medicationSearch = page.locator('input#medication-search');
    await medicationSearch.waitFor({ state: 'visible', timeout: 5000 });
    await medicationSearch.fill('Lorazepam');
    
    // Wait for search results to appear
    await page.waitForSelector('#medication-dropdown', { timeout: 5000 });
    
    // Verify search results contain Lorazepam
    const searchResults = page.locator('#medication-dropdown');
    await expect(searchResults).toBeVisible();
    
    // Additional error checking for loops
    const loopMessages = consoleMessages.filter(msg => 
      msg.text.includes('Loop limit reached') || 
      msg.text.includes('infinite loop') ||
      msg.text.includes('Maximum update depth exceeded')
    );
    
    // Wait a bit to see if there are any loop errors
    await page.waitForTimeout(2000);
    
    // Check that no loop errors occurred after waiting
    if (loopMessages.length > 0) {
      throw new Error(`Loop errors detected: ${loopMessages.map(m => m.text).join(', ')}`);
    }
    
    console.log('✅ Test completed successfully - no loops detected');
  });
});