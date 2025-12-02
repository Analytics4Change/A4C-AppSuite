/**
 * Health Check Server
 *
 * Provides HTTP endpoints for Kubernetes liveness and readiness probes.
 * Runs alongside the Temporal worker in the same process.
 *
 * Endpoints:
 * - GET /health - Liveness probe (returns 200 if process is alive)
 * - GET /ready - Readiness probe (returns 200 if worker is ready to process workflows)
 *
 * Usage:
 * ```typescript
 * const healthCheck = new HealthCheckServer(9090);
 * healthCheck.setTemporalConnected(true);
 * healthCheck.setWorkerRunning(true);
 * ```
 */

import http from 'http';

interface HealthStatus {
  workerRunning: boolean;
  temporalConnected: boolean;
}

/** Default request timeout in milliseconds (30 seconds) */
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export class HealthCheckServer {
  private server: http.Server;
  private port: number;
  private status: HealthStatus = {
    workerRunning: false,
    temporalConnected: false
  };

  /**
   * Create a new health check server
   * @param port - Port to listen on (default: 9090)
   * @param requestTimeout - Request timeout in milliseconds (default: 30000)
   */
  constructor(port: number = 9090, requestTimeout: number = DEFAULT_REQUEST_TIMEOUT_MS) {
    this.port = port;
    this.server = http.createServer((req, res) => {
      this.handleRequest(req, res);
    });

    // Configure server timeouts to prevent hanging connections
    this.server.timeout = requestTimeout;
    this.server.requestTimeout = requestTimeout;
    this.server.headersTimeout = requestTimeout + 1000; // Headers timeout should be slightly longer
    this.server.keepAliveTimeout = 5000; // Close idle connections after 5 seconds
  }

  /**
   * Handle HTTP requests
   */
  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    // Liveness probe - returns 200 if process is alive
    if (req.url === '/health') {
      this.handleHealthCheck(res);
      return;
    }

    // Readiness probe - returns 200 only if worker is ready
    if (req.url === '/ready') {
      this.handleReadinessCheck(res);
      return;
    }

    // 404 for unknown routes
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }

  /**
   * Handle /health endpoint (liveness probe)
   * Always returns 200 OK if the process is running
   */
  private handleHealthCheck(res: http.ServerResponse): void {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      timestamp: new Date().toISOString()
    }));
  }

  /**
   * Handle /ready endpoint (readiness probe)
   * Returns 200 only if worker is ready to process workflows
   */
  private handleReadinessCheck(res: http.ServerResponse): void {
    const isReady = this.status.workerRunning && this.status.temporalConnected;

    const statusCode = isReady ? 200 : 503;
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });

    res.end(JSON.stringify({
      status: isReady ? 'ready' : 'not_ready',
      worker: this.status.workerRunning ? 'running' : 'stopped',
      temporal: this.status.temporalConnected ? 'connected' : 'disconnected',
      timestamp: new Date().toISOString()
    }));
  }

  /**
   * Start the health check server
   */
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.listen(this.port, () => {
        console.log(`[Health Check] Server listening on port ${this.port}`);
        resolve();
      });

      this.server.on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * Update worker running status
   * @param running - Whether the worker is running
   */
  setWorkerRunning(running: boolean): void {
    this.status.workerRunning = running;
    console.log(`[Health Check] Worker status: ${running ? 'running' : 'stopped'}`);
  }

  /**
   * Update Temporal connection status
   * @param connected - Whether connected to Temporal
   */
  setTemporalConnected(connected: boolean): void {
    this.status.temporalConnected = connected;
    console.log(`[Health Check] Temporal status: ${connected ? 'connected' : 'disconnected'}`);
  }

  /**
   * Gracefully close the health check server
   */
  async close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.close((error) => {
        if (error) {
          reject(error);
        } else {
          console.log('[Health Check] Server closed');
          resolve();
        }
      });
    });
  }
}
