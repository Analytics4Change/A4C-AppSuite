/**
 * Unit tests for `_shared/api-key-resolution.ts`.
 *
 * Run with: deno test _shared/__tests__/api-key-resolution.test.ts
 */

import { assertEquals } from 'https://deno.land/std@0.220.1/assert/mod.ts';

import { resolveAnonKey, resolveServiceRoleKey } from '../api-key-resolution.ts';
import type { EdgeFunctionEnv } from '../env-schema.ts';

function buildEnv(overrides: Partial<EdgeFunctionEnv> = {}): EdgeFunctionEnv {
  return {
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_ANON_KEY: 'env-anon-fallback',
    SUPABASE_SERVICE_ROLE_KEY: undefined,
    APP_SECRET_KEY: undefined,
    PLATFORM_BASE_DOMAIN: 'test.example.com',
    BACKEND_API_URL: 'https://api.test.example.com',
    FRONTEND_URL: 'https://test.example.com',
    GIT_COMMIT_SHA: undefined,
    RESEND_API_KEY: undefined,
    ...overrides,
  };
}

function reqWithHeaders(headers: Record<string, string>): Request {
  return new Request('https://example.com/test', { headers });
}

// ----- resolveAnonKey ------------------------------------------------------

Deno.test('resolveAnonKey: prefers apikey header when present', () => {
  const req = reqWithHeaders({ apikey: 'sb_publishable_REQUEST_VALUE' });
  const env = buildEnv({ SUPABASE_ANON_KEY: 'env-fallback-should-not-be-used' });
  assertEquals(resolveAnonKey(req, env), 'sb_publishable_REQUEST_VALUE');
});

Deno.test('resolveAnonKey: falls back to env when header absent', () => {
  const req = reqWithHeaders({});
  const env = buildEnv({ SUPABASE_ANON_KEY: 'env-fallback' });
  assertEquals(resolveAnonKey(req, env), 'env-fallback');
});

Deno.test('resolveAnonKey: falls back to env when header is empty string', () => {
  const req = reqWithHeaders({ apikey: '' });
  const env = buildEnv({ SUPABASE_ANON_KEY: 'env-fallback' });
  assertEquals(resolveAnonKey(req, env), 'env-fallback');
});

// ----- resolveServiceRoleKey ----------------------------------------------

Deno.test('resolveServiceRoleKey: prefers APP_SECRET_KEY when set', () => {
  const env = buildEnv({
    APP_SECRET_KEY: 'sb_secret_explicit',
    SUPABASE_SERVICE_ROLE_KEY: 'env-fallback-should-not-be-used',
  });
  assertEquals(resolveServiceRoleKey(env), 'sb_secret_explicit');
});

Deno.test('resolveServiceRoleKey: falls back to SUPABASE_SERVICE_ROLE_KEY when APP_SECRET_KEY unset', () => {
  const env = buildEnv({
    APP_SECRET_KEY: undefined,
    SUPABASE_SERVICE_ROLE_KEY: 'env-fallback',
  });
  assertEquals(resolveServiceRoleKey(env), 'env-fallback');
});

Deno.test('resolveServiceRoleKey: returns undefined when neither set', () => {
  const env = buildEnv({
    APP_SECRET_KEY: undefined,
    SUPABASE_SERVICE_ROLE_KEY: undefined,
  });
  assertEquals(resolveServiceRoleKey(env), undefined);
});
