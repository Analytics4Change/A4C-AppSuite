/**
 * Workflow Logger Utility
 *
 * Provides consistent logging format across all workflow activities and scripts.
 * Uses console.log as output for Temporal visibility (workflow history and kubectl logs).
 *
 * Usage:
 *   import { getLogger } from '@shared/utils/logger';
 *
 *   const log = getLogger('ActivityName');
 *   log.info('Starting activity', { param1, param2 });
 *   log.error('Activity failed', { error: err.message });
 *
 * Log Levels:
 *   - debug: Detailed debugging information
 *   - info: Normal operation events
 *   - warn: Warning conditions (not errors but noteworthy)
 *   - error: Error conditions that need attention
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LoggerOptions {
  /** Minimum log level to output. Default: 'info' in production, 'debug' otherwise */
  level?: LogLevel;
  /** Include timestamp in output. Default: true */
  includeTimestamp?: boolean;
}

interface Logger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Determine default log level based on environment
 */
function getDefaultLevel(): LogLevel {
  const envLevel = process.env.LOG_LEVEL as LogLevel | undefined;
  if (envLevel && LOG_LEVEL_PRIORITY[envLevel] !== undefined) {
    return envLevel;
  }
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug';
}

/**
 * Format data for output, handling circular references and long values
 */
function formatData(data?: Record<string, unknown>): string {
  if (!data || Object.keys(data).length === 0) {
    return '';
  }

  try {
    // Truncate long string values for readability
    const sanitized = Object.entries(data).reduce(
      (acc, [key, value]) => {
        if (typeof value === 'string' && value.length > 200) {
          acc[key] = value.substring(0, 200) + '...';
        } else if (value instanceof Error) {
          acc[key] = { message: value.message, name: value.name };
        } else {
          acc[key] = value;
        }
        return acc;
      },
      {} as Record<string, unknown>
    );

    return ' ' + JSON.stringify(sanitized);
  } catch {
    return ' [unserializable data]';
  }
}

/**
 * Format timestamp in ISO format for log output
 */
function formatTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Create a logger for a specific category/component
 *
 * @param category - The name of the component (e.g., 'ConfigureDNS', 'CreateOrganization')
 * @param options - Logger options
 * @returns Logger instance with debug, info, warn, error methods
 *
 * @example
 * const log = getLogger('ConfigureDNS');
 * log.info('Starting DNS configuration', { subdomain: 'test' });
 * // Output: 2025-12-18T10:30:00.000Z [ConfigureDNS] INFO Starting DNS configuration {"subdomain":"test"}
 */
export function getLogger(category: string, options: LoggerOptions = {}): Logger {
  const minLevel = options.level ?? getDefaultLevel();
  const includeTimestamp = options.includeTimestamp ?? true;
  const minPriority = LOG_LEVEL_PRIORITY[minLevel];

  const log = (
    level: LogLevel,
    message: string,
    data?: Record<string, unknown>
  ): void => {
    const priority = LOG_LEVEL_PRIORITY[level];
    if (priority < minPriority) {
      return;
    }

    const timestamp = includeTimestamp ? `${formatTimestamp()} ` : '';
    const levelStr = level.toUpperCase().padEnd(5);
    const dataStr = formatData(data);
    const output = `${timestamp}[${category}] ${levelStr} ${message}${dataStr}`;

    // Use appropriate console method for log level
    switch (level) {
      case 'error':
        console.error(output);
        break;
      case 'warn':
        console.warn(output);
        break;
      default:
        console.log(output);
    }
  };

  return {
    debug: (message: string, data?: Record<string, unknown>) =>
      log('debug', message, data),
    info: (message: string, data?: Record<string, unknown>) =>
      log('info', message, data),
    warn: (message: string, data?: Record<string, unknown>) =>
      log('warn', message, data),
    error: (message: string, data?: Record<string, unknown>) =>
      log('error', message, data),
  };
}

/**
 * Pre-configured loggers for common categories
 */
export const workflowLog = getLogger('Workflow');
export const activityLog = getLogger('Activity');
export const apiLog = getLogger('API');
export const workerLog = getLogger('Worker');
