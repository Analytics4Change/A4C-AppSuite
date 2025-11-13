---
status: current
last_updated: 2025-01-13
---

# DebugControlPanel

## Overview

A comprehensive debugging interface that provides developers with real-time control over various diagnostic monitors and debugging tools. This component is only available in development builds and provides a centralized way to enable/disable different debugging features.

## Props Interface

```typescript
// DebugControlPanel has no props - it uses DiagnosticsContext for state
interface DebugControlPanelProps {
  // No props required - all state managed via context
}
```

## Usage Examples

### Basic Usage

```tsx
import { DebugControlPanel } from '@/components/debug/DebugControlPanel';

function App() {
  return (
    <div className="app">
      {/* Your app content */}
      <MainContent />
      
      {/* Debug control panel - only renders in development */}
      <DebugControlPanel />
    </div>
  );
}
```

### Integration with Diagnostics Context

```tsx
import { DiagnosticsProvider } from '@/contexts/DiagnosticsContext';
import { DebugControlPanel } from '@/components/debug/DebugControlPanel';

function AppWithDiagnostics() {
  return (
    <DiagnosticsProvider>
      <Router>
        <Routes>
          {/* Your app routes */}
        </Routes>
      </Router>
      
      {/* Control panel for debugging */}
      <DebugControlPanel />
    </DiagnosticsProvider>
  );
}
```

### Conditional Development Rendering

```tsx
function DevelopmentWrapper() {
  return (
    <div className="app">
      <MainApp />
      
      {/* Only show in development */}
      {import.meta.env.DEV && <DebugControlPanel />}
    </div>
  );
}
```

## Accessibility

### WCAG 2.1 Level AA Compliance

- **Keyboard Navigation**:
  - Tab/Shift+Tab navigation between controls
  - Enter/Space to toggle debug features
  - Arrow keys for slider controls (opacity, position)
  - Escape to close panel

- **ARIA Attributes**:
  - `role="dialog"` for the control panel
  - `aria-label` for all toggle buttons and sliders
  - `aria-describedby` for control descriptions
  - `aria-expanded` for collapsible sections
  - `aria-pressed` for toggle buttons

- **Focus Management**:
  - Clear focus indicators on all controls
  - Logical tab order through controls
  - Focus preservation when panel is minimized
  - Keyboard shortcut (Ctrl+Shift+D) to open/close

### Screen Reader Support

- All controls properly labeled for screen readers
- State changes announced (enabled/disabled)
- Slider values announced during adjustment
- Panel open/close state communicated

## Styling

### CSS Classes

- `.debug-control-panel`: Main panel container
- `.debug-control-panel--minimized`: Minimized state
- `.debug-control-panel--maximized`: Maximized state
- `.debug-control-panel__header`: Panel header with title
- `.debug-control-panel__content`: Panel content area
- `.debug-control-panel__section`: Grouped controls section
- `.debug-control-panel__toggle`: Toggle button styling
- `.debug-control-panel__slider`: Slider control styling
- `.debug-control-panel__position-controls`: Position adjustment controls

### Panel Positioning

```css
.debug-control-panel {
  position: fixed;
  z-index: 9999;
  background: rgba(0, 0, 0, 0.9);
  backdrop-filter: blur(10px);
  border-radius: 8px;
  padding: 16px;
  color: white;
  font-family: monospace;
}

/* Position variants */
.debug-control-panel--top-left { top: 20px; left: 20px; }
.debug-control-panel--top-right { top: 20px; right: 20px; }
.debug-control-panel--bottom-left { bottom: 20px; left: 20px; }
.debug-control-panel--bottom-right { bottom: 20px; right: 20px; }
```

### Visual Design

- Dark, semi-transparent background with blur effect
- High contrast for visibility over any content
- Monospace font for technical information
- Color-coded toggles (green for enabled, red for disabled)
- Smooth transitions for state changes

## Implementation Notes

### Design Patterns

- **Control Panel Pattern**: Centralized debugging interface
- **Context Integration**: Uses DiagnosticsContext for state management
- **Conditional Rendering**: Only appears in development builds
- **Persistent Settings**: Saves preferences to localStorage

