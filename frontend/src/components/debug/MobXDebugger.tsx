import React, { useEffect, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { MedicationManagementViewModel } from '@/viewModels/medication/MedicationManagementViewModel';
import { useDiagnostics } from '@/contexts/DiagnosticsContext';

interface MobXDebuggerProps {
  viewModel: MedicationManagementViewModel;
}

/**
 * Debug component to monitor MobX state changes
 * Shows current state and render count
 * Visibility controlled by DiagnosticsContext
 */
export const MobXDebugger: React.FC<MobXDebuggerProps> = observer(({ viewModel }) => {
  const renderCount = useRef(0);
  const { config } = useDiagnostics();
  
  useEffect(() => {
    renderCount.current++;
  });
  
  // Check if should display based on context
  if (!import.meta.env.DEV || !config.enableMobXMonitor) {
    return null;
  }
  
  // Calculate position based on config
  const positionStyles: React.CSSProperties = {
    ...(config.position === 'top-left' && { top: 10, left: 10 }),
    ...(config.position === 'top-right' && { top: 10, right: 10 }),
    ...(config.position === 'bottom-left' && { bottom: 10, left: 10 }),
    ...(config.position === 'bottom-right' && { bottom: 10, right: 10 }),
  };
  
  // Offset if control panel is in same position
  if (config.showControlPanel && !config.controlPanelMinimized) {
    if (config.position === 'bottom-right') {
      positionStyles.bottom = 320; // Move above control panel
    }
  }
  
  return (
    <div 
      style={{
        position: 'fixed',
        ...positionStyles,
        background: `rgba(0, 0, 0, ${config.opacity})`,
        color: '#00ff00',
        padding: '10px',
        borderRadius: '5px',
        fontSize: config.fontSize === 'small' ? '11px' : config.fontSize === 'medium' ? '12px' : '14px',
        fontFamily: 'monospace',
        maxWidth: '400px',
        zIndex: 9999,
        border: '1px solid #00ff00'
      }}
    >
      <div style={{ marginBottom: '5px', color: '#ffff00' }}>
        🔍 MobX State Monitor
      </div>
      <div style={{ marginBottom: '5px' }}>
        Render Count: {renderCount.current}
      </div>
      <div style={{ marginBottom: '5px' }}>
        Dosage Timings ({viewModel.selectedTimings.length}):
        <div style={{ marginLeft: '10px', color: '#00ffff' }}>
          {JSON.stringify(viewModel.selectedTimings, null, 2)}
        </div>
      </div>
      <div style={{ fontSize: '10px', color: '#888', marginTop: '5px' }}>
        Last update: {new Date().toLocaleTimeString()}
      </div>
    </div>
  );
});