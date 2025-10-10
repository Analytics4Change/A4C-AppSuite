import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';

/**
 * Types of focus behaviors that are mutually exclusive
 */
export type FocusBehaviorType = 'tab-as-arrows' | 'enter-as-tab' | 'default';

/**
 * Context value for managing focus behaviors
 */
interface FocusBehaviorContextValue {
  activeBehavior: FocusBehaviorType;
  registerBehavior: (behavior: FocusBehaviorType, componentId: string) => boolean;
  unregisterBehavior: (componentId: string) => void;
  canActivateBehavior: (behavior: FocusBehaviorType) => boolean;
  getRegisteredCount: (behavior: FocusBehaviorType) => number;
}

/**
 * Context for managing mutually exclusive focus behaviors
 */
const FocusBehaviorContext = createContext<FocusBehaviorContextValue | null>(null);

/**
 * Provider component for FocusBehaviorContext
 */
export const FocusBehaviorProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activeBehavior, setActiveBehavior] = useState<FocusBehaviorType>('default');
  const behaviorRegistry = useRef<Map<string, FocusBehaviorType>>(new Map());

  /**
   * Register a focus behavior for a component
   * Returns true if registration successful, false if conflicting behavior exists
   */
  const registerBehavior = useCallback((behavior: FocusBehaviorType, componentId: string): boolean => {
    // Check for conflicts only between DIFFERENT behavior types
    // Multiple components can use the same behavior type
    if (behavior === 'tab-as-arrows' && activeBehavior === 'enter-as-tab') {
      // Check if there are any active 'enter-as-tab' registrations
      const hasConflictingBehavior = Array.from(behaviorRegistry.current.values())
        .some(b => b === 'enter-as-tab');
      
      if (hasConflictingBehavior) {
        console.warn(
          `[FocusBehavior] Cannot activate 'tab-as-arrows' while 'enter-as-tab' is active. ` +
          `Component: ${componentId}`
        );
        return false;
      }
    }
    
    if (behavior === 'enter-as-tab' && activeBehavior === 'tab-as-arrows') {
      // Check if there are any active 'tab-as-arrows' registrations
      const hasConflictingBehavior = Array.from(behaviorRegistry.current.values())
        .some(b => b === 'tab-as-arrows');
      
      if (hasConflictingBehavior) {
        console.warn(
          `[FocusBehavior] Cannot activate 'enter-as-tab' while 'tab-as-arrows' is active. ` +
          `Component: ${componentId}`
        );
        return false;
      }
    }

    // Register the behavior
    behaviorRegistry.current.set(componentId, behavior);
    
    // Update active behavior if needed
    if (behavior !== 'default') {
      // If this is the first non-default registration, or if we're adding to existing same type
      if (activeBehavior === 'default' || activeBehavior === behavior) {
        setActiveBehavior(behavior);
      }
    }
    
    return true;
  }, [activeBehavior]);

  /**
   * Unregister a component's focus behavior
   */
  const unregisterBehavior = useCallback((componentId: string) => {
    const wasBehavior = behaviorRegistry.current.get(componentId);
    behaviorRegistry.current.delete(componentId);
    
    // If this was the last component with a special behavior, reset to default
    if (wasBehavior === activeBehavior) {
      // Check if any other components have the same behavior
      const hasOtherWithSameBehavior = Array.from(behaviorRegistry.current.values())
        .some(b => b === wasBehavior);
      
      if (!hasOtherWithSameBehavior) {
        // Find the next active behavior or default
        const remainingBehaviors = Array.from(behaviorRegistry.current.values())
          .filter(b => b !== 'default');
        
        setActiveBehavior(remainingBehaviors[0] || 'default');
      }
    }
  }, [activeBehavior]);

  /**
   * Check if a behavior can be activated without conflicts
   */
  const canActivateBehavior = useCallback((behavior: FocusBehaviorType): boolean => {
    if (behavior === 'default') return true;
    
    // Allow same type, check for conflicts only between different types
    if (behavior === activeBehavior) return true;
    
    // Check for mutual exclusivity between different types
    if (behavior === 'tab-as-arrows') {
      const hasEnterAsTab = Array.from(behaviorRegistry.current.values())
        .some(b => b === 'enter-as-tab');
      return !hasEnterAsTab;
    }
    
    if (behavior === 'enter-as-tab') {
      const hasTabAsArrows = Array.from(behaviorRegistry.current.values())
        .some(b => b === 'tab-as-arrows');
      return !hasTabAsArrows;
    }
    
    return true;
  }, [activeBehavior]);

  /**
   * Get count of components registered with a specific behavior
   */
  const getRegisteredCount = useCallback((behavior: FocusBehaviorType): number => {
    return Array.from(behaviorRegistry.current.values())
      .filter(b => b === behavior).length;
  }, []);

  const value: FocusBehaviorContextValue = {
    activeBehavior,
    registerBehavior,
    unregisterBehavior,
    canActivateBehavior,
    getRegisteredCount
  };

  return (
    <FocusBehaviorContext.Provider value={value}>
      {children}
    </FocusBehaviorContext.Provider>
  );
};

/**
 * Hook to use the FocusBehaviorContext
 */
export function useFocusBehaviorContext(): FocusBehaviorContextValue {
  const context = useContext(FocusBehaviorContext);
  if (!context) {
    // Return a default implementation if no provider
    return {
      activeBehavior: 'default',
      registerBehavior: () => true,
      unregisterBehavior: () => {},
      canActivateBehavior: () => true,
      getRegisteredCount: () => 0
    };
  }
  return context;
}

/**
 * Hook to register a focus behavior for a component
 * Automatically handles registration/unregistration on mount/unmount
 */
export function useFocusBehavior(
  behavior: FocusBehaviorType,
  enabled: boolean = true
): boolean {
  const context = useFocusBehaviorContext();
  const componentIdRef = useRef<string>(`component-${Math.random().toString(36).substr(2, 9)}`);
  const [isActive, setIsActive] = useState(false);

  useEffect(() => {
    if (!enabled || behavior === 'default') {
      setIsActive(false);
      return;
    }

    const componentId = componentIdRef.current;
    const success = context.registerBehavior(behavior, componentId);
    setIsActive(success);

    return () => {
      context.unregisterBehavior(componentId);
    };
  }, [behavior, enabled, context]);

  return isActive;
}