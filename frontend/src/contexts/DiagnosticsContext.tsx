import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('diagnostics');

/**
 * Position options for debug overlays
 */
export type DiagnosticsPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

/**
 * Configuration for diagnostic tools
 */
export interface DiagnosticsConfig {
  // Individual debug components
  enableMobXMonitor: boolean;
  enablePerformanceMonitor: boolean;
  enableLogOverlay: boolean;
  enableNetworkMonitor: boolean;
  
  // Display settings
  position: DiagnosticsPosition;
  opacity: number;
  fontSize: 'small' | 'medium' | 'large';
  
  // Control panel
  showControlPanel: boolean;
  controlPanelMinimized: boolean;
}

/**
 * Context value with config and controls
 */
interface DiagnosticsContextValue {
  config: DiagnosticsConfig;
  updateConfig: (updates: Partial<DiagnosticsConfig>) => void;
  toggleMobXMonitor: () => void;
  togglePerformanceMonitor: () => void;
  toggleLogOverlay: () => void;
  toggleNetworkMonitor: () => void;
  toggleControlPanel: () => void;
  resetToDefaults: () => void;
}

// Default configuration
const defaultConfig: DiagnosticsConfig = {
  enableMobXMonitor: false,
  enablePerformanceMonitor: false,
  enableLogOverlay: false,
  enableNetworkMonitor: false,
  position: 'bottom-right',
  opacity: 0.9,
  fontSize: 'small',
  showControlPanel: true,
  controlPanelMinimized: true
};

// LocalStorage key for persistence
const STORAGE_KEY = 'a4c-diagnostics-config';

// Create context
const DiagnosticsContext = createContext<DiagnosticsContextValue | undefined>(undefined);

/**
 * Provider component for diagnostics configuration
 */
export const DiagnosticsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  // Initialize from localStorage or defaults
  const [config, setConfig] = useState<DiagnosticsConfig>(() => {
    if (!import.meta.env.DEV) {
      // Disable everything in production
      return {
        ...defaultConfig,
        enableMobXMonitor: false,
        enablePerformanceMonitor: false,
        enableLogOverlay: false,
        enableNetworkMonitor: false,
        showControlPanel: false
      };
    }
    
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        log.debug('Loaded diagnostics config from localStorage', parsed);
        return { ...defaultConfig, ...parsed };
      }
    } catch (error) {
      log.warn('Failed to load diagnostics config from localStorage', error);
    }
    
    // Check environment variables for initial state
    const envConfig: Partial<DiagnosticsConfig> = {};
    if (import.meta.env.VITE_DEBUG_MOBX === 'true') {
      envConfig.enableMobXMonitor = true;
    }
    if (import.meta.env.VITE_DEBUG_PERFORMANCE === 'true') {
      envConfig.enablePerformanceMonitor = true;
    }
    if (import.meta.env.VITE_DEBUG_LOGS === 'true') {
      envConfig.enableLogOverlay = true;
    }
    
    return { ...defaultConfig, ...envConfig };
  });
  
  // Save to localStorage when config changes
  useEffect(() => {
    if (import.meta.env.DEV) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
        log.debug('Saved diagnostics config to localStorage');
      } catch (error) {
        log.warn('Failed to save diagnostics config to localStorage', error);
      }
    }
  }, [config]);
  
  // Keyboard shortcuts for quick toggle
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    
    const handleKeyDown = (e: KeyboardEvent) => {
      // Alt+D to toggle control panel (changed from Ctrl+Shift+D which conflicts with Firefox bookmarks)
      if (e.altKey && e.key === 'd') {
        e.preventDefault();
        setConfig(prev => {
          const newState = !prev.showControlPanel;
          log.info(`Debug Control Panel: ${newState ? 'OPENED' : 'CLOSED'}`);
          console.log(`🐛 Debug Control Panel is now ${newState ? 'VISIBLE' : 'HIDDEN'}`);
          return {
            ...prev,
            showControlPanel: newState,
            controlPanelMinimized: false // Always expand when toggling visibility
          };
        });
      }
      
      // Also support Ctrl+Alt+D as alternative
      if (e.ctrlKey && e.altKey && e.key === 'd') {
        e.preventDefault();
        setConfig(prev => {
          const newState = !prev.showControlPanel;
          log.info(`Debug Control Panel: ${newState ? 'OPENED' : 'CLOSED'}`);
          console.log(`🐛 Debug Control Panel is now ${newState ? 'VISIBLE' : 'HIDDEN'}`);
          return {
            ...prev,
            showControlPanel: newState,
            controlPanelMinimized: false // Always expand when toggling visibility
          };
        });
      }
      
      // Ctrl+Shift+M to toggle MobX monitor
      if (e.ctrlKey && e.shiftKey && e.key === 'M') {
        e.preventDefault();
        setConfig(prev => ({
          ...prev,
          enableMobXMonitor: !prev.enableMobXMonitor
        }));
        log.info('Toggled MobX monitor via keyboard shortcut');
      }
      
      // Ctrl+Shift+P to toggle performance monitor
      if (e.ctrlKey && e.shiftKey && e.key === 'P') {
        e.preventDefault();
        setConfig(prev => ({
          ...prev,
          enablePerformanceMonitor: !prev.enablePerformanceMonitor
        }));
        log.info('Toggled performance monitor via keyboard shortcut');
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
  
  // Context value with update functions
  const value: DiagnosticsContextValue = {
    config,
    
    updateConfig: (updates: Partial<DiagnosticsConfig>) => {
      setConfig(prev => ({ ...prev, ...updates }));
      log.debug('Updated diagnostics config', updates);
    },
    
    toggleMobXMonitor: () => {
      setConfig(prev => ({
        ...prev,
        enableMobXMonitor: !prev.enableMobXMonitor
      }));
    },
    
    togglePerformanceMonitor: () => {
      setConfig(prev => ({
        ...prev,
        enablePerformanceMonitor: !prev.enablePerformanceMonitor
      }));
    },
    
    toggleLogOverlay: () => {
      setConfig(prev => ({
        ...prev,
        enableLogOverlay: !prev.enableLogOverlay
      }));
    },
    
    toggleNetworkMonitor: () => {
      setConfig(prev => ({
        ...prev,
        enableNetworkMonitor: !prev.enableNetworkMonitor
      }));
    },
    
    toggleControlPanel: () => {
      setConfig(prev => ({
        ...prev,
        showControlPanel: !prev.showControlPanel
      }));
    },
    
    resetToDefaults: () => {
      setConfig(defaultConfig);
      log.info('Reset diagnostics config to defaults');
    }
  };
  
  return (
    <DiagnosticsContext.Provider value={value}>
      {children}
    </DiagnosticsContext.Provider>
  );
};

/**
 * Hook to use diagnostics configuration
 */
export const useDiagnostics = (): DiagnosticsContextValue => {
  const context = useContext(DiagnosticsContext);
  
  if (!context) {
    throw new Error('useDiagnostics must be used within DiagnosticsProvider');
  }
  
  return context;
};