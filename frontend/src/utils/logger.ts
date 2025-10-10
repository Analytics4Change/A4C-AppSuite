/**
 * Lightweight, configuration-driven logging system
 * 
 * Features:
 * - Zero overhead in production (compile-time removal)
 * - Category-based filtering
 * - Multiple output targets
 * - Structured logging with metadata
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogOutput = 'console' | 'memory' | 'remote' | 'none';

export interface LogConfig {
  enabled: boolean;
  level: LogLevel;
  categories: {
    [key: string]: boolean | LogLevel;
  };
  output: LogOutput;
  includeTimestamp: boolean;
  includeLocation: boolean;
  maxBufferSize?: number;
  remoteEndpoint?: string;
}

export interface LogEntry {
  timestamp: number;
  level: LogLevel;
  category: string;
  message: string;
  args: any[];
  location?: string;
}

// Log level priorities for comparison
const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

// Color codes for console output
const LOG_COLORS: Record<LogLevel, string> = {
  debug: '\x1b[36m', // Cyan
  info: '\x1b[32m',  // Green
  warn: '\x1b[33m',  // Yellow
  error: '\x1b[31m'  // Red
};

const RESET_COLOR = '\x1b[0m';

/**
 * Category-specific logger instance
 */
export class CategoryLogger {
  constructor(
    private category: string,
    private config: LogConfig,
    private shouldLog: (level: LogLevel) => boolean,
    private writeLog: (entry: LogEntry) => void
  ) {}

  debug(message: string, ...args: any[]): void {
    if (this.shouldLog('debug')) {
      this.log('debug', message, args);
    }
  }

  info(message: string, ...args: any[]): void {
    if (this.shouldLog('info')) {
      this.log('info', message, args);
    }
  }

  warn(message: string, ...args: any[]): void {
    if (this.shouldLog('warn')) {
      this.log('warn', message, args);
    }
  }

  error(message: string, ...args: any[]): void {
    if (this.shouldLog('error')) {
      this.log('error', message, args);
    }
  }

  private log(level: LogLevel, message: string, args: any[]): void {
    const entry: LogEntry = {
      timestamp: Date.now(),
      level,
      category: this.category,
      message,
      args
    };

    if (this.config.includeLocation) {
      // Capture stack trace to get caller location
      const stack = new Error().stack;
      if (stack) {
        const lines = stack.split('\n');
        // Skip first 3 lines (Error, this method, and the public method)
        const callerLine = lines[3];
        if (callerLine) {
          const match = callerLine.match(/at\s+(.+)\s+\((.+):(\d+):(\d+)\)/);
          if (match) {
            entry.location = `${match[2]}:${match[3]}:${match[4]}`;
          }
        }
      }
    }

    this.writeLog(entry);
  }
}

/**
 * Main Logger class - singleton pattern
 */
export class Logger {
  private static instance: Logger;
  private config: LogConfig;
  private buffer: LogEntry[] = [];
  private categoryLoggers = new WeakMap<object, CategoryLogger>();
  private categoryKeys = new Map<string, object>();

  private constructor(config: LogConfig) {
    this.config = config;
  }

  /**
   * Initialize the logger with configuration
   * Should be called once at application startup
   */
  static initialize(config: LogConfig): void {
    if (!Logger.instance) {
      Logger.instance = new Logger(config);
    } else {
      Logger.instance.config = config;
    }
  }

  /**
   * Get a category-specific logger
   * Cached for performance
   */
  static getLogger(category: string): CategoryLogger {
    if (!Logger.instance) {
      // Return a no-op logger if not initialized
      return new CategoryLogger(
        category,
        { enabled: false } as LogConfig,
        () => false,
        () => {}
      );
    }

    return Logger.instance.getCategoryLogger(category);
  }

  /**
   * Get all buffered log entries
   */
  static getBuffer(): LogEntry[] {
    return Logger.instance?.buffer || [];
  }

