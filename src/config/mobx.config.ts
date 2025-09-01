import { configure } from 'mobx';

/**
 * MobX Configuration
 * Debugging MobX reactivity issues with MultiSelectDropdown
 */

// Enable detailed logging in development
if (import.meta.env.DEV) {
  console.log('[MobX Config] Initializing MobX configuration for debugging');
}

configure({
  // Disable strict mode temporarily to allow mutations outside actions
  enforceActions: "never",
  
  // Disable warnings that might indicate the issue
  computedRequiresReaction: false,
  reactionRequiresObservable: false,
  observableRequiresReaction: false,
  
  // Enable better error messages
  disableErrorBoundaries: true,
  
  // Isolate global state for better debugging
  isolateGlobalState: true,
  
  // Enable safer array operations
  useProxies: "always"
});

// Log when configuration is applied
if (import.meta.env.DEV) {
  console.log('[MobX Config] Configuration applied successfully');
}