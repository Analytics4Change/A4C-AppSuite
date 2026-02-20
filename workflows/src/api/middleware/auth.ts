/**
 * Authentication Middleware
 *
 * Validates JWT tokens and checks permissions using Supabase Auth
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Validate required environment variables
function getRequiredEnvVar(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// These will throw on module load if env vars are missing
const supabaseUrl = getRequiredEnvVar('SUPABASE_URL');
const supabaseAnonKey = getRequiredEnvVar('SUPABASE_ANON_KEY');

interface EffectivePermission {
  p: string;  // Permission name
  s: string;  // Scope path (ltree)
}

interface JWTPayload {
  sub?: string;
  email?: string;
  org_id?: string;
  org_type?: string;
  effective_permissions?: EffectivePermission[];
  access_blocked?: boolean;
  claims_version?: number;
  current_org_unit_id?: string | null;
  current_org_unit_path?: string | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: {
      id: string;
      email: string;
      permissions: string[];
      org_id?: string;
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

    const payloadPart = parts[1];
    if (!payloadPart) return null;

    const decoded = Buffer.from(payloadPart, 'base64').toString('utf-8');
    const payload: unknown = JSON.parse(decoded);

    // Validate it's an object
    if (typeof payload !== 'object' || payload === null) {
      return null;
    }

    return payload as JWTPayload;
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

  // Block deactivated users before making any network calls
  if (jwtPayload.access_blocked) {
    return reply.code(403).send({
      error: 'Forbidden',
      message: 'Account access is blocked'
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

  // Map v4 effective_permissions to flat permission names.
  // Scope (ep.s) is intentionally dropped — the only permission checked
  // on this API (organization.create_root) is a platform-level privilege with
  // root scope, making scope filtering a no-op. This matches the SQL
  // has_permission() function which also checks permission name only.
  request.user = {
    id: user.id,
    email: user.email!,
    permissions: (jwtPayload.effective_permissions ?? []).map(ep => ep.p),
    org_id: jwtPayload.org_id,
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
