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
const PLATFORM_BASE_DOMAIN = process.env.PLATFORM_BASE_DOMAIN;

/**
 * Derive CORS origins from platform base domain
 * Allows: https://{domain} and https://*.{domain} (all tenant subdomains)
 *
 * Uses @fastify/cors OriginFunction signature:
 * (origin: string | undefined, callback: (err: Error | null, origin: boolean | string | RegExp) => void) => void
 */
function getCorsOrigin(): boolean | string | string[] | RegExp | ((origin: string | undefined, callback: (err: Error | null, origin: boolean | string | RegExp) => void) => void) {
  // If platform domain is configured, use callback-based validation
  if (PLATFORM_BASE_DOMAIN) {
    return (origin: string | undefined, callback: (err: Error | null, origin: boolean | string | RegExp) => void) => {
      // Allow requests with no origin (same-origin, curl, etc.)
      if (!origin) {
        callback(null, true);
        return;
      }

      // Match base domain and any subdomain
      const escapedDomain = PLATFORM_BASE_DOMAIN.replace(/\./g, '\\.');
      const regex = new RegExp(`^https://([a-z0-9-]+\\.)?${escapedDomain}$`);

      if (regex.test(origin)) {
        callback(null, origin); // Return the origin as allowed
      } else {
        callback(new Error(`Origin ${origin} not allowed by CORS`), false);
      }
    };
  }

  // Fallback to ALLOWED_ORIGINS or wildcard
  return process.env.ALLOWED_ORIGINS?.split(',') || '*';
}

/**
 * Connect to Temporal with retry logic
 * Uses exponential backoff: 1s, 2s, 4s, 8s, 16s (max 30s)
 */
async function connectToTemporal(
  logger: { info: (obj: object, msg?: string) => void; warn: (obj: object, msg?: string) => void; error: (obj: object, msg?: string) => void },
  maxRetries = 5
): Promise<boolean> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.info({ address: TEMPORAL_ADDRESS, attempt, maxRetries }, 'Checking Temporal connection...');
      const connection = await Connection.connect({ address: TEMPORAL_ADDRESS });
      await connection.close();
      logger.info({ attempt }, '✅ Temporal connection verified');
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.warn({ error: errorMessage, attempt, maxRetries }, 'Temporal connection attempt failed');

      if (attempt < maxRetries) {
        // Exponential backoff: 1s, 2s, 4s, 8s, 16s (capped at 30s)
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 30000);
        logger.info({ delay, nextAttempt: attempt + 1 }, `Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  logger.error({ maxRetries }, '❌ Failed to connect to Temporal after all retries');
  return false;
}

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
  // Uses PLATFORM_BASE_DOMAIN for dynamic subdomain support, falls back to ALLOWED_ORIGINS or '*'
  await server.register(cors, {
    origin: getCorsOrigin(),
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

  // Add Temporal connection check with retry logic
  server.temporalConnected = await connectToTemporal(server.log);

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
  CORS: ${PLATFORM_BASE_DOMAIN ? `*.${PLATFORM_BASE_DOMAIN}` : (process.env.ALLOWED_ORIGINS || '*')}

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
