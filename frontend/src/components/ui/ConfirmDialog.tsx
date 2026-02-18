/**
 * Confirm Dialog Component
 *
 * Reusable confirmation dialog with variant styles for different action types.
 * Used across entity management pages (Org Units, Roles, Users, Schedules).
 *
 * Variants:
 * - danger: Red styling for destructive actions (delete)
 * - warning: Orange styling for caution actions (deactivate, discard)
 * - success: Green styling for positive actions (reactivate)
 * - default: Blue styling for neutral actions
 *
 * Optional confirm text hardening:
 * - requireConfirmText prop shows a labeled text input
 * - Confirm button stays disabled until user types the required text (case-insensitive)
 * - Input resets when dialog closes; focus auto-directed to input on open
 *
 * Accessibility (WCAG 2.1 Level AA + WAI-ARIA APG Dialog Pattern):
 * - Uses role="alertdialog" for screen reader announcement
 * - aria-modal="true" for modal indication
 * - aria-labelledby/describedby for content association
 * - Focus trap: Tab/Shift+Tab contained within dialog
 * - Escape key: Closes dialog and returns focus
 * - Focus restoration: Returns focus to trigger element on close
 * - Initial focus: Confirm text input (when present) or Cancel button
 * - Backdrop click: Closes dialog (optional dismissal)
 * - Color contrast: Icons meet WCAG AA 3:1 minimum for graphical objects
 */

import React, { useRef, useState, useEffect, RefObject } from 'react';
import { Button } from '@/components/ui/button';
import { AlertTriangle, CheckCircle, X } from 'lucide-react';
import { cn } from '@/components/ui/utils';
import { useKeyboardNavigation } from '@/hooks/useKeyboardNavigation';

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
  /** Optional list of affected entities rendered below the message */
  details?: string[];
  /** When set, user must type this text to enable the confirm button */
  requireConfirmText?: string;
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
  details,
  requireConfirmText,
}) => {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const confirmInputRef = useRef<HTMLInputElement | null>(null);
  const [confirmInput, setConfirmInput] = useState('');

  // Reset confirm input when dialog opens/closes
  useEffect(() => {
    if (!isOpen) setConfirmInput('');
  }, [isOpen]);

  const confirmDisabled =
    isLoading ||
    (!!requireConfirmText && confirmInput.toUpperCase() !== requireConfirmText.toUpperCase());

  // Focus trap and keyboard navigation (WCAG 2.1 AA requirement)
  // Pattern from MedicationSearchModal - proven implementation
  useKeyboardNavigation({
    containerRef: dialogRef as RefObject<HTMLElement>,
    enabled: isOpen,
    trapFocus: true, // Tab/Shift+Tab contained within dialog
    restoreFocus: true, // Return focus to trigger element on close
    onEscape: onCancel, // ESC key closes dialog
    wrapAround: true, // Tab from last element goes to first
    initialFocusRef: (requireConfirmText
      ? confirmInputRef
      : cancelButtonRef) as RefObject<HTMLElement>,
  });

  if (!isOpen) return null;

  const variantStyles = {
    danger: 'bg-red-600 hover:bg-red-700',
    warning: 'bg-orange-600 hover:bg-orange-700',
    success: 'bg-green-600 hover:bg-green-700',
    default: 'bg-blue-600 hover:bg-blue-700',
  };

  // Icon background colors adjusted for WCAG AA 3:1 contrast ratio
  // Using 200-level backgrounds with 700-level icons for sufficient contrast
  const iconBackgroundStyles = {
    danger: 'bg-red-200',
    warning: 'bg-orange-200',
    success: 'bg-green-200',
    default: 'bg-blue-200',
  };

  const iconColorStyles = {
    danger: 'text-red-700',
    warning: 'text-orange-700',
    success: 'text-green-700',
    default: 'text-blue-700',
  };

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      aria-describedby="confirm-dialog-description"
      data-focus-context="modal"
    >
      {/* Backdrop - click to dismiss */}
      <div className="absolute inset-0 bg-black/50" onClick={onCancel} aria-hidden="true" />
      {/* Dialog panel - relative to sit above backdrop */}
      <div className="relative bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
        <div className="flex items-start gap-4">
          {/* Icon with WCAG AA compliant contrast (3:1 minimum for graphical objects) */}
          <div
            className={cn(
              'flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center',
              iconBackgroundStyles[variant]
            )}
          >
            {variant === 'success' ? (
              <CheckCircle className={cn('w-5 h-5', iconColorStyles[variant])} />
            ) : (
              <AlertTriangle className={cn('w-5 h-5', iconColorStyles[variant])} />
            )}
          </div>
          <div className="flex-1">
            <h3 id="confirm-dialog-title" className="text-lg font-semibold text-gray-900">
              {title}
            </h3>
            <p id="confirm-dialog-description" className="mt-2 text-gray-600">
              {message}
            </p>
            {details && details.length > 0 && (
              <ul className="mt-2 max-h-32 overflow-y-auto text-sm text-gray-600 list-disc pl-5 space-y-0.5">
                {details.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            )}
          </div>
          <button
            onClick={onCancel}
            className="flex-shrink-0 text-gray-400 hover:text-gray-600"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        {requireConfirmText && (
          <div className="mt-3">
            <label htmlFor="confirm-text-input" className="block text-sm text-gray-700">
              Type <strong className="font-mono">{requireConfirmText}</strong> to confirm
            </label>
            <input
              ref={confirmInputRef}
              id="confirm-text-input"
              type="text"
              autoComplete="off"
              value={confirmInput}
              onChange={(e) => setConfirmInput(e.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-red-500 focus:ring-1 focus:ring-red-500"
              aria-describedby="confirm-dialog-description"
            />
          </div>
        )}
        <div className="mt-6 flex justify-end gap-3">
          <Button ref={cancelButtonRef} variant="outline" onClick={onCancel} disabled={isLoading}>
            {cancelLabel}
          </Button>
          <Button
            className={cn('text-white', variantStyles[variant])}
            onClick={onConfirm}
            disabled={confirmDisabled}
          >
            {isLoading ? 'Processing...' : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDialog;
