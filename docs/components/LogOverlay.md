# LogOverlay

## Overview

A real-time log display overlay that shows console log messages directly in the application UI during development. This component provides filtering, searching, and categorization of log messages to help developers debug issues without switching to browser developer tools.

## Props Interface

```typescript
// LogOverlay has no props - controlled via DiagnosticsContext
interface LogOverlayProps {
  // No props required - all state managed via context
}
```

## Usage Examples

### Basic Usage

```tsx
import { LogOverlay } from '@/components/debug/LogOverlay';

function App() {
  return (
    <div className="app">
      <MainContent />
      
      {/* Log overlay - only renders when enabled in development */}
      <LogOverlay />
    </div>
  );
}
```

### Integration with Diagnostics System

```tsx
import { useDiagnostics } from '@/contexts/DiagnosticsContext';
import { LogOverlay } from '@/components/debug/LogOverlay';

function DiagnosticsWrapper() {
  const { config } = useDiagnostics();
  
  return (
    <div className="app">
      <MainApp />
      
      {/* Conditionally render based on diagnostics config */}
      {config.enableLogOverlay && <LogOverlay />}
    </div>
  );
}
```

### Custom Log Integration

```tsx
import { Logger } from '@/utils/logger';

function ComponentWithLogging() {
  const log = Logger.getLogger('component');
  
  useEffect(() => {
    log.debug('Component mounted');
    return () => log.debug('Component unmounted');
  }, []);

  const handleAction = () => {
    log.info('User action performed', { action: 'button-click' });
  };

  return (
    <div>
      <button onClick={handleAction}>Perform Action</button>
      {/* LogOverlay will show these logs in real-time */}
    </div>
  );
}
```

## Accessibility

### WCAG 2.1 Level AA Compliance

- **Keyboard Navigation**: 
  - Tab/Shift+Tab navigation through controls
  - Enter/Space for filter toggles and actions
  - Arrow keys for log navigation
  - Escape to close overlay

- **ARIA Attributes**:
  - `role="log"` for the main log display area
  - `aria-live="polite"` for new log announcements
  - `aria-label` for filter controls and buttons
  - `aria-describedby` for search and filter help
  - `aria-expanded` for collapsible sections

- **Focus Management**:
  - Clear focus indicators on interactive elements
  - Focus preservation during log updates
  - Logical tab order through controls
  - Focus restoration after overlay actions

### Screen Reader Support

- Log level changes announced appropriately
- New log entries announced without overwhelming
- Filter and search state changes communicated
- Clear labels for all interactive elements

## Styling

### CSS Classes

- `.log-overlay`: Main overlay container
- `.log-overlay__header`: Header with controls
- `.log-overlay__controls`: Filter and search controls
- `.log-overlay__content`: Main log display area
- `.log-overlay__entry`: Individual log entry
- `.log-overlay__entry--debug`: Debug level styling
- `.log-overlay__entry--info`: Info level styling
- `.log-overlay__entry--warn`: Warning level styling
- `.log-overlay__entry--error`: Error level styling
- `.log-overlay__footer`: Footer with statistics
- `.log-overlay--minimized`: Minimized state

### Log Level Styling

```css
.log-overlay__entry--debug {
  color: #8b5cf6;
  border-left: 3px solid #8b5cf6;
}

.log-overlay__entry--info {
  color: #06b6d4;
  border-left: 3px solid #06b6d4;
}

.log-overlay__entry--warn {
  color: #f59e0b;
  border-left: 3px solid #f59e0b;
}

.log-overlay__entry--error {
  color: #ef4444;
  border-left: 3px solid #ef4444;
  background-color: rgba(239, 68, 68, 0.1);
}
```

### Overlay Positioning

```css
.log-overlay {
  position: fixed;
  top: 60px;
  right: 20px;
  width: 400px;
  max-height: 500px;
  background: rgba(0, 0, 0, 0.95);
  backdrop-filter: blur(10px);
  border-radius: 8px;
  z-index: 9998;
  overflow: hidden;
}
```

## Implementation Notes

### Design Patterns

- **Observer Pattern**: Listens to logger events for real-time updates
- **Filter Pattern**: Multiple filtering criteria for log display
- **Virtual Scrolling**: Efficient rendering of large log lists
- **Buffer Management**: Limits log history for memory efficiency

### Log Capture Mechanism

```typescript
// Intercepts console methods
const originalConsole = {
  log: console.log,
  debug: console.debug,
  info: console.info,
  warn: console.warn,
  error: console.error
};

// Override with logging capture
console.log = (...args) => {
  captureLog('info', args);
  originalConsole.log(...args);
};
```

### Filtering and Search

#### Available Filters
- **Log Level**: Debug, Info, Warn, Error
- **Category**: Component, ViewModel, API, etc.
- **Time Range**: Last 5min, 15min, 1hr, All
- **Source**: Specific component or module

