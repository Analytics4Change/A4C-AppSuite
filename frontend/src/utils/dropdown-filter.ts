/**
 * Generic filtering utilities for dropdown components
 */

export type FilterStrategy = 'contains' | 'startsWith';

/**
 * Filter items based on search input
 * @param items - Array of items to filter
 * @param searchValue - The search input value
 * @param getItemText - Function to extract searchable text from item
 * @param strategy - Matching strategy (default: 'contains')
 * @returns Filtered array of items
 */
export function filterItems<T>(
  items: T[],
  searchValue: string,
  getItemText: (item: T) => string,
  strategy: FilterStrategy = 'contains'
): T[] {
  if (!searchValue.trim()) {
    return items;
  }

  const normalizedSearch = searchValue.toLowerCase().trim();

  return items.filter(item => {
    const itemText = getItemText(item).toLowerCase();
    
    if (strategy === 'startsWith') {
      return itemText.startsWith(normalizedSearch);
    }
    
    return itemText.includes(normalizedSearch);
  });
}

/**
 * Filter simple string arrays
 * @param items - Array of strings to filter
 * @param searchValue - The search input value
 * @param strategy - Matching strategy (default: 'contains')
 * @returns Filtered array of strings
 */
export function filterStringItems(
  items: string[],
  searchValue: string,
  strategy: FilterStrategy = 'contains'
): string[] {
  return filterItems(items, searchValue, (item) => item, strategy);
}

/**
 * Check if an item matches the search criteria for highlighting
 * @param itemText - The item text to check
 * @param searchValue - The search input value
 * @param strategy - Matching strategy (default: 'startsWith')
 * @returns Boolean indicating if item should be highlighted
 */
export function isItemHighlighted(
  itemText: string,
  searchValue: string,
  strategy: FilterStrategy = 'startsWith'
): boolean {
  if (!searchValue.trim()) {
    return false;
  }

  const normalizedSearch = searchValue.toLowerCase().trim();
  const normalizedItem = itemText.toLowerCase();

  if (strategy === 'startsWith') {
    return normalizedItem.startsWith(normalizedSearch);
  }

  return normalizedItem.includes(normalizedSearch);
}