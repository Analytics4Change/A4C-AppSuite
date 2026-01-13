/**
 * Role List Component
 *
 * Renders a filterable list of roles with search, status filter, and selection.
 * Displays role cards with metadata including user count, permission count, and scope.
 *
 * Features:
 * - Search filtering by role name
 * - Status filter (all, active, inactive)
 * - Role cards with status badges
 * - Selection state management
 * - WCAG 2.1 Level AA compliant
 *
 * @see RolesViewModel for state management
 */

import React, { useCallback, useId } from 'react';
import { observer } from 'mobx-react-lite';
import { cn } from '@/components/ui/utils';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Search, Users, Shield, Building2 } from 'lucide-react';
import type { Role, RoleFilterOptions } from '@/types/role.types';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('component');

/**
 * Props for RoleList component
 */
export interface RoleListProps {
  /** List of roles to display */
  roles: Role[];

  /** Currently selected role ID */
  selectedRoleId: string | null;

  /** Current filter options */
  filters: RoleFilterOptions;

  /** Whether data is loading */
  isLoading: boolean;

  /** Callback when a role is selected */
  onSelect: (roleId: string) => void;

  /** Callback when search filter changes */
  onSearchChange: (searchTerm: string) => void;

  /** Callback when status filter changes */
  onStatusChange: (status: 'all' | 'active' | 'inactive') => void;

  /** Additional CSS classes */
  className?: string;
}

/**
 * Status filter options
 */
const STATUS_OPTIONS: { value: 'all' | 'active' | 'inactive'; label: string }[] = [
  { value: 'all', label: 'All Roles' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
];

/**
 * Role card component
 */
interface RoleCardProps {
  role: Role;
  isSelected: boolean;
  onSelect: (roleId: string) => void;
}

const RoleCard: React.FC<RoleCardProps> = React.memo(({ role, isSelected, onSelect }) => {
  const handleClick = useCallback(() => {
    onSelect(role.id);
  }, [onSelect, role.id]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onSelect(role.id);
      }
    },
    [onSelect, role.id]
  );

  return (
    <li>
      <button
        type="button"
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        className={cn(
          'w-full text-left p-4 rounded-lg border transition-all',
          'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2',
          isSelected
            ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500'
            : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
        )}
        aria-selected={isSelected}
        aria-label={`${role.name}, ${role.isActive ? 'active' : 'inactive'}, ${role.userCount} users, ${role.permissionCount} permissions`}
      >
        {/* Header with name and status */}
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold text-gray-900 truncate">{role.name}</h3>
          <span
            className={cn(
              'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0',
              role.isActive
                ? 'bg-green-100 text-green-800'
                : 'bg-gray-100 text-gray-600'
            )}
          >
            {role.isActive ? 'Active' : 'Inactive'}
          </span>
        </div>

        {/* Description */}
        {role.description && (
          <p className="mt-1 text-sm text-gray-600 line-clamp-2">{role.description}</p>
        )}

        {/* Metadata row */}
        <div className="mt-3 flex items-center gap-4 text-xs text-gray-500">
          {/* User count */}
          <span className="flex items-center gap-1" title={`${role.userCount} users assigned`}>
            <Users className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{role.userCount}</span>
          </span>

          {/* Permission count */}
          <span
            className="flex items-center gap-1"
            title={`${role.permissionCount} permissions`}
          >
            <Shield className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{role.permissionCount}</span>
          </span>

          {/* Scope (if set) */}
          {role.orgHierarchyScope && (
            <span className="flex items-center gap-1" title={`Scoped to: ${role.orgHierarchyScope}`}>
              <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="truncate max-w-[100px]">
                {role.orgHierarchyScope.split('.').pop()}
              </span>
            </span>
          )}
        </div>
      </button>
    </li>
  );
});

RoleCard.displayName = 'RoleCard';

/**
 * Loading skeleton for role card
 */
