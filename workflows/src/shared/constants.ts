/**
 * Shared Constants
 *
 * Centralized constants for consistent values across workflows and activities.
 */

// =============================================================================
// Aggregate Types
// =============================================================================

/**
 * Standard aggregate type identifiers for domain events.
 * Use these constants instead of string literals for consistency.
 *
 * All values are lowercase to match database conventions.
 */
export const AGGREGATE_TYPES = {
  ORGANIZATION: 'organization',
  CONTACT: 'contact',
  ADDRESS: 'address',
  PHONE: 'phone',
  INVITATION: 'invitation',
  JUNCTION: 'junction',
} as const;

export type AggregateType = (typeof AGGREGATE_TYPES)[keyof typeof AGGREGATE_TYPES];
