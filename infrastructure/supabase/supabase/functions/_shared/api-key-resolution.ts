/**
 * API Key Resolution — workaround for the Supabase auto-inject bug
 *
 * Problem
 * -------
 * After migrating from the legacy JWT-based anon/service_role keys to the
 * new `sb_publishable_*` / `sb_secret_*` keys (and especially after disabling
 * legacy keys at the project level), the Edge Function runtime continues to
 * auto-inject `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` env vars
 * with the LEGACY JWT values. Calls made with those env values are then
 * rejected at the API gateway with "Legacy API keys are disabled".
 *
 * See: https://github.com/supabase/supabase/issues/37648
 *
 * Workarounds applied here
 * ------------------------
 * 1. ANON KEY (`resolveAnonKey`):
 *    Use the `apikey` header from the inbound request. The calling client
 *    (frontend) sends the current publishable key in `apikey:`, so we trust
 *    that authoritative value rather than the env var. Falls back to the
 *    env var when no header is present (e.g. server-to-server calls).
 *
 * 2. SERVICE ROLE KEY (`resolveServiceRoleKey`):
 *    Read from a CUSTOM-NAMED env var `APP_SECRET_KEY` populated explicitly:
 *
 *      supabase secrets set APP_SECRET_KEY=sb_secret_xxx --project-ref ...
 *
 *    The `SUPABASE_` prefix is reserved by the platform and cannot be
 *    overridden, which is why we use a non-prefixed name. Falls back to the
 *    auto-injected `SUPABASE_SERVICE_ROLE_KEY` if `APP_SECRET_KEY` is unset
 *    (useful for local `supabase start` dev where the auto-inject is
 *    legitimate, not buggy).
 *
 * Both functions are pure and trivially testable.
 */

import type { EdgeFunctionEnv } from './env-schema.ts';

/**
 * Resolve the anon (publishable) key for creating per-user Supabase clients.
 *
 * Precedence:
 *   1. `req.headers.get('apikey')` — authoritative, sent by the calling client
 *   2. `env.SUPABASE_ANON_KEY` — fallback (auto-injected; may be legacy)
 *
 * Always returns a non-empty string when the env was validated through Zod
 * (which requires `SUPABASE_ANON_KEY`).
 */
export function resolveAnonKey(req: Request, env: EdgeFunctionEnv): string {
  const fromHeader = req.headers.get('apikey');
  if (fromHeader && fromHeader.length > 0) {
    return fromHeader;
  }
  return env.SUPABASE_ANON_KEY;
}

/**
 * Resolve the service-role (secret) key for admin Supabase clients.
 *
 * Precedence:
 *   1. `env.APP_SECRET_KEY` — explicit, not subject to auto-inject
 *   2. `env.SUPABASE_SERVICE_ROLE_KEY` — fallback (auto-injected; may be legacy)
 *
 * Returns `undefined` if neither is set. Admin functions MUST gate on
 * `validateAdminFunctionEnv(env, ...)` before calling this; the helper
 * itself does not throw to keep its semantics straightforward.
 */
export function resolveServiceRoleKey(env: EdgeFunctionEnv): string | undefined {
  return env.APP_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;
}
