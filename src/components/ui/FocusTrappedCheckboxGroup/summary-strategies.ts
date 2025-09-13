/**
 * Summary strategy pattern for generating inline summaries of checkbox additional data
 * Allows different checkbox groups to customize how they display summary information
 */

/**
 * Base interface for all summary strategies
 * Each checkbox group type can implement its own strategy
 */
export interface SummaryStrategy {
  /**
   * Generate a summary string for display when checkbox is selected
   * @param checkboxId - The ID of the checkbox
   * @param data - The additional data associated with the checkbox
   * @returns A summary string to display inline
   */
  generateSummary(checkboxId: string, data: any): string;
  
  /**
   * Maximum length for summary before truncation
   */
  maxLength?: number;
}

/**
 * Dosage Timing specific summary implementation
 * Handles different timing types: specific times, intervals, PRN
 */
export class DosageTimingSummaryStrategy implements SummaryStrategy {
  maxLength = 30;
  
  generateSummary(checkboxId: string, data: any): string {
    if (!data) return '';
    
    switch(checkboxId) {
      case 'specific-times': {
        // For specific times, show the times entered
        const times = String(data).slice(0, this.maxLength);
        return data.length > this.maxLength ? `${times}...` : times;
      }
      
      case 'every-x-hours': {
        // For intervals, show "Every X hours"
        return data ? `Every ${data} hours` : '';
      }
      
      case 'as-needed-prn': {
        // For PRN, show the max frequency if specified
        return data || 'PRN';
      }
      
      case 'with-meals': {
        // For meals, might specify which meals
        return data || 'With meals';
      }
      
      default:
        // For checkboxes without additional data, return empty
        return '';
    }
  }
}

/**
 * Future: Frequency summary strategy
 * Example implementation for when we convert Frequency to use this component
 */
export class FrequencySummaryStrategy implements SummaryStrategy {
  generateSummary(checkboxId: string, data: any): string {
    if (!data || typeof data !== 'object') return '';
    
    // Example: { count: 2, unit: 'times per day' }
    if (data.count && data.unit) {
      return `${data.count} ${data.unit}`;
    }
    
    return '';
  }
}

/**
 * Future: Food Conditions summary strategy
 */
export class FoodConditionsSummaryStrategy implements SummaryStrategy {
  generateSummary(checkboxId: string, data: any): string {
    if (!data) return '';
    
    switch(checkboxId) {
      case 'with-food':
        return data || 'Take with food';
      
      case 'empty-stomach':
        return data ? `${data} before/after meals` : 'Empty stomach';
      
      case 'dietary-restriction':
        return data || 'See restrictions';
      
      default:
        return '';
    }
  }
}

/**
 * Default summary strategy that simply stringifies the data
 * Used when no specific strategy is provided
 */
export class DefaultSummaryStrategy implements SummaryStrategy {
  maxLength = 50;
  
  generateSummary(checkboxId: string, data: any): string {
    if (!data) return '';
    
    const str = typeof data === 'object' ? JSON.stringify(data) : String(data);
    return str.length > this.maxLength ? `${str.slice(0, this.maxLength)}...` : str;
  }
}