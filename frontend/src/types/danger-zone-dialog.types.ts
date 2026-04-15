/**
 * Shared base type for danger zone dialog states.
 *
 * Each entity management page extends this with page-specific variants.
 * See documentation/frontend/patterns/danger-zone-pattern.md for usage.
 */

/** Base dialog states shared by all entity management pages */
export type BaseDangerZoneState =
  | { type: 'none' }
  | { type: 'deactivate'; isLoading: boolean }
  | { type: 'reactivate'; isLoading: boolean }
  | { type: 'delete'; isLoading: boolean }
  | { type: 'discard' }
  | { type: 'activeWarning' };
