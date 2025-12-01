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
export async function livenessHandler(
  _request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  reply.code(200).send({ status: 'ok', timestamp: new Date().toISOString() });
}

/**
 * Readiness probe - checks if the service is ready to accept traffic
 * Checks Temporal connection status
 */
export async function readinessHandler(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const server = request.server as FastifyInstance & { temporalConnected?: boolean };

  if (!server.temporalConnected) {
    return reply.code(503).send({
      status: 'not_ready',
      reason: 'Temporal connection not established',
      timestamp: new Date().toISOString()
    });
  }

  reply.code(200).send({
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
