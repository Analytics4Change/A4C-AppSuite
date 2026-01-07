import * as React from 'react';
import { AlertCircle, Copy, CheckCircle } from 'lucide-react';
import { cn } from './utils';
import { Button } from './button';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('component');

/**
 * Props for ErrorWithCorrelation component.
 *
 * @property message - User-friendly error message to display
 * @property correlationId - Correlation ID for support ticket reference (optional)
 * @property traceId - W3C trace ID for debugging, shown only in non-production (optional)
 * @property className - Additional CSS classes
 * @property onDismiss - Optional callback when error is dismissed
 * @property title - Optional custom title (default: "An error occurred")
 */
export interface ErrorWithCorrelationProps {
  message: string;
  correlationId?: string;
  traceId?: string;
  className?: string;
  onDismiss?: () => void;
  title?: string;
}

/**
 * Error display component with correlation ID for support tickets.
 *
 * Features:
 * - User-friendly error message display
 * - Reference ID (correlation_id) with copy button for support tickets
 * - Trace ID display in non-production environments for debugging
 * - Accessible with ARIA roles and keyboard support
 *
 * @example
 * ```tsx
 * <ErrorWithCorrelation
 *   message="Failed to send invitation"
 *   correlationId="abc-123-def"
 *   traceId="0123456789abcdef0123456789abcdef"
 * />
 * ```
 */
export function ErrorWithCorrelation({
  message,
  correlationId,
  traceId,
  className,
  onDismiss,
  title = 'An error occurred',
}: ErrorWithCorrelationProps) {
  const [copiedCorrelation, setCopiedCorrelation] = React.useState(false);
  const [copiedTrace, setCopiedTrace] = React.useState(false);

  // Determine if we're in production (hide trace ID in production)
  const isProduction = import.meta.env.PROD;

  const handleCopyCorrelation = async () => {
    if (!correlationId) return;

    try {
      await navigator.clipboard.writeText(correlationId);
      setCopiedCorrelation(true);
      log.debug('Copied correlation ID to clipboard', { correlationId });
      setTimeout(() => setCopiedCorrelation(false), 2000);
    } catch (err) {
      log.error('Failed to copy correlation ID', err);
    }
  };

  const handleCopyTrace = async () => {
    if (!traceId) return;

    try {
      await navigator.clipboard.writeText(traceId);
      setCopiedTrace(true);
      log.debug('Copied trace ID to clipboard', { traceId });
      setTimeout(() => setCopiedTrace(false), 2000);
    } catch (err) {
      log.error('Failed to copy trace ID', err);
    }
  };

  // Shorten IDs for display (first 8 chars)
  const shortCorrelationId = correlationId ? correlationId.substring(0, 8) : null;
  const shortTraceId = traceId ? traceId.substring(0, 16) : null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={cn(
        'rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950',
        className
      )}
    >
      {/* Header with icon and title */}
      <div className="flex items-start gap-3">
        <AlertCircle
          className="h-5 w-5 shrink-0 text-red-600 dark:text-red-400"
          aria-hidden="true"
        />
        <div className="flex-1 min-w-0">
          {/* Title */}
          <h4 className="text-sm font-medium text-red-800 dark:text-red-200">
            {title}
          </h4>

          {/* Error message */}
          <p className="mt-1 text-sm text-red-700 dark:text-red-300">{message}</p>

          {/* Reference section */}
          {correlationId && (
            <div className="mt-3 flex items-center gap-2 text-xs text-red-600 dark:text-red-400">
              <span className="font-medium">Reference:</span>
              <code
                className="rounded bg-red-100 px-1.5 py-0.5 font-mono dark:bg-red-900"
                title={correlationId}
              >
                {shortCorrelationId}...
              </code>
              <button
                type="button"
                onClick={handleCopyCorrelation}
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-red-600 hover:bg-red-100 dark:text-red-400 dark:hover:bg-red-900"
                aria-label={copiedCorrelation ? 'Copied!' : 'Copy reference ID'}
              >
                {copiedCorrelation ? (
                  <>
                    <CheckCircle className="h-3 w-3 text-green-600" />
                    <span>Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" />
                    <span>Copy</span>
                  </>
                )}
              </button>
            </div>
          )}

          {/* Trace ID (non-production only) */}
          {!isProduction && traceId && (
            <div className="mt-2 flex items-center gap-2 text-xs text-red-500 dark:text-red-500">
              <span className="font-medium">Trace:</span>
              <code
                className="rounded bg-red-100 px-1.5 py-0.5 font-mono dark:bg-red-900"
                title={traceId}
              >
                {shortTraceId}...
              </code>
              <button
                type="button"
                onClick={handleCopyTrace}
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-red-500 hover:bg-red-100 dark:hover:bg-red-900"
                aria-label={copiedTrace ? 'Copied!' : 'Copy trace ID'}
              >
                {copiedTrace ? (
                  <CheckCircle className="h-3 w-3 text-green-600" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
              </button>
            </div>
          )}
        </div>

        {/* Dismiss button */}
        {onDismiss && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onDismiss}
            className="shrink-0 text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-200"
            aria-label="Dismiss error"
          >
            Dismiss
          </Button>
        )}
      </div>

      {/* Help text for support tickets */}
      {correlationId && (
        <p className="mt-3 border-t border-red-200 pt-3 text-xs text-red-600 dark:border-red-800 dark:text-red-400">
          If this issue persists, please contact support with the reference ID above.
        </p>
      )}
    </div>
  );
}

/**
 * Inline error variant - more compact for inline use in forms.
 */
export function InlineErrorWithCorrelation({
  message,
  correlationId,
  className,
}: Pick<ErrorWithCorrelationProps, 'message' | 'correlationId' | 'className'>) {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = async () => {
    if (!correlationId) return;
    try {
      await navigator.clipboard.writeText(correlationId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      log.error('Failed to copy correlation ID', err);
    }
  };

  const shortId = correlationId ? correlationId.substring(0, 8) : null;

  return (
    <div
      role="alert"
      className={cn(
        'flex items-center gap-2 text-sm text-red-600 dark:text-red-400',
        className
      )}
    >
      <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{message}</span>
      {correlationId && (
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1 rounded px-1 text-xs hover:bg-red-100 dark:hover:bg-red-900"
          title={`Reference: ${correlationId}`}
          aria-label={copied ? 'Copied!' : `Copy reference ${shortId}`}
        >
          <span className="font-mono opacity-60">(Ref: {shortId})</span>
          {copied ? (
            <CheckCircle className="h-3 w-3 text-green-600" />
          ) : (
            <Copy className="h-3 w-3 opacity-60" />
          )}
        </button>
      )}
    </div>
  );
}

export default ErrorWithCorrelation;
