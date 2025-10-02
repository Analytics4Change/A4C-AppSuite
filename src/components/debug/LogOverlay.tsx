import React, { useState, useEffect, useRef } from 'react';
import { useDiagnostics } from '@/contexts/DiagnosticsContext';
import { Logger } from '@/utils/logger';
import { X, Trash2, Filter, Download, Search } from 'lucide-react';

interface LogEntry {
  timestamp: number;
  category: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  data?: any;
}

/**
 * Console Log Overlay Component
 * Displays console logs in a floating overlay
 */
export const LogOverlay: React.FC = () => {
  const { config } = useDiagnostics();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [filter, setFilter] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [levelFilter, setLevelFilter] = useState<string>('all');
  const [isMinimized, setIsMinimized] = useState(false);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // Don't render if not enabled
  if (!import.meta.env.DEV || !config.enableLogOverlay) {
    return null;
  }

  // Intercept console methods
  useEffect(() => {
    const originalMethods = {
      log: console.log,
      info: console.info,
      warn: console.warn,
      error: console.error,
      debug: console.debug
    };

    // Create interceptors
    const interceptor = (level: string, originalFn: Function) => {
      return function(...args: any[]) {
        // Call original console method
        originalFn.apply(console, args);
        
        // Parse log entry
        const timestamp = Date.now();
        let category = 'default';
        let message = '';
        let data = undefined;

        // Check if this is a Logger format: [category] message
        const firstArg = args[0];
        if (typeof firstArg === 'string') {
          const categoryMatch = firstArg.match(/^\[([^\]]+)\]/);
          if (categoryMatch) {
            category = categoryMatch[1];
            message = firstArg.substring(categoryMatch[0].length).trim();
            data = args.length > 1 ? args.slice(1) : undefined;
          } else {
            message = args.map(arg => 
              typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
            ).join(' ');
          }
        } else {
          message = args.map(arg => 
            typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
          ).join(' ');
        }

        // Add to log list (deferred to avoid setState-during-render)
        queueMicrotask(() => {
          setLogs(prev => {
            const newLogs = [...prev, {
              timestamp,
              category,
              level: level as any,
              message,
              data
            }];
            // Keep last 500 logs
            return newLogs.slice(-500);
          });
        });
      };
    };

    // Replace console methods
    console.log = interceptor('info', originalMethods.log);
    console.info = interceptor('info', originalMethods.info);
    console.warn = interceptor('warn', originalMethods.warn);
    console.error = interceptor('error', originalMethods.error);
    console.debug = interceptor('debug', originalMethods.debug);

    // Cleanup: restore original methods
    return () => {
      console.log = originalMethods.log;
      console.info = originalMethods.info;
      console.warn = originalMethods.warn;
      console.error = originalMethods.error;
      console.debug = originalMethods.debug;
    };
  }, []);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  // Filter logs
  const filteredLogs = logs.filter(log => {
    if (levelFilter !== 'all' && log.level !== levelFilter) return false;
    if (categoryFilter !== 'all' && log.category !== categoryFilter) return false;
    if (filter && !log.message.toLowerCase().includes(filter.toLowerCase())) return false;
    return true;
  });

  // Get unique categories
  const categories = ['all', ...new Set(logs.map(log => log.category))];

  // Position styles
  const positionStyles: React.CSSProperties = {
    position: 'fixed',
    zIndex: 9999,
    ...(config.position === 'top-left' && { top: 70, left: 10 }),
    ...(config.position === 'top-right' && { top: 70, right: 10 }),
    ...(config.position === 'bottom-left' && { bottom: 10, left: 10 }),
    ...(config.position === 'bottom-right' && { bottom: 10, right: 10 }),
  };

  // Level colors
  const levelColors = {
    debug: '#6B7280',
    info: '#3B82F6',
    warn: '#F59E0B',
    error: '#EF4444'
  };

  // Clear logs
  const clearLogs = () => {
    setLogs([]);
  };

  // Export logs
  const exportLogs = () => {
    const content = logs.map(log => 
      `[${new Date(log.timestamp).toLocaleTimeString()}] [${log.level.toUpperCase()}] [${log.category}] ${log.message}`
    ).join('\n');
    
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `logs-${new Date().toISOString()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Minimized view
  if (isMinimized) {
    return (
      <div style={positionStyles}>
        <button
          onClick={() => setIsMinimized(false)}
          style={{
            background: 'rgba(0, 0, 0, 0.9)',
            border: '1px solid #444',
            borderRadius: '4px',
            color: '#fff',
            padding: '8px 12px',
            cursor: 'pointer',
            fontFamily: 'monospace',
            fontSize: '12px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }}
        >
          📋 Logs ({filteredLogs.length})
        </button>
      </div>
    );
  }

  return (
    <div style={{
      ...positionStyles,
      width: '600px',
      maxWidth: '90vw',
      height: '400px',
      maxHeight: '80vh',
      background: 'rgba(0, 0, 0, 0.95)',
      border: '1px solid #444',
      borderRadius: '6px',
      display: 'flex',
      flexDirection: 'column',
      fontFamily: 'monospace',
      fontSize: config.fontSize === 'small' ? '11px' : config.fontSize === 'medium' ? '12px' : '14px',
      opacity: config.opacity
    }}>
      {/* Header */}
      <div style={{
        padding: '10px',
        borderBottom: '1px solid #444',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexShrink: 0
      }}>
        <div style={{ color: '#fff', fontWeight: 'bold' }}>
          📋 Console Logs ({filteredLogs.length}/{logs.length})
        </div>
        <div style={{ display: 'flex', gap: '5px' }}>
          <button
            onClick={exportLogs}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#fff',
              cursor: 'pointer',
              padding: '2px'
            }}
            title="Export logs"
          >
            <Download size={14} />
          </button>
          <button
            onClick={clearLogs}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#fff',
              cursor: 'pointer',
              padding: '2px'
            }}
            title="Clear logs"
          >
            <Trash2 size={14} />
          </button>
          <button
            onClick={() => setIsMinimized(true)}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#fff',
              cursor: 'pointer',
              padding: '2px'
            }}
            title="Minimize"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Filters */}
      <div style={{
        padding: '8px',
        borderBottom: '1px solid #333',
        display: 'flex',
        gap: '8px',
        flexShrink: 0
      }}>
        {/* Search */}
        <div style={{ flex: 1, position: 'relative' }}>
          <Search size={12} style={{
            position: 'absolute',
            left: '6px',
            top: '50%',
            transform: 'translateY(-50%)',
            color: '#666'
          }} />
          <input
            type="text"
            placeholder="Filter messages..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{
              width: '100%',
              background: '#222',
              border: '1px solid #444',
              borderRadius: '3px',
              color: '#fff',
              padding: '4px 4px 4px 24px',
              fontSize: '11px'
            }}
          />
        </div>

        {/* Category filter */}
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          style={{
            background: '#222',
            border: '1px solid #444',
            borderRadius: '3px',
            color: '#fff',
            padding: '4px',
            fontSize: '11px'
          }}
        >
          {categories.map(cat => (
            <option key={cat} value={cat}>{cat}</option>
          ))}
        </select>

        {/* Level filter */}
        <select
          value={levelFilter}
          onChange={(e) => setLevelFilter(e.target.value)}
          style={{
            background: '#222',
            border: '1px solid #444',
            borderRadius: '3px',
            color: '#fff',
            padding: '4px',
            fontSize: '11px'
          }}
        >
          <option value="all">All Levels</option>
          <option value="debug">Debug</option>
          <option value="info">Info</option>
          <option value="warn">Warn</option>
          <option value="error">Error</option>
        </select>

        {/* Auto-scroll toggle */}
        <label style={{
          display: 'flex',
          alignItems: 'center',
          color: '#999',
          fontSize: '11px',
          cursor: 'pointer'
        }}>
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
            style={{ marginRight: '4px' }}
          />
          Auto
        </label>
      </div>

      {/* Logs */}
      <div
        ref={logContainerRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '8px',
          minHeight: 0
        }}
      >
        {filteredLogs.length === 0 ? (
          <div style={{ color: '#666', textAlign: 'center', padding: '20px' }}>
            No logs to display
          </div>
        ) : (
          filteredLogs.map((log, index) => (
            <div
              key={index}
              style={{
                marginBottom: '4px',
                padding: '4px 6px',
                background: 'rgba(255, 255, 255, 0.02)',
                borderLeft: `3px solid ${levelColors[log.level]}`,
                color: '#fff',
                wordBreak: 'break-all'
              }}
            >
              <div style={{ display: 'flex', gap: '8px', marginBottom: '2px' }}>
                <span style={{ color: '#666', fontSize: '10px' }}>
                  {new Date(log.timestamp).toLocaleTimeString()}
                </span>
                <span style={{ 
                  color: levelColors[log.level], 
                  fontSize: '10px',
                  fontWeight: 'bold' 
                }}>
                  {log.level.toUpperCase()}
                </span>
                <span style={{ color: '#999', fontSize: '10px' }}>
                  [{log.category}]
                </span>
              </div>
              <div style={{ marginLeft: '4px' }}>
                {log.message}
              </div>
              {log.data && (
                <div style={{ 
                  marginLeft: '4px', 
                  marginTop: '4px',
                  fontSize: '10px',
                  color: '#888',
                  fontFamily: 'monospace'
                }}>
                  <pre style={{ margin: 0 }}>
                    {JSON.stringify(log.data, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};