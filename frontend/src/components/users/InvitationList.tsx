import React from 'react';
import { observer } from 'mobx-react-lite';
import {
  Mail,
  Clock,
  RefreshCw,
  XCircle,
  AlertTriangle,
  Shield,
  ChevronRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Invitation } from '@/types/user.types';
import {
  getDisplayName,
  getExpirationText,
  getDaysUntilExpiration,
  computeInvitationDisplayStatus,
} from '@/types/user.types';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('component');

export interface InvitationListProps {
  /** Array of invitations to display */
  invitations: Invitation[];
  /** Called when resend action is triggered */
  onResend?: (invitationId: string) => void;
  /** Called when revoke action is triggered */
  onRevoke?: (invitationId: string) => void;
  /** Called when an invitation is clicked for details */
  onClick?: (invitation: Invitation) => void;
  /** Whether actions are currently loading */
  isLoading?: boolean;
  /** Maximum number of items to show before "show more" */
  maxVisible?: number;
  /** Called when "show more" is clicked */
  onShowMore?: () => void;
  /** Whether to show the header */
  showHeader?: boolean;
  /** Custom title for the header */
  title?: string;
}

/**
 * InvitationList - Compact list of pending/expired invitations
 *
 * A focused component for displaying invitations with quick actions.
 * Useful for sidebar widgets or summary sections on management pages.
 *
 * Features:
 * - Visual distinction for expiring soon (< 2 days)
 * - Quick resend/revoke actions
 * - Compact display with role badges
 * - "Show more" for large lists
 *
 * @example
 * <InvitationList
 *   invitations={viewModel.pendingInvitations}
 *   onResend={(id) => viewModel.resendInvitation(id)}
 *   onRevoke={(id) => viewModel.revokeInvitation(id)}
 *   maxVisible={5}
 *   onShowMore={() => navigate('/users/manage?filter=invitations')}
 * />
 */
