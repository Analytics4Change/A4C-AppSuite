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
      
      case 'qxh': {
        // For regular intervals, show "Every X hours"
        return data ? `Every ${data} hours` : '';
      }
      
      case 'qxh-range': {
        // For interval range, show "Every X to Y hours"
        if (data && typeof data === 'object' && data.min && data.max) {
          return `Every ${data.min} to ${data.max} hours`;
        }
        return '';
      }
      
      case 'prn': {
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
 * Dosage Frequency summary strategy
 * Handles PRN with optional notes and PRN with max hours
 */
export class DosageFrequencySummaryStrategy implements SummaryStrategy {
  maxLength = 40;
  
  generateSummary(checkboxId: string, data: any): string {
    if (!data) return '';
    
    switch(checkboxId) {
      case 'prn': {
        // For PRN, show the optional notes if provided
        if (data) {
          const notes = String(data).slice(0, this.maxLength);
          return data.length > this.maxLength ? `${notes}...` : notes;
        }
        return '';
      }
      
      case 'prn-max': {
        // For PRN with max frequency, show "Not to exceed every X hours"
        return data ? `Not to exceed every ${data} hrs` : '';
      }
      
      default:
        // Other frequency checkboxes don't have additional data
        return '';
    }
  }
}

/**
 * Legacy FrequencySummaryStrategy - kept for compatibility
 * @deprecated Use DosageFrequencySummaryStrategy instead
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

/**
 * Summary strategy for Food Conditions checkbox group
 * Handles summary generation for the Other checkbox with text input
 */
export class FoodConditionsSummaryStrategy implements SummaryStrategy {
  maxLength = 30;
  
  generateSummary(checkboxId: string, data: any): string {
    if (!data) return '';
    
    switch(checkboxId) {
      case 'other': {
        // For other, show the first part of the custom instructions
        const text = String(data).slice(0, this.maxLength);
        return data.length > this.maxLength ? `${text}...` : text;
      }
      
      default:
        // Other checkboxes don't have additional data
        return '';
    }
  }
}

/**
 * Summary strategy for Special Restrictions checkbox group
 * Handles summary generation for the Other checkbox with text input
 */
export class SpecialRestrictionsSummaryStrategy implements SummaryStrategy {
  maxLength = 30;
  
  generateSummary(checkboxId: string, data: any): string {
    if (!data) return '';
    
    switch(checkboxId) {
      case 'other': {
        // For other, show the first part of the custom restrictions
        const text = String(data).slice(0, this.maxLength);
        return data.length > this.maxLength ? `${text}...` : text;
      }
      
      default:
        // Other checkboxes don't have additional data
        return '';
    }
  }
}