/**
 * Permission Utilities
 *
 * Utility functions for scope-aware permission checking.
 * Implements ltree containment semantics in TypeScript.
 */

/**
 * Check if scopePath contains targetPath (ltree @> semantics).
 *
 * A scope "contains" a target when the target is at or below
 * the scope in the organizational hierarchy.
 *
 * Examples:
 *   isPathContained('acme', 'acme')                    → true  (exact match)
 *   isPathContained('acme', 'acme.pediatrics')          → true  (child)
 *   isPathContained('acme', 'acme.pediatrics.unit1')    → true  (grandchild)
 *   isPathContained('acme.pediatrics', 'acme')          → false (parent, not child)
 *   isPathContained('acme', 'other')                    → false (unrelated)
 *   isPathContained('', 'acme')                         → true  (global scope)
 *   isPathContained('*', 'acme')                        → true  (wildcard)
 *
 * @param scopePath - The user's granted scope (from effective_permissions[].s)
 * @param targetPath - The resource's path to check access for
 * @returns true if the scope contains (grants access to) the target path
 */
export function isPathContained(scopePath: string, targetPath: string): boolean {
  // Global scope or wildcard: access to everything
  if (scopePath === '' || scopePath === '*') return true;
  // No target path specified: scope grants access
  if (!targetPath) return true;
  // Exact match or target is a descendant
  return targetPath === scopePath || targetPath.startsWith(scopePath + '.');
}