### Available Debug Controls

#### Monitor Toggles

- **MobX Monitor**: Real-time MobX state observation
- **Performance Monitor**: FPS and performance metrics
- **Network Monitor**: API request tracking
- **Log Overlay**: Console log display overlay

#### Panel Configuration

- **Position**: Four corner positions (top-left, top-right, bottom-left, bottom-right)
- **Opacity**: Adjustable from 30% to 100%
- **Font Size**: Small, medium, large options
- **Minimized State**: Collapse to small indicator

#### Keyboard Shortcuts

- `Ctrl+Shift+D`: Toggle control panel visibility
- `Ctrl+Shift+M`: Toggle MobX monitor
- `Ctrl+Shift+P`: Toggle performance monitor
- `Ctrl+Shift+L`: Toggle log overlay
- `Ctrl+Shift+N`: Toggle network monitor

### State Persistence

```typescript
// Settings saved to localStorage
interface DebugSettings {
  panelVisible: boolean;
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  opacity: number;
  fontSize: 'small' | 'medium' | 'large';
  enabledMonitors: {
    mobx: boolean;
    performance: boolean;
    network: boolean;
    logs: boolean;
  };
}
```

### Dependencies

- DiagnosticsContext for state management
- React 18+ for component functionality
- Lucide React for control icons
- localStorage for settings persistence

### Performance Considerations

- Only renders in development builds
- Minimal performance impact when closed
- Efficient event handling and state updates
- Debounced slider updates

## Testing

### Unit Tests

Located in `DebugControlPanel.test.tsx`. Covers:

- Panel rendering and visibility
- Toggle functionality for each monitor
- Settings persistence and restoration
- Keyboard shortcut handling
- Accessibility attribute presence

### Integration Tests

- Integration with DiagnosticsContext
- Monitor activation and deactivation
- Settings synchronization across components
- Performance impact measurement

### Development Testing

- Manual testing in different browsers
- Keyboard navigation verification
- Screen reader compatibility
- Mobile device responsive behavior

## Related Components

- `MobXDebugger` - Monitor controlled by this panel
- `LogOverlay` - Log display controlled by this panel
- `PerformanceMonitor` - Performance metrics controlled by this panel
- `NetworkMonitor` - Network tracking controlled by this panel

## Configuration

### Environment-Based Behavior

```typescript
// Component only renders in development
if (!import.meta.env.DEV) {
  return null;
}

// Environment variables for initial state
const initialConfig = {
  enableMobXMonitor: import.meta.env.VITE_DEBUG_MOBX === 'true',
  enablePerformanceMonitor: import.meta.env.VITE_DEBUG_PERFORMANCE === 'true',
  enableLogs: import.meta.env.VITE_DEBUG_LOGS === 'true'
};
```

### Custom Monitor Integration

```typescript
// Adding custom monitors to the control panel
const customMonitors = [
  {
    id: 'custom-monitor',
    name: 'Custom Monitor',
    description: 'Custom debugging monitor',
    toggle: toggleCustomMonitor,
    enabled: config.enableCustomMonitor
  }
];
```

## Best Practices

### Development Workflow

1. **Enable During Development**: Use keyboard shortcuts to quickly toggle monitors
2. **Performance Monitoring**: Enable performance monitor when optimizing
3. **State Debugging**: Use MobX monitor for state management issues
4. **Network Debugging**: Enable network monitor for API issues
5. **Log Analysis**: Use log overlay for real-time log monitoring

### Production Safety

- Automatically disabled in production builds
- No performance impact on production
- Settings isolated to development environment
- No data leakage to production logs

## Security Considerations

### Development-Only Features

- Never included in production bundles
- No access to sensitive production data
- Isolated from application security contexts
- Safe for development team sharing

### Data Privacy

- Debug data stays in browser
- No transmission of debug information
- Respect user privacy even in development
- Clear data on browser close

## Changelog

- Initial implementation with basic monitor toggles
- Added keyboard shortcuts for quick access
- Enhanced accessibility features
- Added position and opacity controls
- Implemented settings persistence
- Added support for custom monitors
- Enhanced visual design and UX
