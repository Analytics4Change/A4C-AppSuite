import React from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Mail,
  Clock,
  Power,
  PowerOff,
  RefreshCw,
  XCircle,
  Shield,
  AlertTriangle,
} from 'lucide-react';
import type { UserListItem, UserDisplayStatus } from '@/types/user.types';
import { getDisplayName, getExpirationText } from '@/types/user.types';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('component');

export interface UserCardProps {
  /** The user or invitation to display */
  user: UserListItem;
  /** Whether this card is currently selected */
  isSelected?: boolean;
  /** Called when the card is clicked */
  onClick?: (user: UserListItem) => void;
  /** Called when deactivate action is triggered */
  onDeactivate?: (userId: string) => void;
  /** Called when reactivate action is triggered */
  onReactivate?: (userId: string) => void;
  /** Called when resend invitation action is triggered */
  onResendInvitation?: (invitationId: string) => void;
  /** Called when revoke invitation action is triggered */
  onRevokeInvitation?: (invitationId: string) => void;
  /** Whether actions are currently loading */
  isLoading?: boolean;
}

/**
 * Status badge configuration for each display status
 */
const STATUS_BADGE_CONFIG: Record<
  UserDisplayStatus,
  { label: string; bgClass: string; textClass: string }
> = {
  pending: {
    label: 'Pending',
    bgClass: 'bg-yellow-100',
    textClass: 'text-yellow-800',
  },
  expired: {
    label: 'Expired',
    bgClass: 'bg-red-100',
    textClass: 'text-red-800',
  },
  active: {
    label: 'Active',
    bgClass: 'bg-green-100',
    textClass: 'text-green-800',
  },
  deactivated: {
    label: 'Deactivated',
    bgClass: 'bg-gray-100',
    textClass: 'text-gray-600',
  },
};

/**
 * Get initials from name or email
 */
function getInitials(user: UserListItem): string {
  if (user.firstName && user.lastName) {
    return `${user.firstName[0]}${user.lastName[0]}`.toUpperCase();
  }
  if (user.firstName) {
    return user.firstName.substring(0, 2).toUpperCase();
  }
  if (user.lastName) {
    return user.lastName.substring(0, 2).toUpperCase();
  }
  // Use email
  const parts = user.email.split('@')[0];
  return parts.substring(0, 2).toUpperCase();
}

/**
 * Get avatar background color based on user ID (consistent color per user)
 */
function getAvatarColor(userId: string): string {
  const colors = [
    'from-blue-400 to-blue-600',
    'from-green-400 to-green-600',
    'from-purple-400 to-purple-600',
    'from-pink-400 to-pink-600',
    'from-indigo-400 to-indigo-600',
    'from-teal-400 to-teal-600',
    'from-orange-400 to-orange-600',
    'from-cyan-400 to-cyan-600',
  ];

  // Simple hash from user ID
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = ((hash << 5) - hash + userId.charCodeAt(i)) | 0;
  }

  return colors[Math.abs(hash) % colors.length];
}

/**
 * UserCard - Displays a user or invitation as a glass-morphism styled card
 *
 * Shows avatar, name, email, role badges, status, and quick actions.
 * Handles both active users and pending/expired invitations.
 *
 * @example
 * <UserCard
 *   user={userListItem}
 *   isSelected={selectedId === userListItem.id}
 *   onClick={(user) => selectUser(user)}
 *   onDeactivate={(id) => viewModel.deactivateUser(id)}
 *   onReactivate={(id) => viewModel.reactivateUser(id)}
 * />
 */
