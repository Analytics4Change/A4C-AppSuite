/**
 * Permission Selector Component
 *
 * Renders permissions grouped by applet with checkbox selection.
 * Implements subset-only delegation (users can only grant permissions they possess).
 *
 * Features:
 * - Groups permissions by applet (e.g., Medication, Client, etc.)
 * - "Select All" checkbox per applet with indeterminate state
 * - Disabled checkboxes for permissions user doesn't possess
 * - WCAG 2.1 Level AA compliant with full keyboard navigation
 *
 * @see RoleFormViewModel for state management
 */

import React, { useCallback, useId } from 'react';
import { observer } from 'mobx-react-lite';
import { cn } from '@/components/ui/utils';
import { Checkbox } from '@/components/ui/checkbox';
import type { Permission, PermissionGroup } from '@/types/role.types';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('component');

/**
 * Props for PermissionSelector component
 */
export interface PermissionSelectorProps {
  /** Permission groups to display */
  permissionGroups: PermissionGroup[];

  /** Set of currently selected permission IDs */
  selectedIds: Set<string>;

  /** Set of permission IDs the user possesses (for subset-only enforcement) */
  userPermissionIds: Set<string>;

  /** Callback when a permission is toggled */
  onTogglePermission: (permissionId: string) => void;

  /** Callback when all permissions in an applet are toggled */
  onToggleApplet: (applet: string) => void;

  /** Check if an applet is fully selected */
  isAppletFullySelected: (applet: string) => boolean;

  /** Check if an applet is partially selected */
  isAppletPartiallySelected: (applet: string) => boolean;

  /** Check if user can grant a permission */
  canGrant: (permissionId: string) => boolean;

  /** Whether the selector is disabled */
  disabled?: boolean;

  /** Additional CSS classes */
  className?: string;

  // Filter props
  /** Whether to show only grantable permissions */
  showOnlyGrantable?: boolean;

  /** Callback to toggle showOnlyGrantable filter */
  onToggleShowOnlyGrantable?: () => void;

  /** Current search term */
  searchTerm?: string;

  /** Callback when search term changes */
  onSearchChange?: (term: string) => void;

  /** Check if an applet group is collapsed */
  isAppletCollapsed?: (applet: string) => boolean;

  /** Callback to toggle applet collapsed state */
  onToggleAppletCollapsed?: (applet: string) => void;

  /** Callback to expand all applets */
  onExpandAll?: () => void;

  /** Callback to collapse all applets */
  onCollapseAll?: () => void;
}

/**
 * Display name mapping for applets
 */
const APPLET_DISPLAY_NAMES: Record<string, string> = {
  medication: 'Medication Management',
  client: 'Client Management',
  behavior: 'Behavior Management',
  billing: 'Billing & Claims',
  reporting: 'Reports & Analytics',
  admin: 'Administration',
  role: 'Role Management',
  organization: 'Organization Management',
};

/**
 * Get display name for an applet
 */
function getAppletDisplayName(applet: string): string {
  return (
    APPLET_DISPLAY_NAMES[applet] ||
    applet.charAt(0).toUpperCase() + applet.slice(1) + ' Management'
  );
}

/**
 * Single permission row component
 */
interface PermissionRowProps {
  permission: Permission;
  isSelected: boolean;
  canGrant: boolean;
  disabled: boolean;
  onToggle: (permissionId: string) => void;
}

const PermissionRow: React.FC<PermissionRowProps> = React.memo(
  ({ permission, isSelected, canGrant, disabled, onToggle }) => {
    const checkboxId = useId();
    const isDisabled = disabled || !canGrant;

    const handleChange = useCallback(() => {
      if (!isDisabled) {
        onToggle(permission.id);
      }
    }, [isDisabled, onToggle, permission.id]);

    // Use displayName if available, otherwise format the action name
    const displayLabel =
      permission.displayName ||
      permission.action.charAt(0).toUpperCase() + permission.action.slice(1).replace(/_/g, ' ');

    return (
      <div
        className={cn(
          'flex items-start gap-3 py-2 px-3 rounded-md transition-colors',
          isDisabled && 'opacity-50 cursor-not-allowed',
          !isDisabled && 'hover:bg-gray-50'
        )}
      >
        <Checkbox
          id={checkboxId}
          checked={isSelected}
          onCheckedChange={handleChange}
          disabled={isDisabled}
          className="mt-0.5"
          aria-describedby={`${checkboxId}-description`}
        />
        <div className="flex-1 min-w-0">
          <label
            htmlFor={checkboxId}
            className={cn(
              'block text-sm font-medium',
              isDisabled ? 'text-gray-400 cursor-not-allowed' : 'text-gray-900 cursor-pointer'
            )}
          >
            {displayLabel}
          </label>
          <p
            id={`${checkboxId}-description`}
            className={cn('text-xs', isDisabled ? 'text-gray-400' : 'text-gray-500')}
          >
            {permission.description}
          </p>
          {!canGrant && (
            <p className="text-xs text-amber-600 mt-1">
              You don't have this permission
            </p>
          )}
        </div>
      </div>
    );
  }
);

