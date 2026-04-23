/**
 * Organizational Unit Path Helpers
 *
 * TreeSelectDropdown identifies nodes by their ltree `path` string, while
 * domain data (clients_projection.organization_unit_id, placement events,
 * etc.) stores the OU's UUID. These helpers bridge the two representations.
 *
 * @see frontend/src/components/ui/TreeSelectDropdown.tsx (consumer)
 * @see frontend/src/types/organization-unit.types.ts (OrganizationUnit shape)
 */

import type { OrganizationUnit } from '@/types/organization-unit.types';

/**
 * Resolve an OU's ltree path from its UUID.
 *
 * @returns the unit's `path` when found; `null` when `id` is `null`/`undefined`
 *   or no unit with that id exists in the provided list (e.g. deactivated OU
 *   filtered out, or stale id referencing a deleted unit).
 */
export function getOUPathById(
  units: readonly OrganizationUnit[],
  id: string | null | undefined
): string | null {
  if (!id) return null;
  const match = units.find((u) => u.id === id);
  return match ? match.path : null;
}

/**
 * Resolve an OU's UUID from its ltree path.
 *
 * @returns the unit's `id` when found; `null` when `path` is `null`/`undefined`
 *   or no unit with that path exists in the provided list.
 */
export function getOUIdByPath(
  units: readonly OrganizationUnit[],
  path: string | null | undefined
): string | null {
  if (!path) return null;
  const match = units.find((u) => u.path === path);
  return match ? match.id : null;
}