export const UserCard: React.FC<UserCardProps> = ({
  user,
  isSelected = false,
  onClick,
  onDeactivate,
  onReactivate,
  onResendInvitation,
  onRevokeInvitation,
  isLoading = false,
}) => {
  log.debug('UserCard rendering', {
    userId: user.id,
    status: user.displayStatus,
    isInvitation: user.isInvitation,
  });

  const handleCardClick = () => {
    onClick?.(user);
  };

  const handleDeactivateClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDeactivate?.(user.id);
  };

  const handleReactivateClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onReactivate?.(user.id);
  };

  const handleResendClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (user.invitationId) {
      onResendInvitation?.(user.invitationId);
    }
  };

  const handleRevokeClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (user.invitationId) {
      onRevokeInvitation?.(user.invitationId);
    }
  };

  const statusConfig = STATUS_BADGE_CONFIG[user.displayStatus];
  const initials = getInitials(user);
  const avatarColor = getAvatarColor(user.id);
  const displayName = getDisplayName(user);

  // Determine if status is "inactive" (deactivated or expired)
  const isInactive =
    user.displayStatus === 'deactivated' || user.displayStatus === 'expired';

  return (
    <Card
      data-testid="user-card"
      className={`glass-card hover:glass-card-hover transition-all duration-300 cursor-pointer group ${
        isSelected ? 'ring-2 ring-blue-500 ring-offset-2' : ''
      }`}
      onClick={handleCardClick}
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
      aria-label={`${displayName}, ${statusConfig.label}${user.isInvitation ? ' invitation' : ' user'}`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleCardClick();
        }
      }}
      style={{
        background: isSelected
          ? 'rgba(59, 130, 246, 0.08)'
          : 'rgba(255, 255, 255, 0.7)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: '1px solid',
        borderImage: isSelected
          ? 'linear-gradient(135deg, rgba(59,130,246,0.4) 0%, rgba(59,130,246,0.2) 50%, rgba(59,130,246,0.4) 100%) 1'
          : 'linear-gradient(135deg, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0.2) 50%, rgba(255,255,255,0.5) 100%) 1',
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
        e.currentTarget.style.transform = 'translateY(-2px)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = `
          0 0 0 1px rgba(255, 255, 255, 0.18) inset,
          0 2px 4px rgba(0, 0, 0, 0.04),
          0 4px 8px rgba(0, 0, 0, 0.04),
          0 8px 16px rgba(0, 0, 0, 0.04)
        `.trim();
        e.currentTarget.style.transform = 'translateY(0)';
      }}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start gap-3">
          {/* Avatar */}
          <div
            className={`w-12 h-12 rounded-full flex items-center justify-center text-white font-semibold text-lg
              bg-gradient-to-br ${avatarColor} ${isInactive ? 'opacity-50' : ''}`}
            aria-hidden="true"
          >
            {initials}
          </div>

          <div className="flex-1 min-w-0">
            {/* Name and Status */}
            <div className="flex items-center gap-2 flex-wrap">
              <h3
                className={`font-semibold text-lg truncate ${isInactive ? 'text-gray-500' : 'text-gray-900'}`}
              >
                {displayName}
              </h3>
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusConfig.bgClass} ${statusConfig.textClass}`}
              >
                {statusConfig.label}
              </span>
            </div>

            {/* Email */}
            <div
              className={`flex items-center gap-1.5 mt-1 ${isInactive ? 'text-gray-400' : 'text-gray-600'}`}
            >
              <Mail size={14} aria-hidden="true" />
              <span className="text-sm truncate">{user.email}</span>
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        {/* Role Badges or No Roles Warning */}
        {user.roles.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {user.roles.slice(0, 3).map((role) => (
              <span
                key={role.roleId}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium
                  ${isInactive ? 'bg-gray-100 text-gray-500' : 'bg-blue-50 text-blue-700'}`}
              >
                <Shield size={10} aria-hidden="true" />
                {role.roleName}
              </span>
            ))}
            {user.roles.length > 3 && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                +{user.roles.length - 3} more
              </span>
            )}
          </div>
        ) : (
          <div
            className={`flex items-center gap-1.5 mb-3 px-2 py-1.5 rounded-lg ${
              isInactive
                ? 'bg-gray-50 border border-gray-200'
                : 'bg-amber-50 border border-amber-200'
            }`}
          >
            <AlertTriangle
              size={14}
              className={isInactive ? 'text-gray-400' : 'text-amber-600'}
              aria-hidden="true"
            />
            <span
              className={`text-xs font-medium ${
                isInactive ? 'text-gray-500' : 'text-amber-700'
              }`}
            >
              No roles assigned
            </span>
          </div>
        )}

        {/* Invitation Expiration */}
        {user.isInvitation && user.expiresAt && (
          <div
            className={`flex items-center gap-1.5 text-xs mb-3 ${
              user.displayStatus === 'expired'
                ? 'text-red-600'
                : user.displayStatus === 'pending'
                  ? 'text-yellow-600'
                  : 'text-gray-500'
            }`}
          >
            <Clock size={12} aria-hidden="true" />
            <span>{getExpirationText(user.expiresAt)}</span>
          </div>
        )}

        {/* Action Buttons */}
        <div
          className="pt-3 flex gap-2"
          style={{
            borderTop: '1px solid',
            borderImage:
              'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.5) 50%, transparent 100%) 1',
          }}
        >
          {/* Invitation Actions */}
          {user.isInvitation && user.displayStatus === 'pending' && (
            <>
              <Button
                size="sm"
                variant="outline"
                className="flex-1 transition-all duration-300 hover:shadow-md"
                onClick={handleResendClick}
                disabled={isLoading}
                aria-label={`Resend invitation to ${displayName}`}
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
                <RefreshCw size={14} className="mr-1.5" aria-hidden="true" />
                Resend
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="flex-1 transition-all duration-300 hover:shadow-md"
                onClick={handleRevokeClick}
                disabled={isLoading}
                aria-label={`Revoke invitation for ${displayName}`}
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
                <XCircle size={14} className="mr-1.5" aria-hidden="true" />
                Revoke
              </Button>
            </>
          )}

          {/* Expired Invitation Actions */}
          {user.isInvitation && user.displayStatus === 'expired' && (
            <Button
              size="sm"
              variant="outline"
              className="flex-1 transition-all duration-300 hover:shadow-md"
              onClick={handleResendClick}
              disabled={isLoading}
              aria-label={`Send new invitation to ${displayName}`}
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
              <RefreshCw size={14} className="mr-1.5" aria-hidden="true" />
              Send New Invitation
            </Button>
          )}

          {/* Active User Actions */}
          {!user.isInvitation && user.displayStatus === 'active' && (
            <Button
              size="sm"
              variant="outline"
              className="flex-1 transition-all duration-300 hover:shadow-md"
              onClick={handleDeactivateClick}
              disabled={isLoading}
              aria-label={`Deactivate ${displayName}`}
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
              <PowerOff size={14} className="mr-1.5" aria-hidden="true" />
              Deactivate
            </Button>
          )}

          {/* Deactivated User Actions */}
          {!user.isInvitation && user.displayStatus === 'deactivated' && (
            <Button
              size="sm"
              variant="outline"
              className="flex-1 transition-all duration-300 hover:shadow-md"
              onClick={handleReactivateClick}
              disabled={isLoading}
              aria-label={`Reactivate ${displayName}`}
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
              <Power size={14} className="mr-1.5" aria-hidden="true" />
              Reactivate
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
