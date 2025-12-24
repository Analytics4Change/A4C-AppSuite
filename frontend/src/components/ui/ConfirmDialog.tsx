/**
 * Confirm Dialog Component
 *
 * Reusable confirmation dialog with variant styles for different action types.
 * Used across Organization Unit management pages.
 *
 * Variants:
 * - danger: Red styling for destructive actions (delete)
 * - warning: Orange styling for caution actions (deactivate, discard)
 * - success: Green styling for positive actions (reactivate)
 * - default: Blue styling for neutral actions
 *
 * Accessibility:
 * - Uses role="alertdialog" for screen reader announcement
 * - aria-modal="true" for focus trap indication
 * - aria-labelledby/describedby for content association
 */

import React from 'react';
import { Button } from '@/components/ui/button';
import { AlertTriangle, CheckCircle, X } from 'lucide-react';
import { cn } from '@/components/ui/utils';

export interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  isLoading?: boolean;
  variant?: 'danger' | 'warning' | 'success' | 'default';
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  title,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  isLoading = false,
  variant = 'default',
}) => {
  if (!isOpen) return null;

  const variantStyles = {
    danger: 'bg-red-600 hover:bg-red-700',
    warning: 'bg-orange-600 hover:bg-orange-700',
    success: 'bg-green-600 hover:bg-green-700',
    default: 'bg-blue-600 hover:bg-blue-700',
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      aria-describedby="confirm-dialog-description"
    >
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
        <div className="flex items-start gap-4">
          <div
            className={cn(
              'flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center',
              variant === 'danger' && 'bg-red-100',
              variant === 'warning' && 'bg-orange-100',
              variant === 'success' && 'bg-green-100',
              variant === 'default' && 'bg-blue-100'
            )}
          >
            {variant === 'success' ? (
              <CheckCircle className="w-5 h-5 text-green-600" />
            ) : (
              <AlertTriangle
                className={cn(
                  'w-5 h-5',
                  variant === 'danger' && 'text-red-600',
                  variant === 'warning' && 'text-orange-600',
                  variant === 'default' && 'text-blue-600'
                )}
              />
            )}
          </div>
          <div className="flex-1">
            <h3
              id="confirm-dialog-title"
              className="text-lg font-semibold text-gray-900"
            >
              {title}
            </h3>
            <p id="confirm-dialog-description" className="mt-2 text-gray-600">
              {message}
            </p>
          </div>
          <button
            onClick={onCancel}
            className="flex-shrink-0 text-gray-400 hover:text-gray-600"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="outline" onClick={onCancel} disabled={isLoading}>
            {cancelLabel}
          </Button>
          <Button
            className={cn('text-white', variantStyles[variant])}
            onClick={onConfirm}
            disabled={isLoading}
          >
            {isLoading ? 'Processing...' : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDialog;