PermissionRow.displayName = 'PermissionRow';

/**
 * Applet group component with "Select All" checkbox
 */
interface AppletGroupProps {
  group: PermissionGroup;
  selectedIds: Set<string>;
  userPermissionIds: Set<string>;
  isFullySelected: boolean;
  isPartiallySelected: boolean;
  canGrant: (permissionId: string) => boolean;
  disabled: boolean;
  onTogglePermission: (permissionId: string) => void;
  onToggleApplet: (applet: string) => void;
  isCollapsed: boolean;
  onToggleCollapsed: () => void;
}

const AppletGroup: React.FC<AppletGroupProps> = React.memo(
  ({
    group,
    selectedIds,
    isFullySelected,
    isPartiallySelected,
    canGrant,
    disabled,
    onTogglePermission,
    onToggleApplet,
    isCollapsed,
    onToggleCollapsed,
  }) => {
    const groupId = useId();
    const selectAllId = `${groupId}-select-all`;
    const displayName = group.displayName || getAppletDisplayName(group.applet);

    // Count grantable permissions
    const grantableCount = group.permissions.filter((p) => canGrant(p.id)).length;
    const selectedCount = group.permissions.filter(
      (p) => canGrant(p.id) && selectedIds.has(p.id)
    ).length;

    const handleSelectAllChange = useCallback(() => {
      if (!disabled && grantableCount > 0) {
        onToggleApplet(group.applet);
      }
    }, [disabled, grantableCount, onToggleApplet, group.applet]);

    return (
      <fieldset
        className="border border-gray-200 rounded-lg overflow-hidden"
        role="group"
        aria-labelledby={groupId}
      >
        {/* Applet header with "Select All" and collapse toggle */}
        <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {/* Collapse/Expand toggle */}
              <button
                type="button"
                onClick={onToggleCollapsed}
                className="p-1 rounded hover:bg-gray-200 transition-colors"
                aria-expanded={!isCollapsed}
                aria-label={isCollapsed ? `Expand ${displayName}` : `Collapse ${displayName}`}
              >
                <svg
                  className={cn(
                    'w-4 h-4 text-gray-500 transition-transform',
                    isCollapsed ? '' : 'rotate-90'
                  )}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
              <Checkbox
                id={selectAllId}
                checked={isFullySelected}
                onCheckedChange={handleSelectAllChange}
                disabled={disabled || grantableCount === 0}
                className="data-[state=indeterminate]:bg-blue-500"
                {...(isPartiallySelected && !isFullySelected ? { 'data-state': 'indeterminate' } : {})}
                aria-label={`Select all permissions in ${displayName}`}
              />
              <label
                id={groupId}
                htmlFor={selectAllId}
                className={cn(
                  'font-semibold',
                  disabled || grantableCount === 0
                    ? 'text-gray-400 cursor-not-allowed'
                    : 'text-gray-900 cursor-pointer'
                )}
              >
                {displayName}
              </label>
            </div>
            <span className="text-sm text-gray-500">
              {selectedCount} / {grantableCount} selected
            </span>
          </div>
        </div>

        {/* Permission list (collapsible) */}
        {!isCollapsed && (
          <div className="p-2 grid grid-cols-1 sm:grid-cols-2 gap-1">
            {group.permissions.map((permission) => (
              <PermissionRow
                key={permission.id}
                permission={permission}
                isSelected={selectedIds.has(permission.id)}
                canGrant={canGrant(permission.id)}
                disabled={disabled}
                onToggle={onTogglePermission}
              />
            ))}
          </div>
        )}
      </fieldset>
    );
  }
);

