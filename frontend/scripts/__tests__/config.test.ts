/**
 * Tests for configuration management system
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ConfigManager } from '../config/manager.js';

describe('ConfigManager', () => {
  let configManager: ConfigManager;
  
  beforeEach(() => {
    configManager = new ConfigManager('test');
  });
  
  describe('initialization', () => {
    it('should initialize with default configuration', () => {
      const config = configManager.getConfig();
      expect(config).toBeDefined();
      expect(config.logging).toBeDefined();
      expect(config.performance).toBeDefined();
      expect(config.security).toBeDefined();
    });
    
    it('should apply test environment overrides', () => {
      const config = configManager.getConfig();
      expect(config.logging.level).toBe('error');
      expect(config.logging.enableColors).toBe(false);
      expect(config.progress.style).toBe('none');
    });
    
    it('should detect test environment correctly', () => {
      expect(configManager.isTest()).toBe(true);
      expect(configManager.isDevelopment()).toBe(false);
      expect(configManager.isProduction()).toBe(false);
    });
  });
  
  describe('configuration access', () => {
    it('should get complete configuration', () => {
      const config = configManager.getConfig();
      expect(config).toHaveProperty('logging');
      expect(config).toHaveProperty('performance');
      expect(config).toHaveProperty('security');
      expect(config).toHaveProperty('progress');
      expect(config).toHaveProperty('cache');
      expect(config).toHaveProperty('validation');
      expect(config).toHaveProperty('documentation');
    });
    
    it('should get specific configuration sections', () => {
      const loggingConfig = configManager.get('logging');
      expect(loggingConfig).toBeDefined();
      expect(loggingConfig).toHaveProperty('level');
      expect(loggingConfig).toHaveProperty('enableColors');
      expect(loggingConfig).toHaveProperty('format');
    });
  });
  
  describe('configuration overrides', () => {
    it('should override specific configuration values', () => {
      const originalLevel = configManager.get('logging').level;
      
      configManager.override({
        logging: {
          level: 'debug'
        }
      });
      
      const newLevel = configManager.get('logging').level;
      expect(newLevel).toBe('debug');
      expect(newLevel).not.toBe(originalLevel);
    });
    
    it('should merge nested configuration objects', () => {
      const originalConfig = configManager.get('performance');
      
      configManager.override({
        performance: {
          concurrency: 8
        }
      });
      
      const newConfig = configManager.get('performance');
      expect(newConfig.concurrency).toBe(8);
      expect(newConfig.timeoutMs).toBe(originalConfig.timeoutMs); // Should preserve other values
    });
  });
  
  describe('validation', () => {
    it('should validate correct configuration', () => {
      const errors = configManager.validate();
      expect(errors).toEqual([]);
    });
    
    it('should detect invalid log level', () => {
      configManager.override({
        logging: {
          level: 'invalid' as any
        }
      });
      
      const errors = configManager.validate();
      expect(errors).toContain('Invalid log level: invalid');
    });
    
    it('should detect invalid concurrency', () => {
      configManager.override({
        performance: {
          concurrency: 0
        }
      });
      
      const errors = configManager.validate();
      expect(errors).toContain('Concurrency must be at least 1');
    });
    
    it('should detect invalid timeout', () => {
      configManager.override({
        performance: {
          timeoutMs: 500
        }
      });
      
      const errors = configManager.validate();
      expect(errors).toContain('Timeout must be at least 1000ms');
    });
  });
  
  describe('environment detection', () => {
    it('should detect different environments', () => {
      const devManager = new ConfigManager('development');
      expect(devManager.isDevelopment()).toBe(true);
      expect(devManager.isTest()).toBe(false);
      
      const prodManager = new ConfigManager('production');
      expect(prodManager.isProduction()).toBe(true);
      expect(prodManager.isDevelopment()).toBe(false);
    });
  });
  
  describe('JSON serialization', () => {
    it('should serialize configuration to JSON', () => {
      const json = configManager.toJSON();
      expect(json).toBeDefined();
      expect(() => JSON.parse(json)).not.toThrow();
      
      const parsed = JSON.parse(json);
      expect(parsed).toHaveProperty('logging');
      expect(parsed).toHaveProperty('performance');
    });
  });
});