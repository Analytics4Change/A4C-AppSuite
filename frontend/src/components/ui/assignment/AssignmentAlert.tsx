/**
 * AssignmentAlert Component
 *
 * Domain-agnostic alert component for assignment management dialogs.
 * Displays success, warning, or error messages with an icon and title.
 *
 * Accessibility:
 * - Uses role="alert" for assistive technology announcements
 * - Semantic heading (h4) for alert title
 *
 * @see SyncResultDisplay for usage in assignment result views
 */

import React from 'react';
import { cn } from '@/components/ui/utils';

interface AssignmentAlertProps {
  variant?: 'success' | 'warning' | 'error';
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}

export const AssignmentAlert: React.FC<AssignmentAlertProps> = ({
  variant = 'success',
  icon,
  title,
  children,
}) => {
  const variantStyles = {
    success: 'border-green-200 bg-green-50 text-green-800',
    warning: 'border-yellow-200 bg-yellow-50 text-yellow-800',
    error: 'border-red-200 bg-red-50 text-red-800',
  };

  return (
    <div className={cn('rounded-lg border p-4', variantStyles[variant])} role="alert">
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0">{icon}</div>
        <div>
          <h4 className="font-medium">{title}</h4>
          <div className="mt-1 text-sm opacity-90">{children}</div>
        </div>
      </div>
    </div>
  );
};

AssignmentAlert.displayName = 'AssignmentAlert';
