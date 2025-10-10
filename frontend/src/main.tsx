// Initialize MobX configuration before anything else
import './config/mobx.config';

// Initialize logging system
import { Logger } from './utils/logger';
import { getLoggingConfig } from './config/logging.config';

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { FocusBehaviorProvider } from './contexts/FocusBehaviorContext';
import { DiagnosticsProvider } from './contexts/DiagnosticsContext';
import './index.css';

// Configure logging based on environment
Logger.initialize(getLoggingConfig());

// Log application startup
const log = Logger.getLogger('main');
log.info('Application starting', { 
  mode: import.meta.env.MODE,
  dev: import.meta.env.DEV 
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <DiagnosticsProvider>
      <FocusBehaviorProvider>
        <App />
      </FocusBehaviorProvider>
    </DiagnosticsProvider>
  </React.StrictMode>
);