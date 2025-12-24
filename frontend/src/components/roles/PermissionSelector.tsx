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
            {permission.action.charAt(0).toUpperCase() + permission.action.slice(1)}
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
        {/* Applet header with "Select All" */}
        <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
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

        {/* Permission list */}
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
  }: PermissionSelectorProps) => {
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

        {/* Permission groups */}
        <div className="space-y-4">
          {permissionGroups.map((group) => (
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
            />
          ))}
        </div>
      </div>
    );
  }
);

PermissionSelector.displayName = 'PermissionSelector';
