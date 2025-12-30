---
status: current
last_updated: 2025-12-30
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: Development-only real-time MobX state monitor showing observable values, render counts, and performance metrics with configurable position/opacity.

**When to read**:
- Debugging MobX reactivity issues
- Monitoring component re-render frequency
- Understanding observable array behavior
- Troubleshooting state not updating

**Prerequisites**: None

**Key topics**: `mobx`, `debugging`, `observables`, `render-count`, `development-only`

**Estimated read time**: 12 minutes
<!-- TL;DR-END -->

# MobXDebugger

## Overview

The MobXDebugger is a development-only diagnostic component that provides real-time monitoring of MobX state changes and component re-render tracking. It displays current observable state, render counts, and performance metrics to help developers debug reactivity issues and optimize component performance.

## Props Interface

```typescript
interface MobXDebuggerProps {
  viewModel: MedicationManagementViewModel;
}
```

## Usage Examples

### Basic MobX Debugging

```tsx
import { MobXDebugger } from '@/components/debug/MobXDebugger';
import { observer } from 'mobx-react-lite';

const MedicationForm = observer(() => {
  const viewModel = useMedicationManagementViewModel();

  return (
    <div>
      <form>
        {/* Your medication form components */}
        <CategorySelection 
          selectedClasses={viewModel.selectedTherapeuticClasses}
          onChange={(classes) => viewModel.setTherapeuticClasses(classes)}
        />
      </form>

      {/* Debug overlay - only visible in development when enabled */}
      <MobXDebugger viewModel={viewModel} />
    </div>
  );
});
```

### With DiagnosticsContext Control

```tsx
import { useDiagnostics } from '@/contexts/DiagnosticsContext';

function DiagnosticControls() {
  const { config, toggleMobXMonitor, setPosition, setOpacity } = useDiagnostics();

  return (
    <div className="space-y-4">
      <div>
        <label className="flex items-center space-x-2">
          <input
            type="checkbox"
            checked={config.enableMobXMonitor}
            onChange={toggleMobXMonitor}
          />
          <span>Enable MobX Monitor</span>
        </label>
      </div>

      {config.enableMobXMonitor && (
        <div className="space-y-2">
          <div>
            <label>Position:</label>
            <select 
              value={config.position} 
              onChange={(e) => setPosition(e.target.value as any)}
            >
              <option value="top-left">Top Left</option>
              <option value="top-right">Top Right</option>
              <option value="bottom-left">Bottom Left</option>
              <option value="bottom-right">Bottom Right</option>
            </select>
          </div>

          <div>
            <label>Opacity:</label>
            <input
              type="range"
              min="0.3"
              max="1"
              step="0.1"
              value={config.opacity}
              onChange={(e) => setOpacity(parseFloat(e.target.value))}
            />
          </div>
        </div>
      )}
    </div>
  );
}
```

### Environment-Based Control

```tsx
// Enable MobX debugging via environment variable
// In .env.development:
// VITE_DEBUG_MOBX=true

function AppWithDebugging() {
  const viewModel = useMedicationManagementViewModel();

  return (
    <div>
      <MedicationManagementView viewModel={viewModel} />
      
      {/* Automatically enabled based on environment */}
      <MobXDebugger viewModel={viewModel} />
    </div>
  );
}
```

### Multiple ViewModels Debugging

```tsx
function MultiViewModelDebug() {
  const medicationViewModel = useMedicationManagementViewModel();
  const clientViewModel = useClientViewModel();
  const { config } = useDiagnostics();

  return (
    <div>
      <ClientManagement viewModel={clientViewModel} />
      <MedicationManagement viewModel={medicationViewModel} />

      {/* Debug multiple ViewModels with position offset */}
      <MobXDebugger viewModel={medicationViewModel} />
      
      {/* Second debugger with manual positioning */}
      {config.enableMobXMonitor && (
        <div
          style={{
            position: 'fixed',
            top: 10,
            left: 300, // Offset from first debugger
            background: `rgba(0, 0, 0, ${config.opacity})`,
            color: '#00ff00',
            padding: '10px',
            borderRadius: '4px',
            fontFamily: 'monospace',
            fontSize: '12px',
            zIndex: 9999
          }}
        >
          <div>Client ViewModel Debug</div>
          <div>Selected Client: {clientViewModel.selectedClient?.name || 'None'}</div>
          <div>Clients Count: {clientViewModel.clients.length}</div>
        </div>
      )}
    </div>
  );
}
```

### Custom ViewModel Integration

