import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Shield, Edit, Power, PowerOff, Key, FolderTree } from 'lucide-react';
import { Role } from '@/types/role.types';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('component');

interface RoleCardProps {
  /** The role to display */
  role: Role;
  /** Called when deactivate action is triggered */
  onDeactivate?: (roleId: string) => void;
  /** Called when reactivate action is triggered */
  onReactivate?: (roleId: string) => void;
  /** Whether actions are currently loading */
  isLoading?: boolean;
}

/**
 * RoleCard - Displays a role as a glass-morphism styled card
 *
 * Shows role name, status badge, description, permission count, and scope.
 * Includes quick action buttons for Edit and Deactivate/Reactivate.
 *
 * @example
 * <RoleCard
 *   role={role}
 *   onDeactivate={(id) => viewModel.deactivateRole(id)}
 *   onReactivate={(id) => viewModel.reactivateRole(id)}
 * />
 */
export const RoleCard: React.FC<RoleCardProps> = ({
  role,
  onDeactivate,
  onReactivate,
  isLoading = false,
}) => {
  const navigate = useNavigate();

  log.debug('RoleCard rendering', { roleId: role.id, roleName: role.name });

  const handleCardClick = () => {
    navigate(`/roles/manage?roleId=${role.id}`);
  };

  const handleEditClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigate(`/roles/manage?roleId=${role.id}`);
  };

  const handleDeactivateClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDeactivate?.(role.id);
  };

  const handleReactivateClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onReactivate?.(role.id);
  };

  // Truncate description to ~100 chars
  const truncatedDescription =
    role.description.length > 100
      ? `${role.description.slice(0, 100)}...`
      : role.description;

  return (
    <Card
      data-testid="role-card"
      className="glass-card hover:glass-card-hover transition-all duration-300 cursor-pointer group"
      onClick={handleCardClick}
      style={{
        background: 'rgba(255, 255, 255, 0.7)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: '1px solid',
        borderImage:
          'linear-gradient(135deg, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0.2) 50%, rgba(255,255,255,0.5) 100%) 1',
        boxShadow: `
          0 0 0 1px rgba(255, 255, 255, 0.18) inset,
          0 2px 4px rgba(0, 0, 0, 0.04),
          0 4px 8px rgba(0, 0, 0, 0.04),
          0 8px 16px rgba(0, 0, 0, 0.04)
        `.trim(),
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = `
          0 0 0 1px rgba(255, 255, 255, 0.25) inset,
          0 0 20px rgba(59, 130, 246, 0.15) inset,
          0 2px 4px rgba(0, 0, 0, 0.05),
          0 4px 8px rgba(0, 0, 0, 0.05),
          0 12px 24px rgba(0, 0, 0, 0.08),
          0 24px 48px rgba(59, 130, 246, 0.1)
        `.trim();
        e.currentTarget.style.borderImage =
          'linear-gradient(135deg, rgba(255,255,255,0.7) 0%, rgba(59,130,246,0.3) 50%, rgba(255,255,255,0.7) 100%) 1';
        e.currentTarget.style.transform = 'translateY(-2px)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = `
          0 0 0 1px rgba(255, 255, 255, 0.18) inset,
          0 2px 4px rgba(0, 0, 0, 0.04),
          0 4px 8px rgba(0, 0, 0, 0.04),
          0 8px 16px rgba(0, 0, 0, 0.04)
        `.trim();
        e.currentTarget.style.borderImage =
          'linear-gradient(135deg, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0.2) 50%, rgba(255,255,255,0.5) 100%) 1';
        e.currentTarget.style.transform = 'translateY(0)';
      }}
    >
      <CardHeader className="pb-4">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div
              className="p-2 rounded-full transition-all duration-300 group-hover:scale-110"
              style={{
                background: role.isActive
                  ? 'linear-gradient(135deg, rgba(59, 130, 246, 0.15) 0%, rgba(59, 130, 246, 0.25) 100%)'
                  : 'linear-gradient(135deg, rgba(156, 163, 175, 0.15) 0%, rgba(156, 163, 175, 0.25) 100%)',
                backdropFilter: 'blur(10px)',
                WebkitBackdropFilter: 'blur(10px)',
                border: role.isActive
                  ? '1px solid rgba(59, 130, 246, 0.2)'
                  : '1px solid rgba(156, 163, 175, 0.2)',
                boxShadow: role.isActive
                  ? '0 0 15px rgba(59, 130, 246, 0.15) inset'
                  : '0 0 15px rgba(156, 163, 175, 0.15) inset',
              }}
            >
              <Shield
                className={`w-5 h-5 ${role.isActive ? 'text-blue-600' : 'text-gray-400'}`}
              />
            </div>
            <div>
              <CardTitle className="text-lg">{role.name}</CardTitle>
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                  role.isActive
                    ? 'bg-green-100 text-green-800'
                    : 'bg-gray-100 text-gray-600'
                }`}
              >
                {role.isActive ? 'Active' : 'Inactive'}
              </span>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2 text-sm">
          {/* Description */}
          <p className="text-gray-600 line-clamp-2">{truncatedDescription}</p>

          {/* Permission Count */}
          <div className="flex items-center gap-2 text-gray-600">
            <Key size={16} />
            <span>
              {role.permissionCount} permission
              {role.permissionCount !== 1 ? 's' : ''}
            </span>
          </div>

          {/* Scope Path (if set) */}
          {role.orgHierarchyScope && (
            <div className="flex items-center gap-2 text-gray-500 text-xs">
              <FolderTree size={14} />
              <span className="font-mono truncate">{role.orgHierarchyScope}</span>
            </div>
          )}

          {/* User Count */}
          {role.userCount > 0 && (
            <div className="text-gray-500 text-xs">
              Assigned to {role.userCount} user{role.userCount !== 1 ? 's' : ''}
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div
          className="mt-4 pt-4 flex gap-2"
          style={{
            borderTop: '1px solid',
            borderImage:
              'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.5) 50%, transparent 100%) 1',
          }}
        >
          {/* Edit Button */}
          <Button
            size="sm"
            variant="outline"
            className="flex-1 transition-all duration-300 hover:shadow-md"
            onClick={handleEditClick}
            disabled={isLoading}
            aria-label={`Edit role ${role.name}`}
            style={{
              background: 'rgba(255, 255, 255, 0.5)',
              backdropFilter: 'blur(10px)',
              WebkitBackdropFilter: 'blur(10px)',
              border: '1px solid rgba(255, 255, 255, 0.3)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(59, 130, 246, 0.1)';
              e.currentTarget.style.borderColor = 'rgba(59, 130, 246, 0.3)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.5)';
              e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.3)';
            }}
          >
            <Edit size={16} className="mr-2" />
            Edit
          </Button>

          {/* Deactivate/Reactivate Button */}
          {role.isActive ? (
            <Button
              size="sm"
              variant="outline"
              className="flex-1 transition-all duration-300 hover:shadow-md"
              onClick={handleDeactivateClick}
              disabled={isLoading}
              aria-label={`Deactivate role ${role.name}`}
              style={{
                background: 'rgba(255, 255, 255, 0.5)',
                backdropFilter: 'blur(10px)',
                WebkitBackdropFilter: 'blur(10px)',
                border: '1px solid rgba(255, 255, 255, 0.3)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)';
                e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.3)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.5)';
                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.3)';
              }}
            >
              <PowerOff size={16} className="mr-2" />
              Deactivate
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="flex-1 transition-all duration-300 hover:shadow-md"
              onClick={handleReactivateClick}
              disabled={isLoading}
              aria-label={`Reactivate role ${role.name}`}
              style={{
                background: 'rgba(255, 255, 255, 0.5)',
                backdropFilter: 'blur(10px)',
                WebkitBackdropFilter: 'blur(10px)',
                border: '1px solid rgba(255, 255, 255, 0.3)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(34, 197, 94, 0.1)';
                e.currentTarget.style.borderColor = 'rgba(34, 197, 94, 0.3)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.5)';
                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.3)';
              }}
            >
              <Power size={16} className="mr-2" />
              Reactivate
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