AppletGroup.displayName = 'AppletGroup';

/**
 * Permission Selector Component
 *
 * Renders a grouped permission selector with subset-only enforcement.
 * Permissions the user doesn't possess are visually disabled.
 *
 * For platform_owner users with global permissions, displays two sections
 * separated by horizontal dividers (not collapsible groups):
 * - "Global Scope" - global-scope permissions (platform-wide)
 * - "Organization Scope" - org/facility/program/client scope permissions
 *
 * For non-platform_owner users, displays a flat list of applet groups
 * with no section dividers.
 */
export const PermissionSelector = observer(
  ({
    permissionGroups,
    selectedIds,
    userPermissionIds,
    onTogglePermission,
    onToggleApplet,
    isAppletFullySelected,
    isAppletPartiallySelected,
    canGrant,
    disabled = false,
    className,
    // Filter props with defaults for backward compatibility
    showOnlyGrantable = true,
    onToggleShowOnlyGrantable,
    searchTerm = '',
    onSearchChange,
    isAppletCollapsed,
    onToggleAppletCollapsed,
    onExpandAll,
    onCollapseAll,
  }: PermissionSelectorProps) => {
    const searchInputId = useId();

    log.debug('PermissionSelector render', {
      groupCount: permissionGroups.length,
      selectedCount: selectedIds.size,
    });

    // Calculate total stats
    const totalPermissions = permissionGroups.reduce((sum, g) => sum + g.permissions.length, 0);
    const totalGrantable = permissionGroups.reduce(
      (sum, g) => sum + g.permissions.filter((p) => canGrant(p.id)).length,
      0
    );
    const totalSelected = selectedIds.size;

    // Check if there are any global-scope permissions (indicates platform_owner)
    const hasGlobalPermissions = permissionGroups.some((g) =>
      g.permissions.some((p) => p.scopeType === 'global')
    );

    // Separate groups by scope if global permissions exist
    const globalGroups = hasGlobalPermissions
      ? permissionGroups
          .map((g) => ({
            ...g,
            permissions: g.permissions.filter((p) => p.scopeType === 'global'),
          }))
          .filter((g) => g.permissions.length > 0)
      : [];

    const orgGroups = hasGlobalPermissions
      ? permissionGroups
          .map((g) => ({
            ...g,
            permissions: g.permissions.filter((p) => p.scopeType !== 'global'),
          }))
          .filter((g) => g.permissions.length > 0)
      : permissionGroups;

    // Check if filtering features are available
    const hasFilterControls = onToggleShowOnlyGrantable || onSearchChange;
    const hasCollapseControls = onToggleAppletCollapsed && isAppletCollapsed;

    if (permissionGroups.length === 0) {
      return (
        <div
          className={cn(
            'flex items-center justify-center p-8 text-gray-500 border-2 border-dashed rounded-lg',
            className
          )}
        >
          <p>No permissions available.</p>
        </div>
      );
    }

    const renderGroups = (groups: typeof permissionGroups) =>
      groups.map((group) => (
        <AppletGroup
          key={group.applet}
          group={group}
          selectedIds={selectedIds}
          userPermissionIds={userPermissionIds}
          isFullySelected={isAppletFullySelected(group.applet)}
          isPartiallySelected={isAppletPartiallySelected(group.applet)}
          canGrant={canGrant}
          disabled={disabled}
          onTogglePermission={onTogglePermission}
          onToggleApplet={onToggleApplet}
          isCollapsed={isAppletCollapsed ? isAppletCollapsed(group.applet) : false}
          onToggleCollapsed={() => onToggleAppletCollapsed?.(group.applet)}
        />
      ));

    return (
      <div className={cn('space-y-4', className)}>
        {/* Summary header */}
        <div className="flex items-center justify-between px-1">
          <h3 className="text-sm font-medium text-gray-700">Permissions</h3>
          <span className="text-sm text-gray-500">
            {totalSelected} of {totalGrantable} grantable permissions selected
            {totalGrantable < totalPermissions && (
              <span className="text-xs text-amber-600 ml-2">
                ({totalPermissions - totalGrantable} restricted)
              </span>
            )}
          </span>
        </div>

        {/* Filter toolbar */}
        {hasFilterControls && (
          <div className="bg-gray-50 rounded-lg p-3 space-y-3">
            <div className="flex flex-wrap items-center gap-4">
              {/* Search input */}
              {onSearchChange && (
                <div className="flex-1 min-w-[200px]">
                  <label htmlFor={searchInputId} className="sr-only">
                    Search permissions
                  </label>
                  <div className="relative">
                    <svg
                      className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                      />
                    </svg>
                    <input
                      id={searchInputId}
                      type="text"
                      value={searchTerm}
                      onChange={(e) => onSearchChange(e.target.value)}
                      placeholder="Search permissions..."
                      className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      aria-label="Search permissions by name or description"
                    />
                    {searchTerm && (
                      <button
                        type="button"
                        onClick={() => onSearchChange('')}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
                        aria-label="Clear search"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M6 18L18 6M6 6l12 12"
                          />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Show only grantable toggle */}
              {onToggleShowOnlyGrantable && (
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="show-grantable-only"
                    checked={showOnlyGrantable}
                    onCheckedChange={onToggleShowOnlyGrantable}
                    aria-describedby="show-grantable-description"
                  />
                  <label
                    htmlFor="show-grantable-only"
                    className="text-sm text-gray-700 cursor-pointer"
                  >
                    Show only grantable
                  </label>
                  <span id="show-grantable-description" className="sr-only">
                    When enabled, only shows permissions you can grant to this role
                  </span>
                </div>
              )}
            </div>

            {/* Expand/Collapse all buttons */}
            {hasCollapseControls && (onExpandAll || onCollapseAll) && (
              <div className="flex items-center gap-2 text-sm">
                {onExpandAll && (
                  <button
                    type="button"
                    onClick={onExpandAll}
                    className="text-blue-600 hover:text-blue-800 hover:underline"
                  >
                    Expand all
                  </button>
                )}
                {onExpandAll && onCollapseAll && (
                  <span className="text-gray-300">|</span>
                )}
                {onCollapseAll && (
                  <button
                    type="button"
                    onClick={onCollapseAll}
                    className="text-blue-600 hover:text-blue-800 hover:underline"
                  >
                    Collapse all
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* No results message */}
        {permissionGroups.length === 0 && searchTerm && (
          <div className="text-center py-8 text-gray-500">
            <p>No permissions match "{searchTerm}"</p>
            <button
              type="button"
              onClick={() => onSearchChange?.('')}
              className="mt-2 text-blue-600 hover:underline"
            >
              Clear search
            </button>
          </div>
        )}

        {/* Scope-based sections for platform_owner, or simple groups for others */}
        {hasGlobalPermissions ? (
          <>
            {/* Global-scope permissions section (platform_owner only) */}
            {globalGroups.length > 0 && (
              <div className="space-y-4">
                {/* Section divider - clearly NOT a collapsible group */}
                <div className="flex items-center gap-3 py-1" role="separator" aria-label="Global scope permissions">
                  <div className="h-px flex-1 bg-purple-200"></div>
                  <span className="text-xs font-semibold uppercase tracking-wider text-purple-600 whitespace-nowrap">
                    Global Scope
                  </span>
                  <div className="h-px flex-1 bg-purple-200"></div>
                </div>
                {renderGroups(globalGroups)}
              </div>
            )}

            {/* Organization-scope permissions section */}
            {orgGroups.length > 0 && (
              <div className="space-y-4">
                {/* Section divider */}
                <div className="flex items-center gap-3 py-1" role="separator" aria-label="Organization scope permissions">
                  <div className="h-px flex-1 bg-blue-200"></div>
                  <span className="text-xs font-semibold uppercase tracking-wider text-blue-600 whitespace-nowrap">
                    Organization Scope
                  </span>
                  <div className="h-px flex-1 bg-blue-200"></div>
                </div>
                {renderGroups(orgGroups)}
              </div>
            )}
          </>
        ) : (
          /* Standard groups for non-platform_owner users - flat list, no section dividers */
          <div className="space-y-4">{renderGroups(orgGroups)}</div>
        )}
      </div>
    );
  }
);

PermissionSelector.displayName = 'PermissionSelector';
