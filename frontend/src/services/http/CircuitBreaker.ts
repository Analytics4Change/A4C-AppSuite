/**
 * Circuit breaker pattern implementation for API resilience
 * Prevents cascading failures by failing fast when service is down
 */

import { CircuitState, CircuitBreakerConfig } from '@/types/medication-search.types';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('api');

export class CircuitBreakerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CircuitBreakerError';
  }
}

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime: number | null = null;
  private halfOpenTestCount = 0;
  private readonly config: CircuitBreakerConfig;

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = {
      failureThreshold: config.failureThreshold || 5,
      resetTimeout: config.resetTimeout || 60000, // 1 minute
      halfOpenRequests: config.halfOpenRequests || 3,
      monitoringPeriod: config.monitoringPeriod || 600000 // 10 minutes
    };
  }

  /**
   * Execute function with circuit breaker protection
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Check circuit state
    if (this.state === 'open') {
      if (this.shouldAttemptReset()) {
        this.transitionToHalfOpen();
      } else {
        throw new CircuitBreakerError('Circuit breaker is open - service unavailable');
      }
    }

    try {
      // Execute the function
      const result = await fn();
      
      // Handle success
      this.onSuccess();
      
      return result;
    } catch (error) {
      // Handle failure
      this.onFailure();
      
      // Re-throw the error
      throw error;
    }
  }

  /**
   * Get current circuit state
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Get circuit statistics
   */
  getStats(): {
    state: CircuitState;
    failureCount: number;
    successCount: number;
    lastFailureTime: Date | null;
    isHealthy: boolean;
  } {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime ? new Date(this.lastFailureTime) : null,
      isHealthy: this.state === 'closed'
    };
  }

  /**
   * Force reset the circuit breaker
   */
  reset(): void {
    this.state = 'closed';
    this.failureCount = 0;
    this.successCount = 0;
    this.halfOpenTestCount = 0;
    this.lastFailureTime = null;
    
    log.info('Circuit breaker manually reset');
  }

  /**
   * Handle successful execution
   */
  private onSuccess(): void {
    this.successCount++;
    
    if (this.state === 'half-open') {
      this.halfOpenTestCount++;
      
      // Check if we've had enough successful requests to close the circuit
      if (this.halfOpenTestCount >= this.config.halfOpenRequests) {
        this.transitionToClosed();
      }
    } else if (this.state === 'closed') {
      // Reset failure count on success in closed state
      this.failureCount = 0;
    }
  }

  /**
   * Handle failed execution
   */
  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    
    if (this.state === 'half-open') {
      // Immediately open on failure in half-open state
      this.transitionToOpen();
    } else if (this.state === 'closed') {
      // Check if we've exceeded the failure threshold
      if (this.failureCount >= this.config.failureThreshold) {
        this.transitionToOpen();
      }
    }
  }

  /**
   * Check if we should attempt to reset the circuit
   */
  private shouldAttemptReset(): boolean {
    if (!this.lastFailureTime) {
      return true;
    }
    
    const timeSinceLastFailure = Date.now() - this.lastFailureTime;
    return timeSinceLastFailure >= this.config.resetTimeout;
  }

  /**
   * Transition to open state
   */
  private transitionToOpen(): void {
    this.state = 'open';
    log.warn('Circuit breaker opened', {
      failureCount: this.failureCount,
      threshold: this.config.failureThreshold
    });
  }

  /**
   * Transition to half-open state
   */
  private transitionToHalfOpen(): void {
    this.state = 'half-open';
    this.halfOpenTestCount = 0;
    log.info('Circuit breaker transitioning to half-open');
  }

  /**
   * Transition to closed state
   */
  private transitionToClosed(): void {
    this.state = 'closed';
    this.failureCount = 0;
    this.halfOpenTestCount = 0;
    log.info('Circuit breaker closed - service recovered');
  }
}