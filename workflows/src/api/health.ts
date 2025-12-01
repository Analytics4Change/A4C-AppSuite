/**
 * Health Check Endpoints
 *
 * Provides liveness and readiness probes for Kubernetes
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

/**
 * Liveness probe - checks if the service is running
 * Returns 200 if the process is alive
 */
export function livenessHandler(
  _request: FastifyRequest,
  reply: FastifyReply
): void {
  void reply.code(200).send({ status: 'ok', timestamp: new Date().toISOString() });
}

/**
 * Readiness probe - checks if the service is ready to accept traffic
 * Checks Temporal connection status
 */
export function readinessHandler(
  request: FastifyRequest,
  reply: FastifyReply
): void {
  // temporalConnected is declared in server.ts module augmentation
  const server = request.server;

  if (!server.temporalConnected) {
    void reply.code(503).send({
      status: 'not_ready',
      reason: 'Temporal connection not established',
      timestamp: new Date().toISOString()
    });
    return;
  }

  void reply.code(200).send({
    status: 'ready',
    temporal: 'connected',
    timestamp: new Date().toISOString()
  });
}

/**
 * Register health check routes
 */
export function registerHealthRoutes(server: FastifyInstance): void {
  server.get('/health', livenessHandler);
  server.get('/ready', readinessHandler);
}
