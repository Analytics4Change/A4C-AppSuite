/**
 * Authentication Middleware
 *
 * Validates JWT tokens and checks permissions using Supabase Auth
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY!;

interface JWTPayload {
  permissions?: string[];
  org_id?: string;
  user_role?: string;
  scope_path?: string;
  sub?: string;
  email?: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: {
      id: string;
      email: string;
      permissions: string[];
      org_id?: string;
      user_role?: string;
    };
    supabaseClient?: SupabaseClient;
  }
}

/**
 * Decode JWT payload from token
 */
function decodeJWT(token: string): JWTPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf-8'));
    return payload;
  } catch {
    return null;
  }
}

/**
 * Authentication middleware
 * Validates JWT token and attaches user info to request
 */
export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const authHeader = request.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return reply.code(401).send({
      error: 'Unauthorized',
      message: 'Missing or invalid authorization header'
    });
  }

  const token = authHeader.substring(7); // Remove 'Bearer ' prefix

  // Decode JWT to get custom claims
  const jwtPayload = decodeJWT(token);
  if (!jwtPayload) {
    return reply.code(401).send({
      error: 'Unauthorized',
      message: 'Invalid JWT token format'
    });
  }

  // Create Supabase client with user's token for validation
  const supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: authHeader
      }
    }
  });

  // Validate token by getting user
  const { data: { user }, error: authError } = await supabaseClient.auth.getUser();

  if (authError || !user) {
    return reply.code(401).send({
      error: 'Unauthorized',
      message: 'Invalid or expired token'
    });
  }

  // Attach user info to request (from JWT custom claims)
  request.user = {
    id: user.id,
    email: user.email!,
    permissions: jwtPayload.permissions || [],
    org_id: jwtPayload.org_id,
    user_role: jwtPayload.user_role
  };

  request.supabaseClient = supabaseClient;
}

/**
 * Permission check middleware factory
 * Returns middleware that checks if user has required permission
 */
export function requirePermission(permission: string) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      return reply.code(401).send({
        error: 'Unauthorized',
        message: 'Authentication required'
      });
    }

    if (!request.user.permissions.includes(permission)) {
      request.log.warn({
        user_id: request.user.id,
        user_email: request.user.email,
        required_permission: permission,
        user_permissions: request.user.permissions
      }, 'Permission denied');

      return reply.code(403).send({
        error: 'Forbidden',
        message: `Permission '${permission}' required`,
        required_permission: permission,
        user_permissions: request.user.permissions
      });
    }
  };
}
