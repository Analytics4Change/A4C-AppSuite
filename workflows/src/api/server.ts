/**
 * Fastify Server Setup
 *
 * Configures and initializes the Fastify server with all middleware and routes
 */

import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { Connection } from '@temporalio/client';
import { registerHealthRoutes } from './health.js';
import { registerWorkflowRoutes } from './routes/workflows.js';

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';
const TEMPORAL_ADDRESS = process.env.TEMPORAL_ADDRESS || 'temporal-frontend.temporal.svc.cluster.local:7233';

// Extend FastifyInstance with custom properties
declare module 'fastify' {
  interface FastifyInstance {
    temporalConnected?: boolean;
  }
}

/**
 * Create and configure Fastify server
 */
export async function createServer(): Promise<FastifyInstance> {
  const server = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'info',
      serializers: {
        req(request) {
          return {
            method: request.method,
            url: request.url,
            headers: {
              authorization: request.headers.authorization ? '[REDACTED]' : undefined,
              'user-agent': request.headers['user-agent']
            },
            remoteAddress: request.ip
          };
        }
      }
    },
    requestIdHeader: 'x-request-id',
    requestIdLogLabel: 'request_id'
  });

  // Register CORS middleware
  await server.register(cors, {
    origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-ID']
  });

  // Register security headers middleware
  await server.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"]
      }
    }
  });

  // Add Temporal connection check to server
  try {
    server.log.info({ address: TEMPORAL_ADDRESS }, 'Checking Temporal connection...');
    const connection = await Connection.connect({ address: TEMPORAL_ADDRESS });
    await connection.close();
    server.temporalConnected = true;
    server.log.info('✅ Temporal connection verified');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    server.log.error({ error: errorMessage }, '❌ Failed to connect to Temporal');
    server.temporalConnected = false;
  }

  // Register routes
  registerHealthRoutes(server);
  registerWorkflowRoutes(server);

  // Global error handler
  server.setErrorHandler((error: Error & { statusCode?: number }, request, reply) => {
    request.log.error({ error, request_id: request.id }, 'Unhandled error');

    const statusCode = error.statusCode || 500;
    const message = process.env.NODE_ENV === 'production'
      ? 'An error occurred processing your request'
      : error.message;

    void reply.code(statusCode).send({
      error: 'Internal Server Error',
      message,
      request_id: request.id
    });
  });

  return server;
}

/**
 * Start the server
 */
export async function startServer(): Promise<FastifyInstance> {
  const server = await createServer();

  try {
    await server.listen({ port: PORT, host: HOST });
    server.log.info(
      `
============================================================
✅ Temporal API Server running
============================================================

Configuration:
  Host: ${HOST}
  Port: ${PORT}
  Environment: ${process.env.NODE_ENV || 'development'}
  Temporal Address: ${TEMPORAL_ADDRESS}
  Temporal Connected: ${server.temporalConnected}

Endpoints:
  Health: http://${HOST}:${PORT}/health
  Ready:  http://${HOST}:${PORT}/ready
  API:    http://${HOST}:${PORT}/api/v1/workflows/organization-bootstrap

Press Ctrl+C to stop
============================================================
      `
    );

    return server;
  } catch (error) {
    server.log.error(error, 'Failed to start server');
    process.exit(1);
  }
}
