/**
 * Impersonation Banner Component
 * Shows at the top of the screen when impersonating a user
 * Provides high visibility and quick access to end impersonation
 */

import React from 'react';
import { AlertTriangle, X, Clock } from 'lucide-react';
import { ImpersonationSession } from '@/services/auth/impersonation.service';

interface ImpersonationBannerProps {
  session: ImpersonationSession;
  onEndImpersonation: () => void;
}

export const ImpersonationBanner: React.FC<ImpersonationBannerProps> = ({
  session,
  onEndImpersonation
}) => {
  const formatTimeRemaining = (minutes: number): string => {
    if (minutes < 1) return 'Less than 1 minute';
    if (minutes === 1) return '1 minute';
    return `${minutes} minutes`;
  };

  const getBannerColor = (): string => {
    if (session.isWarning) return 'bg-red-600';
    if (session.timeRemaining <= 10) return 'bg-orange-600';
    return 'bg-yellow-600';
  };

  const getTextColor = (): string => {
    return 'text-white';
  };

  return (
    <div className={`${getBannerColor()} ${getTextColor()} px-4 py-3 shadow-lg relative z-50`}>
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <AlertTriangle className="h-5 w-5 flex-shrink-0" />

          <div className="flex items-center space-x-6">
            <div>
              <span className="font-semibold">IMPERSONATING:</span>
              <span className="ml-2">{session.context.impersonatedUserEmail}</span>
            </div>

            <div className="text-sm opacity-90">
              <span>As:</span>
              <span className="ml-1 capitalize">{session.context.impersonatedUserRole.replace('_', ' ')}</span>
            </div>

            {session.context.reason && (
              <div className="text-sm opacity-90">
                <span>Reason:</span>
                <span className="ml-1">{session.context.reason}</span>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2 text-sm">
            <Clock className="h-4 w-4" />
            <span className={session.isWarning ? 'font-bold animate-pulse' : ''}>
              {formatTimeRemaining(session.timeRemaining)} remaining
            </span>
          </div>

          <button
            onClick={onEndImpersonation}
            className="flex items-center space-x-2 bg-white/20 hover:bg-white/30 px-3 py-1.5 rounded-md transition-colors"
            aria-label="End impersonation"
          >
            <X className="h-4 w-4" />
            <span className="text-sm font-medium">End Impersonation</span>
          </button>
        </div>
      </div>
    </div>
  );
};