  /**
   * Clear the log buffer
   */
  static clearBuffer(): void {
    if (Logger.instance) {
      Logger.instance.buffer = [];
    }
  }

  /**
   * Update configuration at runtime
   */
  static updateConfig(config: Partial<LogConfig>): void {
    if (Logger.instance) {
      Logger.instance.config = { ...Logger.instance.config, ...config };
    }
  }

  private getCategoryLogger(category: string): CategoryLogger {
    // Use object keys for WeakMap to enable caching
    if (!this.categoryKeys.has(category)) {
      this.categoryKeys.set(category, {});
    }

    const key = this.categoryKeys.get(category)!;
    
    if (!this.categoryLoggers.has(key)) {
      const logger = new CategoryLogger(
        category,
        this.config,
        (level) => this.shouldLog(category, level),
        (entry) => this.writeLog(entry)
      );
      this.categoryLoggers.set(key, logger);
    }

    return this.categoryLoggers.get(key)!;
  }

  private shouldLog(category: string, level: LogLevel): boolean {
    if (!this.config.enabled) {
      return false;
    }

    // Check category-specific configuration
    const categoryConfig = this.config.categories[category];
    
    if (categoryConfig === false) {
      return false;
    }

    if (categoryConfig === true) {
      // Use global level
      return LOG_LEVELS[level] >= LOG_LEVELS[this.config.level];
    }

    if (typeof categoryConfig === 'string') {
      // Use category-specific level
      return LOG_LEVELS[level] >= LOG_LEVELS[categoryConfig];
    }

    // Default to global level if category not configured
    return LOG_LEVELS[level] >= LOG_LEVELS[this.config.level];
  }

  private writeLog(entry: LogEntry): void {
    switch (this.config.output) {
      case 'console':
        this.writeToConsole(entry);
        break;
      case 'memory':
        this.writeToBuffer(entry);
        break;
      case 'remote':
        this.writeToRemote(entry);
        break;
      case 'none':
        // Do nothing
        break;
    }
  }

  private writeToConsole(entry: LogEntry): void {
    const { level, category, message, args, timestamp, location } = entry;
    const color = LOG_COLORS[level];
    
    let prefix = `${color}[${level.toUpperCase()}]${RESET_COLOR}`;
    
    if (this.config.includeTimestamp) {
      const time = new Date(timestamp).toISOString();
      prefix += ` ${time}`;
    }
    
    prefix += ` [${category}]`;
    
    if (location) {
      prefix += ` (${location})`;
    }

    // Use appropriate console method
    const consoleMethod = console[level] || console.log;
    
    if (args.length > 0) {
      consoleMethod(`${prefix} ${message}`, ...args);
    } else {
      consoleMethod(`${prefix} ${message}`);
    }
  }

  private writeToBuffer(entry: LogEntry): void {
    this.buffer.push(entry);
    
    // Trim buffer if it exceeds max size
    if (this.config.maxBufferSize && this.buffer.length > this.config.maxBufferSize) {
      this.buffer = this.buffer.slice(-this.config.maxBufferSize);
    }
  }

  private writeToRemote(entry: LogEntry): void {
    // TODO: Implement remote logging
    // This could batch logs and send them periodically
    // For now, also write to console in development
    if (import.meta.env.DEV) {
      this.writeToConsole(entry);
    }
  }
}

/**
 * Convenience function for quick logging without categories
 */
export const log = {
  debug: (message: string, ...args: any[]) => Logger.getLogger('default').debug(message, ...args),
  info: (message: string, ...args: any[]) => Logger.getLogger('default').info(message, ...args),
  warn: (message: string, ...args: any[]) => Logger.getLogger('default').warn(message, ...args),
  error: (message: string, ...args: any[]) => Logger.getLogger('default').error(message, ...args)
};

/**
 * Development-only logger that compiles to nothing in production
 * Use this for verbose debugging that should never appear in production
 */
export const devLog = import.meta.env.DEV
  ? log
  : {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {}
    };