```tsx
// For custom ViewModels, implement similar observable patterns
class CustomViewModel {
  selectedItems = observable.array<string>([]);
  isLoading = observable.box(false);
  
  constructor() {
    makeObservable(this);
  }

  setSelectedItems(items: string[]) {
    runInAction(() => {
      this.selectedItems.replace(items);
    });
  }
}

// Create custom debugger for your ViewModel
const CustomViewModelDebugger = observer(({ viewModel }: { viewModel: CustomViewModel }) => {
  const renderCount = useRef(0);
  const { config } = useDiagnostics();
  
  useEffect(() => {
    renderCount.current++;
  });
  
  if (!import.meta.env.DEV || !config.enableMobXMonitor) {
    return null;
  }

  return (
    <div 
      style={{
        position: 'fixed',
        top: 10,
        right: 10,
        background: `rgba(0, 0, 0, ${config.opacity})`,
        color: '#00ff00',
        padding: '10px',
        borderRadius: '4px',
        fontFamily: 'monospace',
        fontSize: '12px',
        zIndex: 9999
      }}
    >
      <div>Custom ViewModel Debug</div>
      <div>Renders: {renderCount.current}</div>
      <div>Selected: {viewModel.selectedItems.length}</div>
      <div>Loading: {viewModel.isLoading.get() ? 'Yes' : 'No'}</div>
    </div>
  );
});
```

### Performance Monitoring

```tsx
const PerformanceAwareMobXDebugger = observer(({ viewModel }: MobXDebuggerProps) => {
  const renderCount = useRef(0);
  const lastRenderTime = useRef(Date.now());
  const renderTimes = useRef<number[]>([]);
  const { config } = useDiagnostics();
  
  useEffect(() => {
    renderCount.current++;
    const now = Date.now();
    const timeSinceLastRender = now - lastRenderTime.current;
    lastRenderTime.current = now;
    
    // Track render frequency
    renderTimes.current.push(timeSinceLastRender);
    if (renderTimes.current.length > 10) {
      renderTimes.current.shift(); // Keep only last 10 renders
    }
  });
  
  if (!import.meta.env.DEV || !config.enableMobXMonitor) {
    return null;
  }

  const avgRenderTime = renderTimes.current.length > 0 
    ? renderTimes.current.reduce((a, b) => a + b, 0) / renderTimes.current.length 
    : 0;

  return (
    <div 
      style={{
        position: 'fixed',
        top: 10,
        left: 10,
        background: `rgba(0, 0, 0, ${config.opacity})`,
        color: avgRenderTime < 16 ? '#00ff00' : '#ff9900', // Green if < 16ms (60fps)
        padding: '10px',
        borderRadius: '4px',
        fontFamily: 'monospace',
        fontSize: '12px',
        zIndex: 9999,
        maxWidth: '300px'
      }}
    >
      <div>MobX Performance Monitor</div>
      <div>Renders: {renderCount.current}</div>
      <div>Avg Render Interval: {avgRenderTime.toFixed(1)}ms</div>
      <div>Selected Classes: {viewModel.selectedTherapeuticClasses.length}</div>
      <div>Selected Indications: {viewModel.selectedIndications.length}</div>
      <div>Last Update: {new Date().toLocaleTimeString()}</div>
      {avgRenderTime > 16 && (
        <div style={{ color: '#ff4444' }}>
          ⚠️ Slow renders detected
        </div>
      )}
    </div>
  );
});
```

## Diagnostic Information Displayed

### Core Metrics

- **Render Count**: Number of times component has re-rendered
- **Observable Arrays**: Current length and contents of observable arrays
- **State Values**: Current values of observable properties
- **Timestamp**: Last update time for change tracking
- **Position**: Configurable overlay position

### Performance Indicators

- **Render Frequency**: How often the component re-renders
- **State Change Rate**: Frequency of observable state changes
- **Array Mutations**: Tracking array modifications that trigger re-renders
- **Performance Warnings**: Alerts for excessive re-renders

## Accessibility

### Development Tool Considerations

- **Non-Intrusive**: Only visible in development mode
- **Keyboard Navigation**: Does not interfere with main application navigation
- **Screen Reader**: Hidden from screen readers via positioning
- **Focus Management**: Does not participate in tab order

### Usage Guidelines

```tsx
// ✅ Good: Only enable in development
if (import.meta.env.DEV) {
  return <MobXDebugger viewModel={viewModel} />;
}

// ✅ Good: Controlled visibility
const { config } = useDiagnostics();
if (config.enableMobXMonitor) {
  return <MobXDebugger viewModel={viewModel} />;
}

// ❌ Avoid: Always rendering in production
return <MobXDebugger viewModel={viewModel} />; // Will show in production
```

