/**
 * String helper utilities
 */

/**
 * Convert string to sentence case
 * Handles medical abbreviations and special cases
 */
export function toSentenceCase(str: string): string {
  if (!str) return str;
  
  // Preserve certain medical abbreviations that should stay uppercase
  const preserveUppercase = [
    'ER', 'XR', 'SR', 'CR', 'LA', 'XL', 'CD', 'HCl', 'HCT', 'HFA',
    'IV', 'IM', 'PO', 'PR', 'SL', 'TD', 'MG', 'MCG', 'ML', 'DPI'
  ];
  
  // Split by spaces and process each word
  return str.split(' ').map((word, index) => {
    // Check if this word should be preserved
    const upperWord = word.toUpperCase();
    if (preserveUppercase.includes(upperWord)) {
      return upperWord;
    }
    
    // Check for words with slashes (e.g., "sulfamethoxazole/trimethoprim")
    if (word.includes('/')) {
      return word.split('/').map(part => toSentenceCase(part)).join('/');
    }
    
    // Check for words with hyphens (e.g., "long-acting")
    if (word.includes('-')) {
      return word.split('-').map(part => toSentenceCase(part)).join('-');
    }
    
    // Regular sentence case
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  }).join(' ');
}

/**
 * Normalize medication name for display
 * Applies sentence case and other formatting
 */
export function normalizeMedicationDisplay(name: string): string {
  if (!name) return name;
  
  // First, trim and normalize whitespace
  const normalized = name.trim().replace(/\s+/g, ' ');
  
  // Apply sentence case
  return toSentenceCase(normalized);
}