#### Search Features
- **Text Search**: Search within log messages
- **Regex Support**: Advanced pattern matching
- **Case Sensitivity**: Toggle case-sensitive search
- **Highlighting**: Search term highlighting in results

### Buffer Management

```typescript
interface LogBuffer {
  maxEntries: number;        // Maximum log entries to store
  maxMemory: number;         // Maximum memory usage in MB
  cleanupInterval: number;   // Cleanup interval in ms
  retentionTime: number;     // Log retention time in ms
}

const defaultBufferConfig: LogBuffer = {
  maxEntries: 1000,
  maxMemory: 10,
  cleanupInterval: 60000,
  retentionTime: 300000
};
```

### Performance Optimizations

- **Virtual Scrolling**: Only renders visible log entries
- **Debounced Search**: Prevents excessive filtering operations
- **Memory Management**: Automatic cleanup of old log entries
- **Efficient Updates**: Minimal re-renders on new log entries

### Dependencies

- DiagnosticsContext for state management
- Logger utility for log capture
- React 18+ for component functionality
- Virtual scrolling library for performance

## Testing

### Unit Tests

Located in `LogOverlay.test.tsx`. Covers:
- Log entry display and formatting
- Filter functionality
- Search capabilities
- Buffer management
- Accessibility attributes

### Integration Tests

- Integration with logging system
- Real-time log capture and display
- Performance under high log volume
- Memory usage and cleanup

### Development Testing

- Manual testing with various log levels
- Performance testing with large log volumes
- Mobile device responsive behavior
- Screen reader compatibility

## Related Components

- `DebugControlPanel` - Controls log overlay visibility
- `Logger` - Utility that generates log entries
- `MobXDebugger` - Complementary debugging tool
- `PerformanceMonitor` - Another debugging overlay

## Configuration

### Log Categories

```typescript
const logCategories = [
  'main',           // Application startup and lifecycle
  'mobx',           // MobX state management
  'viewmodel',      // ViewModel business logic
  'navigation',     // Focus and keyboard navigation
  'component',      // Component lifecycle
  'api',            // API calls and responses
  'validation',     // Form validation
  'diagnostics'     // Debug tool controls
];
```

### Display Settings

```typescript
interface LogOverlayConfig {
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  maxVisible: number;           // Maximum visible log entries
  autoScroll: boolean;          // Auto-scroll to latest logs
  showTimestamps: boolean;      // Show timestamp for each log
  showCategories: boolean;      // Show log categories
  compactMode: boolean;         // Compact display mode
  fontSize: 'small' | 'medium' | 'large';
}
```

### Environment Variables

```env
# Log overlay configuration
VITE_DEBUG_LOGS=true
VITE_LOG_LEVEL=debug
VITE_LOG_MAX_ENTRIES=1000
VITE_LOG_RETENTION_TIME=300000
```

## Advanced Features

### Log Export

```typescript
// Export logs for analysis
const exportLogs = (format: 'json' | 'csv' | 'txt') => {
  const logs = getFilteredLogs();
  const exported = formatLogs(logs, format);
  downloadFile(exported, `logs-${Date.now()}.${format}`);
};
```

### Real-time Streaming

```typescript
// WebSocket integration for remote log streaming
const streamLogsToRemote = (endpoint: string) => {
  const ws = new WebSocket(endpoint);
  
  onLogEntry((logEntry) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(logEntry));
    }
  });
};
```

### Custom Log Formatters

```typescript
// Custom formatting for different log types
const formatters = {
  error: (entry) => `🚨 ${entry.timestamp} [${entry.category}] ${entry.message}`,
  warn: (entry) => `⚠️ ${entry.timestamp} [${entry.category}] ${entry.message}`,
  info: (entry) => `ℹ️ ${entry.timestamp} [${entry.category}] ${entry.message}`,
  debug: (entry) => `🔍 ${entry.timestamp} [${entry.category}] ${entry.message}`
};
```

## Best Practices

### Development Workflow

1. **Enable for Debugging**: Turn on when investigating issues
2. **Use Appropriate Log Levels**: Debug for detailed info, Error for problems
3. **Filter by Category**: Focus on specific areas of the application
4. **Search for Patterns**: Use regex to find specific log patterns
5. **Export for Analysis**: Save logs for offline analysis

### Performance Considerations

- Enable only when needed to avoid performance impact
- Use appropriate buffer sizes for your use case
- Monitor memory usage during long debugging sessions
- Clear logs periodically to maintain performance

## Security Considerations

### Development-Only Feature

- Never included in production builds
- No sensitive data exposure in logs
- Isolated from production logging systems
- Safe for development team sharing

### Data Privacy

- Log data stays in browser memory
- No transmission to external servers
- Automatic cleanup of sensitive information
- Respect user privacy in development

## Changelog

- Initial implementation with basic log display
- Added filtering and search capabilities
- Enhanced performance with virtual scrolling
- Implemented buffer management and cleanup
- Added export functionality
- Enhanced accessibility features
- Added real-time streaming capabilities