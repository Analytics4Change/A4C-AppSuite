import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Logger, type LogConfig } from './logger';

describe('Logger', () => {
  // Mock console methods
  const mockConsole = {
    log: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  };

  beforeEach(() => {
    // Clear all mocks
    vi.clearAllMocks();
    
    // Replace console methods with mocks
    vi.spyOn(console, 'log').mockImplementation(mockConsole.log);
    vi.spyOn(console, 'debug').mockImplementation(mockConsole.debug);
    vi.spyOn(console, 'info').mockImplementation(mockConsole.info);
    vi.spyOn(console, 'warn').mockImplementation(mockConsole.warn);
    vi.spyOn(console, 'error').mockImplementation(mockConsole.error);
    
    // Clear buffer
    Logger.clearBuffer();
  });

  describe('Configuration', () => {
    it('should initialize with configuration', () => {
      const config: LogConfig = {
        enabled: true,
        level: 'info',
        categories: {},
        output: 'console',
        includeTimestamp: false,
        includeLocation: false
      };

      Logger.initialize(config);
      const log = Logger.getLogger('test');
      
      log.info('Test message');
      expect(mockConsole.info).toHaveBeenCalled();
    });

    it('should not log when disabled', () => {
      const config: LogConfig = {
        enabled: false,
        level: 'debug',
        categories: {},
        output: 'console',
        includeTimestamp: false,
        includeLocation: false
      };

      Logger.initialize(config);
      const log = Logger.getLogger('test');
      
      log.debug('Test message');
      log.info('Test message');
      log.warn('Test message');
      log.error('Test message');
      
      expect(mockConsole.debug).not.toHaveBeenCalled();
      expect(mockConsole.info).not.toHaveBeenCalled();
      expect(mockConsole.warn).not.toHaveBeenCalled();
      expect(mockConsole.error).not.toHaveBeenCalled();
    });
  });

  describe('Log Levels', () => {
    beforeEach(() => {
      const config: LogConfig = {
        enabled: true,
        level: 'warn',
        categories: {},
        output: 'console',
        includeTimestamp: false,
        includeLocation: false
      };
      Logger.initialize(config);
    });

    it('should respect global log level', () => {
      const log = Logger.getLogger('test');
      
      log.debug('Debug message');
      log.info('Info message');
      log.warn('Warn message');
      log.error('Error message');
      
      expect(mockConsole.debug).not.toHaveBeenCalled();
      expect(mockConsole.info).not.toHaveBeenCalled();
      expect(mockConsole.warn).toHaveBeenCalled();
      expect(mockConsole.error).toHaveBeenCalled();
    });
  });

  describe('Category Filtering', () => {
    beforeEach(() => {
      const config: LogConfig = {
        enabled: true,
        level: 'info',
        categories: {
          'enabled-category': 'debug',
          'disabled-category': false,
          'error-only': 'error'
        },
        output: 'console',
        includeTimestamp: false,
        includeLocation: false
      };
      Logger.initialize(config);
    });

    it('should respect category-specific levels', () => {
      const enabledLog = Logger.getLogger('enabled-category');
      enabledLog.debug('Debug message');
      expect(mockConsole.debug).toHaveBeenCalled();
      
      const errorOnlyLog = Logger.getLogger('error-only');
      errorOnlyLog.info('Info message');
      errorOnlyLog.error('Error message');
      expect(mockConsole.info).not.toHaveBeenCalled();
      expect(mockConsole.error).toHaveBeenCalled();
    });

    it('should disable logging for disabled categories', () => {
      const disabledLog = Logger.getLogger('disabled-category');
      disabledLog.error('Error message');
      expect(mockConsole.error).not.toHaveBeenCalled();
    });

    it('should use global level for unconfigured categories', () => {
      const unconfiguredLog = Logger.getLogger('unconfigured');
      unconfiguredLog.debug('Debug message');
      unconfiguredLog.info('Info message');
      
      expect(mockConsole.debug).not.toHaveBeenCalled();
      expect(mockConsole.info).toHaveBeenCalled();
    });
  });

  describe('Output Targets', () => {
    it('should write to console when output is console', () => {
      const config: LogConfig = {
        enabled: true,
        level: 'info',
        categories: {},
        output: 'console',
        includeTimestamp: false,
        includeLocation: false
      };
      Logger.initialize(config);
      
      const log = Logger.getLogger('test');
      log.info('Test message', 'arg1', 'arg2');
      
      expect(mockConsole.info).toHaveBeenCalled();
      const call = mockConsole.info.mock.calls[0];
      expect(call[0]).toContain('[INFO]');
      expect(call[0]).toContain('[test]');
      expect(call[0]).toContain('Test message');
      expect(call[1]).toBe('arg1');
      expect(call[2]).toBe('arg2');
    });

    it('should write to buffer when output is memory', () => {
      const config: LogConfig = {
        enabled: true,
        level: 'info',
        categories: {},
        output: 'memory',
        includeTimestamp: true,
        includeLocation: false,
        maxBufferSize: 10
      };
      Logger.initialize(config);
      
      const log = Logger.getLogger('test');
      log.info('Test message 1');
      log.warn('Test message 2');
      
      const buffer = Logger.getBuffer();
      expect(buffer).toHaveLength(2);
      expect(buffer[0].message).toBe('Test message 1');
      expect(buffer[0].level).toBe('info');
      expect(buffer[1].message).toBe('Test message 2');
      expect(buffer[1].level).toBe('warn');
      
      expect(mockConsole.info).not.toHaveBeenCalled();
      expect(mockConsole.warn).not.toHaveBeenCalled();
    });

    it('should respect maxBufferSize', () => {
      const config: LogConfig = {
        enabled: true,
        level: 'debug',
        categories: {},
        output: 'memory',
        includeTimestamp: false,
        includeLocation: false,
        maxBufferSize: 3
      };
      Logger.initialize(config);
      
      const log = Logger.getLogger('test');
      for (let i = 1; i <= 5; i++) {
        log.info(`Message ${i}`);
      }
      
      const buffer = Logger.getBuffer();
      expect(buffer).toHaveLength(3);
      expect(buffer[0].message).toBe('Message 3');
      expect(buffer[1].message).toBe('Message 4');
      expect(buffer[2].message).toBe('Message 5');
    });

    it('should not output anything when output is none', () => {
      const config: LogConfig = {
        enabled: true,
        level: 'debug',
        categories: {},
        output: 'none',
        includeTimestamp: false,
        includeLocation: false
      };
      Logger.initialize(config);
      
      const log = Logger.getLogger('test');
      log.error('Test message');
      
      expect(mockConsole.error).not.toHaveBeenCalled();
      expect(Logger.getBuffer()).toHaveLength(0);
    });
  });

  describe('Metadata', () => {
    it('should include timestamp when configured', () => {
      const config: LogConfig = {
        enabled: true,
        level: 'info',
        categories: {},
        output: 'console',
        includeTimestamp: true,
        includeLocation: false
      };
      Logger.initialize(config);
      
      const log = Logger.getLogger('test');
      log.info('Test message');
      
      expect(mockConsole.info).toHaveBeenCalled();
      const call = mockConsole.info.mock.calls[0][0];
      // Check that ISO timestamp is included
      expect(call).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });

  describe('Category Logger Caching', () => {
    it('should return the same logger instance for the same category', () => {
      const config: LogConfig = {
        enabled: true,
        level: 'info',
        categories: {},
        output: 'console',
        includeTimestamp: false,
        includeLocation: false
      };
      Logger.initialize(config);
      
      const log1 = Logger.getLogger('test');
      const log2 = Logger.getLogger('test');
      
      // They should be the same instance (cached)
      expect(log1).toBe(log2);
    });
  });

  describe('Runtime Configuration Updates', () => {
    it('should allow updating configuration at runtime', () => {
      const config: LogConfig = {
        enabled: true,
        level: 'error',
        categories: {},
        output: 'console',
        includeTimestamp: false,
        includeLocation: false
      };
      Logger.initialize(config);
      
      const log = Logger.getLogger('test');
      log.info('Should not appear');
      expect(mockConsole.info).not.toHaveBeenCalled();
      
      // Update config to allow info level
      Logger.updateConfig({ level: 'info' });
      
      // Need to get a new logger as config changed
      const newLog = Logger.getLogger('test-new');
      newLog.info('Should appear');
      expect(mockConsole.info).toHaveBeenCalled();
    });
  });
});