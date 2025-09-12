/**
 * Resilient HTTP client with retry logic, circuit breaker, and request cancellation
 */

import { HttpRequestConfig, HealthStatus } from '@/types/medication-search.types';
import { CircuitBreaker } from './CircuitBreaker';
import { API_CONFIG } from '@/config/medication-search.config';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('api');

export class ResilientHttpClient {
  private circuitBreaker: CircuitBreaker;
  private activeRequests: Map<string, AbortController>;
  private requestStats: {
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    totalResponseTime: number;
    lastSuccessTime: number | null;
    lastFailureTime: number | null;
  };

  constructor() {
    this.circuitBreaker = new CircuitBreaker();
    this.activeRequests = new Map();
    this.requestStats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      totalResponseTime: 0,
      lastSuccessTime: null,
      lastFailureTime: null
    };
  }

  /**
   * Make HTTP request with resilience patterns
   */
  async request<T>(config: HttpRequestConfig): Promise<T> {
    const startTime = Date.now();
    const requestId = this.generateRequestId();
    
    // Create abort controller for this request
    const abortController = new AbortController();
    this.activeRequests.set(requestId, abortController);
    
    // Merge abort signals if one was provided
    const signal = config.signal 
      ? this.mergeAbortSignals(abortController.signal, config.signal)
      : abortController.signal;
    
    try {
      // Execute request through circuit breaker
      const result = await this.circuitBreaker.execute(async () => {
        return await this.executeWithRetry<T>({
          ...config,
          signal
        });
      });
      
      // Update statistics
      this.requestStats.totalRequests++;
      this.requestStats.successfulRequests++;
      this.requestStats.totalResponseTime += (Date.now() - startTime);
      this.requestStats.lastSuccessTime = Date.now();
      
      return result;
    } catch (error) {
      // Update statistics
      this.requestStats.totalRequests++;
      this.requestStats.failedRequests++;
      this.requestStats.lastFailureTime = Date.now();
      
      throw error;
    } finally {
      // Clean up
      this.activeRequests.delete(requestId);
    }
  }

  /**
   * Cancel specific request
   */
  cancelRequest(requestId: string): void {
    const controller = this.activeRequests.get(requestId);
    if (controller) {
      controller.abort();
      this.activeRequests.delete(requestId);
      log.debug('Request cancelled', { requestId });
    }
  }

  /**
   * Cancel all active requests
   */
  cancelAllRequests(): void {
    for (const [requestId, controller] of this.activeRequests) {
      controller.abort();
    }
    this.activeRequests.clear();
    log.debug('All requests cancelled');
  }

  /**
   * Get health status of HTTP client
   */
  getHealthStatus(): HealthStatus {
    const circuitStats = this.circuitBreaker.getStats();
    const totalRequests = this.requestStats.totalRequests;
    const successRate = totalRequests > 0 
      ? this.requestStats.successfulRequests / totalRequests 
      : 0;
    const averageResponseTime = this.requestStats.successfulRequests > 0
      ? this.requestStats.totalResponseTime / this.requestStats.successfulRequests
      : 0;
    
    return {
      isOnline: circuitStats.isHealthy,
      lastSuccessTime: this.requestStats.lastSuccessTime 
        ? new Date(this.requestStats.lastSuccessTime) 
        : null,
      lastFailureTime: this.requestStats.lastFailureTime
        ? new Date(this.requestStats.lastFailureTime)
        : null,
      failureCount: this.requestStats.failedRequests,
      successRate,
      averageResponseTime
    };
  }

  /**
   * Execute request with retry logic
   */
  private async executeWithRetry<T>(config: HttpRequestConfig): Promise<T> {
    const maxRetries = config.retries || API_CONFIG.maxRetries;
    const retryDelay = config.retryDelay || API_CONFIG.retryDelay;
    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // Add retry delay if not first attempt
        if (attempt > 0) {
          await this.delay(retryDelay * Math.pow(2, attempt - 1)); // Exponential backoff
          log.debug(`Retry attempt ${attempt}/${maxRetries}`, { url: config.url });
        }
        
        // Execute the request
        const response = await this.executeRequest(config);
        
        // Parse response
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        return data as T;
      } catch (error) {
        lastError = error as Error;
        
        // Don't retry if request was aborted
        if (error instanceof DOMException && error.name === 'AbortError') {
          throw error;
        }
        
        // Don't retry on client errors (4xx)
        if (error instanceof Error && error.message.includes('HTTP 4')) {
          throw error;
        }
        
        // Log retry attempt
        if (attempt < maxRetries) {
          log.warn(`Request failed, will retry`, {
            attempt,
            maxRetries,
            error: lastError.message
          });
        }
      }
    }
    
    // All retries exhausted
    log.error('All retry attempts exhausted', {
      url: config.url,
      maxRetries,
      lastError: lastError?.message
    });
    
    throw lastError || new Error('Request failed after all retries');
  }

  /**
   * Execute the actual HTTP request
   */
  private async executeRequest(config: HttpRequestConfig): Promise<Response> {
    const timeout = config.timeout || API_CONFIG.requestTimeout;
    
    // Create timeout promise
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Request timeout after ${timeout}ms`));
      }, timeout);
    });
    
    // Create fetch promise
    const fetchPromise = fetch(config.url, {
      method: config.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...config.headers
      },
      signal: config.signal
    });
    
    // Race between fetch and timeout
    return Promise.race([fetchPromise, timeoutPromise]);
  }

  /**
   * Merge multiple abort signals
   */
  private mergeAbortSignals(...signals: AbortSignal[]): AbortSignal {
    const controller = new AbortController();
    
    for (const signal of signals) {
      if (signal.aborted) {
        controller.abort();
        break;
      }
      
      signal.addEventListener('abort', () => {
        controller.abort();
      });
    }
    
    return controller.signal;
  }

  /**
   * Generate unique request ID
   */
  private generateRequestId(): string {
    return `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Delay helper for retry logic
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}