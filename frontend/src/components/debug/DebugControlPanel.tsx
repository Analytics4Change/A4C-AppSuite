import React from 'react';
import { useDiagnostics } from '@/contexts/DiagnosticsContext';
import { Settings, X, Minimize2, Maximize2, Bug } from 'lucide-react';

/**
 * Debug Control Panel Component
 * Provides runtime control over diagnostic tools
 */
export const DebugControlPanel: React.FC = () => {
  const {
    config,
    updateConfig,
    toggleMobXMonitor,
    togglePerformanceMonitor,
    toggleLogOverlay,
    toggleNetworkMonitor,
    resetToDefaults
  } = useDiagnostics();
  
  // Don't render in production
  if (!import.meta.env.DEV || !config.showControlPanel) {
    return null;
  }
  
  // Position styles based on config
  const positionStyles: React.CSSProperties = {
    position: 'fixed',
    zIndex: 10000,
    ...(config.position === 'top-left' && { top: 10, left: 10 }),
    ...(config.position === 'top-right' && { top: 10, right: 10 }),
    ...(config.position === 'bottom-left' && { bottom: 10, left: 10 }),
    ...(config.position === 'bottom-right' && { bottom: 10, right: 10 }),
  };
  
  // Minimized view - just a small button
  if (config.controlPanelMinimized) {
    return (
      <div style={positionStyles}>
        <button
          onClick={() => updateConfig({ controlPanelMinimized: false })}
          style={{
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            border: '2px solid #fff',
            borderRadius: '8px',
            color: '#fff',
            padding: '10px 14px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '13px',
            fontFamily: 'monospace',
            fontWeight: 'bold',
            boxShadow: '0 4px 12px rgba(102, 126, 234, 0.4)',
            transition: 'transform 0.2s',
          }}
          onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.05)'}
          onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
          title="Open Debug Control Panel (Alt+D or Ctrl+Alt+D)"
        >
          <Bug size={18} />
          Debug Panel
        </button>
      </div>
    );
  }
  
  // Full panel view
  return (
    <div style={{
      ...positionStyles,
      background: 'rgba(0, 0, 0, 0.95)',
      border: '1px solid #666',
      borderRadius: '8px',
      padding: '15px',
      minWidth: '250px',
      color: '#fff',
      fontFamily: 'monospace',
      fontSize: config.fontSize === 'small' ? '11px' : config.fontSize === 'medium' ? '13px' : '15px'
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '15px',
        borderBottom: '1px solid #444',
        paddingBottom: '10px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Bug size={18} />
          <span style={{ fontWeight: 'bold' }}>Debug Controls</span>
        </div>
        <div style={{ display: 'flex', gap: '5px' }}>
          <button
            onClick={() => updateConfig({ controlPanelMinimized: true })}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#fff',
              cursor: 'pointer',
              padding: '2px'
            }}
            title="Minimize"
          >
            <Minimize2 size={14} />
          </button>
          <button
            onClick={() => updateConfig({ showControlPanel: false })}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#fff',
              cursor: 'pointer',
              padding: '2px'
            }}
            title="Close (Ctrl+Shift+D to reopen)"
          >
            <X size={14} />
          </button>
        </div>
      </div>
      
      {/* Debug Options */}
      <div style={{ marginBottom: '15px' }}>
        <div style={{ marginBottom: '8px', fontSize: '10px', color: '#888' }}>
          MONITORS
        </div>
        
        <label style={{ display: 'flex', alignItems: 'center', marginBottom: '8px', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={config.enableMobXMonitor}
            onChange={toggleMobXMonitor}
            style={{ marginRight: '8px' }}
          />
          <span title="Ctrl+Shift+M">MobX State Monitor</span>
        </label>
        
        <label style={{ display: 'flex', alignItems: 'center', marginBottom: '8px', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={config.enablePerformanceMonitor}
            onChange={togglePerformanceMonitor}
            style={{ marginRight: '8px' }}
          />
          <span title="Ctrl+Shift+P">Performance Metrics</span>
        </label>
        
        <label style={{ display: 'flex', alignItems: 'center', marginBottom: '8px', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={config.enableLogOverlay}
            onChange={toggleLogOverlay}
            style={{ marginRight: '8px' }}
          />
          <span>Console Log Overlay</span>
        </label>
        
        <label style={{ display: 'flex', alignItems: 'center', marginBottom: '8px', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={config.enableNetworkMonitor}
            onChange={toggleNetworkMonitor}
            style={{ marginRight: '8px' }}
          />
          <span>Network Activity</span>
        </label>
      </div>
      
      {/* Display Settings */}
      <div style={{ marginBottom: '15px' }}>
        <div style={{ marginBottom: '8px', fontSize: '10px', color: '#888' }}>
          DISPLAY SETTINGS
        </div>
        
        <div style={{ marginBottom: '8px' }}>
          <label style={{ display: 'block', marginBottom: '4px', fontSize: '11px' }}>
            Position:
          </label>
          <select
            value={config.position}
            onChange={(e) => updateConfig({ position: e.target.value as any })}
            style={{
              width: '100%',
              background: '#333',
              color: '#fff',
              border: '1px solid #555',
              borderRadius: '3px',
              padding: '4px',
              fontSize: '11px'
            }}
          >
            <option value="top-left">Top Left</option>
            <option value="top-right">Top Right</option>
            <option value="bottom-left">Bottom Left</option>
            <option value="bottom-right">Bottom Right</option>
          </select>
        </div>
        
        <div style={{ marginBottom: '8px' }}>
          <label style={{ display: 'block', marginBottom: '4px', fontSize: '11px' }}>
            Font Size:
          </label>
          <select
            value={config.fontSize}
            onChange={(e) => updateConfig({ fontSize: e.target.value as any })}
            style={{
              width: '100%',
              background: '#333',
              color: '#fff',
              border: '1px solid #555',
              borderRadius: '3px',
              padding: '4px',
              fontSize: '11px'
            }}
          >
            <option value="small">Small</option>
            <option value="medium">Medium</option>
            <option value="large">Large</option>
          </select>
        </div>
        
        <div style={{ marginBottom: '8px' }}>
          <label style={{ display: 'block', marginBottom: '4px', fontSize: '11px' }}>
            Opacity: {Math.round(config.opacity * 100)}%
          </label>
          <input
            type="range"
            min="30"
            max="100"
            value={config.opacity * 100}
            onChange={(e) => updateConfig({ opacity: parseInt(e.target.value) / 100 })}
            style={{ width: '100%' }}
          />
        </div>
      </div>
      
      {/* Actions */}
      <div style={{ borderTop: '1px solid #444', paddingTop: '10px' }}>
        <button
          onClick={resetToDefaults}
          style={{
            width: '100%',
            background: '#444',
            border: '1px solid #555',
            borderRadius: '3px',
            color: '#fff',
            padding: '6px',
            cursor: 'pointer',
            fontSize: '11px'
          }}
        >
          Reset to Defaults
        </button>
      </div>
      
      {/* Keyboard shortcuts help */}
      <div style={{
        marginTop: '10px',
        paddingTop: '10px',
        borderTop: '1px solid #444',
        fontSize: '10px',
        color: '#666'
      }}>
        <div>Keyboard Shortcuts:</div>
        <div>Ctrl+Shift+D - Toggle Panel</div>
        <div>Ctrl+Shift+M - MobX Monitor</div>
        <div>Ctrl+Shift+P - Performance</div>
      </div>
    </div>
  );
};