const RoleCardSkeleton: React.FC = () => (
  <li className="p-4 rounded-lg border border-gray-200 bg-white animate-pulse">
    <div className="flex items-start justify-between gap-2">
      <div className="h-5 bg-gray-200 rounded w-32" />
      <div className="h-5 bg-gray-200 rounded w-16" />
    </div>
    <div className="mt-2 h-4 bg-gray-200 rounded w-3/4" />
    <div className="mt-3 flex items-center gap-4">
      <div className="h-4 bg-gray-200 rounded w-12" />
      <div className="h-4 bg-gray-200 rounded w-12" />
    </div>
  </li>
);

/**
 * Role List Component
 *
 * Renders a filterable list of roles with selection support.
 */
export const RoleList = observer(
  ({
    roles,
    selectedRoleId,
    filters,
    isLoading,
    onSelect,
    onSearchChange,
    onStatusChange,
    className,
  }: RoleListProps) => {
    const searchId = useId();

    log.debug('RoleList render', {
      roleCount: roles.length,
      selectedRoleId,
      isLoading,
    });

    const handleSearchChange = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        onSearchChange(e.target.value);
      },
      [onSearchChange]
    );

    return (
      <div className={cn('flex flex-col h-full', className)}>
        {/* Filters */}
        <div className="flex-shrink-0 space-y-3 pb-4 border-b border-gray-200">
          {/* Search input */}
          <div>
            <Label htmlFor={searchId} className="sr-only">
              Search roles
            </Label>
            <div className="relative">
              <Search
                className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400"
                aria-hidden="true"
              />
              <Input
                id={searchId}
                type="search"
                placeholder="Search roles..."
                value={filters.searchTerm || ''}
                onChange={handleSearchChange}
                className="pl-9"
                aria-label="Search roles by name"
              />
            </div>
          </div>

          {/* Status filter tabs */}
          <div className="flex gap-2 flex-wrap" role="group" aria-label="Filter by status">
            {STATUS_OPTIONS.map((option) => {
              const isSelected = (filters.status || 'all') === option.value;
              return (
                <Button
                  key={option.value}
                  size="sm"
                  variant={isSelected ? 'default' : 'outline'}
                  onClick={() => onStatusChange(option.value)}
                  className={cn(
                    'flex items-center gap-1.5 transition-all',
                    isSelected
                      ? 'bg-blue-600 text-white hover:bg-blue-700'
                      : 'hover:bg-gray-100'
                  )}
                  aria-pressed={isSelected}
                >
                  {option.label}
                </Button>
              );
            })}
          </div>
        </div>

        {/* Role count */}
        <div className="flex-shrink-0 py-2 text-sm text-gray-500">
          {isLoading ? (
            <span>Loading roles...</span>
          ) : (
            <span>
              {roles.length} role{roles.length !== 1 ? 's' : ''}
              {filters.searchTerm && ` matching "${filters.searchTerm}"`}
            </span>
          )}
        </div>

        {/* Role list */}
        <div className="flex-1 overflow-y-auto -mx-1 px-1">
          {isLoading ? (
            <ul className="space-y-2" aria-busy="true" aria-label="Loading roles">
              {[1, 2, 3].map((n) => (
                <RoleCardSkeleton key={n} />
              ))}
            </ul>
          ) : roles.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Shield className="h-12 w-12 text-gray-300 mb-4" aria-hidden="true" />
              <h3 className="text-lg font-medium text-gray-900">No roles found</h3>
              <p className="mt-1 text-sm text-gray-500">
                {filters.searchTerm
                  ? 'Try adjusting your search or filters.'
                  : 'Create a new role to get started.'}
              </p>
            </div>
          ) : (
            <ul
              className="space-y-2"
              role="listbox"
              aria-label="Roles"
              aria-activedescendant={selectedRoleId || undefined}
            >
              {roles.map((role) => (
                <RoleCard
                  key={role.id}
                  role={role}
                  isSelected={role.id === selectedRoleId}
                  onSelect={onSelect}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  }
);

RoleList.displayName = 'RoleList';