export const InvitationList: React.FC<InvitationListProps> = observer(
  ({
    invitations,
    onResend,
    onRevoke,
    onClick,
    isLoading = false,
    maxVisible = 5,
    onShowMore,
    showHeader = true,
    title = 'Pending Invitations',
  }) => {
    log.debug('InvitationList rendering', { count: invitations.length });

    // Separate pending and expired
    const pending = invitations.filter(
      (inv) => computeInvitationDisplayStatus(inv) === 'pending'
    );
    const expired = invitations.filter(
      (inv) => computeInvitationDisplayStatus(inv) === 'expired'
    );

    // Combine with pending first, limited by maxVisible
    const visibleInvitations = [...pending, ...expired].slice(0, maxVisible);
    const hiddenCount =
      pending.length + expired.length - visibleInvitations.length;

    // Count invitations expiring soon (within 2 days)
    const expiringSoon = pending.filter(
      (inv) => getDaysUntilExpiration(inv.expiresAt) <= 2
    ).length;

    if (invitations.length === 0) {
      return null; // Don't render if no invitations
    }

    return (
      <div
        className="rounded-lg border border-gray-200 bg-white/70 backdrop-blur-sm overflow-hidden"
        role="region"
        aria-label={title}
      >
        {/* Header */}
        {showHeader && (
          <div className="px-4 py-3 border-b border-gray-200 bg-gray-50/50">
            <div className="flex items-center justify-between">
              <h3 className="font-medium text-gray-900 flex items-center gap-2">
                <Mail size={16} className="text-gray-500" aria-hidden="true" />
                {title}
                <span className="text-sm font-normal text-gray-500">
                  ({pending.length} pending
                  {expired.length > 0 && `, ${expired.length} expired`})
                </span>
              </h3>
              {expiringSoon > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                  <AlertTriangle size={12} aria-hidden="true" />
                  {expiringSoon} expiring soon
                </span>
              )}
            </div>
          </div>
        )}

        {/* Invitation Items */}
        <ul className="divide-y divide-gray-100" role="list">
          {visibleInvitations.map((invitation) => {
            const status = computeInvitationDisplayStatus(invitation);
            const daysUntil = getDaysUntilExpiration(invitation.expiresAt);
            const isExpiringSoon = status === 'pending' && daysUntil <= 2;
            const isExpired = status === 'expired';
            const displayName = getDisplayName(invitation);

            return (
              <li
                key={invitation.id}
                className={`px-4 py-3 hover:bg-gray-50/50 transition-colors ${
                  onClick ? 'cursor-pointer' : ''
                } ${isExpired ? 'bg-red-50/30' : isExpiringSoon ? 'bg-yellow-50/30' : ''}`}
                onClick={() => onClick?.(invitation)}
                role={onClick ? 'button' : undefined}
                tabIndex={onClick ? 0 : undefined}
                onKeyDown={(e) => {
                  if (onClick && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault();
                    onClick(invitation);
                  }
                }}
                aria-label={`${displayName}, ${isExpired ? 'expired' : getExpirationText(invitation.expiresAt)}`}
              >
                <div className="flex items-start justify-between gap-3">
                  {/* User Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className={`font-medium truncate ${isExpired ? 'text-gray-500' : 'text-gray-900'}`}
                      >
                        {displayName}
                      </span>
                      {isExpired && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">
                          Expired
                        </span>
                      )}
                      {isExpiringSoon && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-700">
                          <AlertTriangle size={10} className="mr-0.5" aria-hidden="true" />
                          Soon
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-gray-500 truncate">
                      {invitation.email}
                    </div>
                    {/* Roles */}
                    {invitation.roles.length > 0 && (
                      <div className="flex items-center gap-1 mt-1">
                        <Shield
                          size={12}
                          className="text-gray-400"
                          aria-hidden="true"
                        />
                        <span className="text-xs text-gray-500">
                          {invitation.roles.map((r) => r.roleName).join(', ')}
                        </span>
                      </div>
                    )}
                    {/* Expiration */}
                    <div
                      className={`flex items-center gap-1 mt-1 text-xs ${
                        isExpired
                          ? 'text-red-600'
                          : isExpiringSoon
                            ? 'text-yellow-600'
                            : 'text-gray-500'
                      }`}
                    >
                      <Clock size={12} aria-hidden="true" />
                      {getExpirationText(invitation.expiresAt)}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0">
                    {(onResend || onRevoke) && !isExpired && (
                      <>
                        {onResend && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={(e) => {
                              e.stopPropagation();
                              onResend(invitation.id);
                            }}
                            disabled={isLoading}
                            className="h-8 w-8 p-0"
                            aria-label={`Resend invitation to ${displayName}`}
                          >
                            <RefreshCw
                              size={14}
                              className="text-blue-600"
                              aria-hidden="true"
                            />
                          </Button>
                        )}
                        {onRevoke && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={(e) => {
                              e.stopPropagation();
                              onRevoke(invitation.id);
                            }}
                            disabled={isLoading}
                            className="h-8 w-8 p-0"
                            aria-label={`Revoke invitation for ${displayName}`}
                          >
                            <XCircle
                              size={14}
                              className="text-red-600"
                              aria-hidden="true"
                            />
                          </Button>
                        )}
                      </>
                    )}
                    {isExpired && onResend && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          onResend(invitation.id);
                        }}
                        disabled={isLoading}
                        className="h-7 text-xs text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                        aria-label={`Send new invitation to ${displayName}`}
                      >
                        <RefreshCw size={12} className="mr-1" aria-hidden="true" />
                        Resend
                      </Button>
                    )}
                    {onClick && (
                      <ChevronRight
                        size={16}
                        className="text-gray-400"
                        aria-hidden="true"
                      />
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        {/* Show More */}
        {hiddenCount > 0 && onShowMore && (
          <div className="px-4 py-2 border-t border-gray-100 bg-gray-50/30">
            <Button
              variant="ghost"
              size="sm"
              onClick={onShowMore}
              className="w-full text-sm text-gray-600 hover:text-gray-900"
            >
              View all {pending.length + expired.length} invitations
              <ChevronRight size={14} className="ml-1" aria-hidden="true" />
            </Button>
          </div>
        )}
      </div>
    );
  }
);

InvitationList.displayName = 'InvitationList';
