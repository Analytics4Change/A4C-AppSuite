/**
 * Structured logging framework for documentation scripts
 * Replaces console.log with configurable, contextual logging
 */

import { LogLevel, LoggingConfig } from '../config/types.js';
import { configManager } from '../config/manager.js';

interface LogEntry {
  timestamp: Date;
  level: LogLevel;
  context: string;
  message: string;
  data?: unknown;
  error?: Error;
}

interface LogContext {
  operation?: string;
  file?: string;
  function?: string;
  requestId?: string;
  [key: string]: unknown;
}

export class Logger {
  private context: string;
  private contextData: LogContext;
  
  constructor(context: string, contextData: LogContext = {}) {
    this.context = context;
    this.contextData = contextData;
  }
  
  /**
   * Create a child logger with additional context
   */
  child(additionalContext: LogContext): Logger {
    return new Logger(this.context, {
      ...this.contextData,
      ...additionalContext
    });
  }
  
  /**
   * Log an error message
   */
  error(message: string, error?: Error | unknown, data?: unknown): void {
    this.log('error', message, data, error instanceof Error ? error : undefined);
  }
  
  /**
   * Log a warning message
   */
  warn(message: string, data?: unknown): void {
    this.log('warn', message, data);
  }
  
  /**
   * Log an info message
   */
  info(message: string, data?: unknown): void {
    this.log('info', message, data);
  }
  
  /**
   * Log a debug message
   */
  debug(message: string, data?: unknown): void {
    this.log('debug', message, data);
  }
  
  /**
   * Log the start of an operation
   */
  start(operation: string, data?: unknown): Logger {
    const operationLogger = this.child({ operation });
    operationLogger.info(`Starting ${operation}`, data);
    return operationLogger;
  }
  
  /**
   * Log the completion of an operation
   */
  complete(operation: string, data?: unknown): void {
    this.info(`Completed ${operation}`, data);
  }
  
  /**
   * Log the failure of an operation
   */
  failed(operation: string, error: Error | unknown, data?: unknown): void {
    this.error(`Failed ${operation}`, error, data);
  }
  
  /**
   * Time an operation and log the duration
   */
  async time<T>(operation: string, fn: () => Promise<T>): Promise<T> {
    const startTime = Date.now();
    const operationLogger = this.start(operation);
    
    try {
      const result = await fn();
      const duration = Date.now() - startTime;
      operationLogger.complete(operation, { durationMs: duration });
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      operationLogger.failed(operation, error, { durationMs: duration });
      throw error;
    }
  }
  
  /**
   * Core logging method
   */
  private log(level: LogLevel, message: string, data?: unknown, error?: Error): void {
    const config = configManager.get('logging');
    
    if (!this.shouldLog(level, config)) {
      return;
    }
    
    const entry: LogEntry = {
      timestamp: new Date(),
      level,
      context: this.context,
      message,
      data: this.mergeData(data),
      error
    };
    
    this.output(entry, config);
  }
  
  /**
   * Check if message should be logged based on level
   */
  private shouldLog(level: LogLevel, config: LoggingConfig): boolean {
    const levels: Record<LogLevel, number> = {
      error: 0,
      warn: 1,
      info: 2,
      debug: 3
    };
    
    return levels[level] <= levels[config.level];
  }
  
  /**
   * Merge contextual data with log data
   */
  private mergeData(data?: unknown): unknown {
    if (!data && Object.keys(this.contextData).length === 0) {
      return undefined;
    }
    
    const result: Record<string, unknown> = { ...this.contextData };
    
    if (data) {
      if (typeof data === 'object' && data !== null) {
        Object.assign(result, data);
      } else {
        result.data = data;
      }
    }
    
    return Object.keys(result).length > 0 ? result : undefined;
  }
  
  /**
   * Output the log entry based on configuration
   */
  private output(entry: LogEntry, config: LoggingConfig): void {
    switch (config.format) {
      case 'json':
        console.log(JSON.stringify(entry));
        break;
        
      case 'simple':
        console.log(this.formatSimple(entry, config));
        break;
        
      case 'structured':
      default:
        console.log(this.formatStructured(entry, config));
        break;
    }
  }
  
  /**
   * Format log entry as simple text
   */
  private formatSimple(entry: LogEntry, config: LoggingConfig): string {
    const level = config.enableColors ? this.colorizeLevel(entry.level) : entry.level.toUpperCase();
    const timestamp = config.enableTimestamps ? `${entry.timestamp.toISOString()} ` : '';
    
    let message = `${timestamp}${level} [${entry.context}] ${entry.message}`;
    
    if (entry.error) {
      message += `\\n${entry.error.stack || entry.error.message}`;
    }
    
    return message;
  }
  
  /**
   * Format log entry as structured text
   */
  private formatStructured(entry: LogEntry, config: LoggingConfig): string {
    const level = config.enableColors ? this.colorizeLevel(entry.level) : entry.level.toUpperCase();
    const timestamp = config.enableTimestamps ? entry.timestamp.toISOString() : '';
    
    const parts: string[] = [];
    
    if (timestamp) parts.push(`[${timestamp}]`);
    parts.push(`${level}`);
    parts.push(`[${entry.context}]`);
    parts.push(entry.message);
    
    let message = parts.join(' ');
    
    if (entry.data) {
      message += `\\n  Data: ${JSON.stringify(entry.data, null, 2)}`;
    }
    
    if (entry.error) {
      message += `\\n  Error: ${entry.error.stack || entry.error.message}`;
    }
    
    return message;
  }
  
  /**
   * Add ANSI color codes to log level
   */
  private colorizeLevel(level: LogLevel): string {
    const colors = {
      error: '\\x1b[31m', // Red
      warn: '\\x1b[33m',  // Yellow
      info: '\\x1b[36m',  // Cyan
      debug: '\\x1b[90m'  // Gray
    };
    
    const reset = '\\x1b[0m';
    return `${colors[level]}${level.toUpperCase()}${reset}`;
  }
}

/**
 * Create a logger instance for a specific context
 */
export function createLogger(context: string, contextData?: LogContext): Logger {
  return new Logger(context, contextData);
}

/**
 * Get a logger for a specific module or operation
 */
export function getLogger(context: string): Logger {
  return new Logger(context);
}