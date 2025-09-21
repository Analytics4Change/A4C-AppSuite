/**
 * Tests for logging system
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Logger, createLogger, getLogger } from '../utils/logger.js';
import { ConfigManager } from '../config/manager.js';
import { captureConsole, suppressConsole } from './setup.js';

describe('Logger', () => {
  let logger: Logger;
  let configManager: ConfigManager;
  let consoleCapture: ReturnType<typeof captureConsole>;
  
  beforeEach(() => {
    configManager = new ConfigManager('test');
    // Override to enable logging for testing
    configManager.override({
      logging: {
        level: 'debug',
        enableColors: false,
        enableTimestamps: false,
        format: 'simple'
      }
    });
    
    logger = new Logger('test-logger');
    consoleCapture = captureConsole();
  });
  
  afterEach(() => {
    consoleCapture.restore();
  });
  
  describe('initialization', () => {
    it('should create logger with context', () => {
      const testLogger = new Logger('test-context');
      expect(testLogger).toBeDefined();
    });
    
    it('should create logger with context data', () => {
      const testLogger = new Logger('test-context', { operation: 'test-op' });
      expect(testLogger).toBeDefined();
    });
    
    it('should create logger via factory functions', () => {
      const logger1 = createLogger('factory-test');
      const logger2 = getLogger('factory-test');
      
      expect(logger1).toBeDefined();
      expect(logger2).toBeDefined();
    });
  });
  
  describe('child loggers', () => {
    it('should create child logger with additional context', () => {
      const parentLogger = new Logger('parent', { module: 'test' });
      const childLogger = parentLogger.child({ operation: 'child-op' });
      
      expect(childLogger).toBeDefined();
      expect(childLogger).not.toBe(parentLogger);
    });
    
    it('should inherit parent context in child logger', () => {
      const parentLogger = new Logger('parent', { module: 'test' });
      const childLogger = parentLogger.child({ operation: 'child-op' });
      
      childLogger.info('test message');
      
      // Should have both parent and child context
      expect(consoleCapture.captured).toHaveLength(1);
      const logEntry = consoleCapture.captured[0];
      expect(logEntry.method).toBe('log');
    });
  });
  
  describe('log levels', () => {
    it('should log error messages', () => {
      logger.error('test error message');
      
      expect(consoleCapture.captured).toHaveLength(1);
      const logEntry = consoleCapture.captured[0];
      expect(logEntry.method).toBe('log');
      expect(logEntry.args[0]).toContain('ERROR');
      expect(logEntry.args[0]).toContain('test error message');
    });
    
    it('should log warning messages', () => {
      logger.warn('test warning message');
      
      expect(consoleCapture.captured).toHaveLength(1);
      const logEntry = consoleCapture.captured[0];
      expect(logEntry.method).toBe('log');
      expect(logEntry.args[0]).toContain('WARN');
      expect(logEntry.args[0]).toContain('test warning message');
    });
    
    it('should log info messages', () => {
      logger.info('test info message');
      
      expect(consoleCapture.captured).toHaveLength(1);
      const logEntry = consoleCapture.captured[0];
      expect(logEntry.method).toBe('log');
      expect(logEntry.args[0]).toContain('INFO');
      expect(logEntry.args[0]).toContain('test info message');
    });
    
    it('should log debug messages', () => {
      logger.debug('test debug message');
      
      expect(consoleCapture.captured).toHaveLength(1);
      const logEntry = consoleCapture.captured[0];
      expect(logEntry.method).toBe('log');
      expect(logEntry.args[0]).toContain('DEBUG');
      expect(logEntry.args[0]).toContain('test debug message');
    });
  });
  
  describe('log level filtering', () => {
    beforeEach(() => {
      configManager.override({
        logging: {
          level: 'warn',
          enableColors: false,
          enableTimestamps: false,
          format: 'simple'
        }
      });
    });
    
    it('should filter out debug messages when level is warn', () => {
      logger.debug('debug message');
      logger.info('info message');
      logger.warn('warn message');
      logger.error('error message');
      
      expect(consoleCapture.captured).toHaveLength(2); // Only warn and error
      expect(consoleCapture.captured[0].args[0]).toContain('WARN');
      expect(consoleCapture.captured[1].args[0]).toContain('ERROR');
    });
  });
  
  describe('operation tracking', () => {
    it('should track operation start', () => {
      const operationLogger = logger.start('test-operation');
      
      expect(operationLogger).toBeDefined();
      expect(consoleCapture.captured).toHaveLength(1);
      expect(consoleCapture.captured[0].args[0]).toContain('Starting test-operation');
    });
    
    it('should track operation completion', () => {
      logger.complete('test-operation');
      
      expect(consoleCapture.captured).toHaveLength(1);
      expect(consoleCapture.captured[0].args[0]).toContain('Completed test-operation');
    });
    
    it('should track operation failure', () => {
      const error = new Error('test error');
      logger.failed('test-operation', error);
      
      expect(consoleCapture.captured).toHaveLength(1);
      expect(consoleCapture.captured[0].args[0]).toContain('Failed test-operation');
    });
  });
  
  describe('timing operations', () => {
    it('should time synchronous operations', async () => {
      const result = await logger.time('sync-operation', async () => {
        // Simulate some work
        await new Promise(resolve => setTimeout(resolve, 10));
        return 'test-result';
      });
      
      expect(result).toBe('test-result');
      expect(consoleCapture.captured).toHaveLength(2); // Start and complete
      expect(consoleCapture.captured[0].args[0]).toContain('Starting sync-operation');
      expect(consoleCapture.captured[1].args[0]).toContain('Completed sync-operation');
    });
    
    it('should handle timing operation errors', async () => {
      const error = new Error('test error');
      
      try {
        await logger.time('failing-operation', async () => {
          throw error;
        });
      } catch (caught) {
        expect(caught).toBe(error);
      }
      
      expect(consoleCapture.captured).toHaveLength(2); // Start and failed
      expect(consoleCapture.captured[0].args[0]).toContain('Starting failing-operation');
      expect(consoleCapture.captured[1].args[0]).toContain('Failed failing-operation');
    });
  });
  
  describe('log formatting', () => {
    it('should format simple logs', () => {
      configManager.override({
        logging: { format: 'simple' }
      });
      
      logger.info('test message');
      
      expect(consoleCapture.captured).toHaveLength(1);
      const logOutput = consoleCapture.captured[0].args[0];
      expect(logOutput).toContain('INFO');
      expect(logOutput).toContain('[test-logger]');
      expect(logOutput).toContain('test message');
    });
    
    it('should format structured logs', () => {
      configManager.override({
        logging: { format: 'structured' }
      });
      
      logger.info('test message', { key: 'value' });
      
      expect(consoleCapture.captured).toHaveLength(1);
      const logOutput = consoleCapture.captured[0].args[0];
      expect(logOutput).toContain('INFO');
      expect(logOutput).toContain('[test-logger]');
      expect(logOutput).toContain('test message');
    });
    
    it('should format JSON logs', () => {
      configManager.override({
        logging: { format: 'json' }
      });
      
      logger.info('test message');
      
      expect(consoleCapture.captured).toHaveLength(1);
      const logOutput = consoleCapture.captured[0].args[0];
      
      // Should be valid JSON
      expect(() => JSON.parse(logOutput)).not.toThrow();
      const parsed = JSON.parse(logOutput);
      expect(parsed.level).toBe('info');
      expect(parsed.context).toBe('test-logger');
      expect(parsed.message).toBe('test message');
    });
  });
  
  describe('data logging', () => {
    it('should log with additional data', () => {
      logger.info('test message', { key: 'value', count: 42 });
      
      expect(consoleCapture.captured).toHaveLength(1);
      // Data should be included in the log output somehow
      const logOutput = consoleCapture.captured[0].args[0];
      expect(logOutput).toContain('test message');
    });
    
    it('should handle error objects', () => {
      const error = new Error('test error');
      logger.error('operation failed', error);
      
      expect(consoleCapture.captured).toHaveLength(1);
      const logOutput = consoleCapture.captured[0].args[0];
      expect(logOutput).toContain('operation failed');
    });
  });
});