## Implementation Notes

### Design Patterns

- **Observer Pattern**: Uses `observer` HOC for reactive updates
- **Development Only**: Automatically disabled in production builds
- **Context Integration**: Controlled via DiagnosticsContext
- **Position Management**: Configurable overlay positioning

### Dependencies

- `mobx-react-lite`: Observer functionality for reactive rendering
- `@/contexts/DiagnosticsContext`: Configuration and control
- React hooks for render counting and effects

### Performance Considerations

- **Zero Production Impact**: Completely disabled in production builds
- **Minimal Overhead**: Lightweight overlay with efficient rendering
- **Memory Management**: No memory leaks or excessive state retention
- **Conditional Rendering**: Only renders when explicitly enabled

### Configuration Options

```typescript
interface DiagnosticsConfig {
  enableMobXMonitor: boolean;
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  opacity: number; // 0.3 to 1.0
  showControlPanel: boolean;
  controlPanelMinimized: boolean;
}
```

## Testing

### Development Testing

```tsx
// Test MobX reactivity debugging
test('should update display when observable changes', () => {
  const viewModel = new MedicationManagementViewModel();
  
  render(
    <DiagnosticsProvider>
      <MobXDebugger viewModel={viewModel} />
    </DiagnosticsProvider>
  );

  // Change observable state
  act(() => {
    viewModel.setTherapeuticClasses(['class1', 'class2']);
  });

  // Debug display should update
  expect(screen.getByText(/Selected Classes: 2/)).toBeInTheDocument();
});
```

### E2E Testing Considerations

```tsx
// Ensure debugger doesn't interfere with E2E tests
test('should not be visible in production mode', () => {
  // Set production environment
  process.env.NODE_ENV = 'production';
  
  render(<MobXDebugger viewModel={viewModel} />);
  
  // Should not render anything
  expect(screen.queryByText(/MobX Debug/)).not.toBeInTheDocument();
});
```

## Related Components

- **DiagnosticsContext**: Configuration and control system
- **DebugControlPanel**: Central debug control interface
- **LogOverlay**: Debug logging display component
- **PerformanceMonitor**: General performance tracking

## Common Integration Patterns

### Debug Dashboard

```tsx
function DebugDashboard() {
  const { config, toggleMobXMonitor } = useDiagnostics();
  const viewModel = useMedicationManagementViewModel();

  return (
    <div className="debug-dashboard">
      <div className="debug-controls">
        <button onClick={toggleMobXMonitor}>
          {config.enableMobXMonitor ? 'Hide' : 'Show'} MobX Monitor
        </button>
      </div>

      {config.enableMobXMonitor && (
        <MobXDebugger viewModel={viewModel} />
      )}
    </div>
  );
}
```

### Keyboard Shortcuts

```tsx
// Enable/disable with Ctrl+Shift+M
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.ctrlKey && e.shiftKey && e.key === 'M') {
      toggleMobXMonitor();
    }
  };

  document.addEventListener('keydown', handleKeyDown);
  return () => document.removeEventListener('keydown', handleKeyDown);
}, [toggleMobXMonitor]);
```

### Conditional Development Features

```tsx
function DevelopmentFeatures() {
  if (!import.meta.env.DEV) {
    return null;
  }

  return (
    <>
      <MobXDebugger viewModel={medicationViewModel} />
      <PerformanceMonitor />
      <LogOverlay />
      <NetworkMonitor />
    </>
  );
}
```

## Troubleshooting MobX Issues

### Common Reactivity Problems

1. **Component not re-rendering**: Check if wrapped with `observer`
2. **Array spreading**: Ensure observable arrays aren't spread (`[...array]`)
3. **Nested property changes**: Verify nested objects are observable
4. **Action usage**: Confirm state mutations use `runInAction`

### Debug Information Interpretation

```typescript
// What to look for in debug output:
// - Render count increasing unexpectedly = unnecessary re-renders
// - Arrays showing wrong length = reactivity broken
// - State not updating = missing observer wrapper
// - Frequent renders = possible infinite loops
```

## Changelog

- **v1.0.0**: Initial implementation with basic state monitoring
- **v1.1.0**: Added DiagnosticsContext integration
- **v1.2.0**: Enhanced positioning and opacity controls
- **v1.3.0**: Added performance monitoring and render tracking
- **v1.4.0**: Improved production build exclusion
- **v1.5.0**: Added keyboard shortcuts and dashboard integration
