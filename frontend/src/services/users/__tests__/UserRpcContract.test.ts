/**
 * UserRpcContract — anti-drift structural tests for user-domain RPCs
 *
 * Parses the applied migration SQL files on disk and asserts that each
 * Pattern A v2 user RPC's success-envelope `jsonb_build_object(...)` contains
 * expected keys. Structurally prevents the PR #31 drift class where service
 * call-sites quietly get new RPC params or drop return keys without test
 * updates.
 *
 * Targets:
 *   - `api.update_user_phone` — keys: success, phoneId, eventId, phone
 *     (baseline_v4 L6585 — predates this PR)
 *   - `api.add_user_phone` — keys: success, phoneId, eventId, phone
 *     (migration 20260423232531_add_user_phone_pattern_a_v2_readback.sql —
 *      introduced in this PR, Blocker 3 PR A)
 *   - `api.update_user` — keys: success, event_id, user
 *     (baseline_v4 — predates this PR)
 *
 * Note on mechanism: these tests parse the latest migration file containing
 * each function definition (by scanning migrations in chronological order,
 * the last CREATE OR REPLACE wins). For RPCs whose final form lives in the
 * baseline file, the baseline is authoritative.
 *
 * See also: `adr-rpc-readback-pattern.md` Pattern A v2 contract.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(
  __dirname,
  '../../../../../infrastructure/supabase/supabase/migrations'
);

/**
 * Read all migration SQL files in chronological (filename) order and return
 * concatenated SQL text.
 */
function readAllMigrationsSQL(): string {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  return files.map((f) => readFileSync(join(MIGRATIONS_DIR, f), 'utf-8')).join('\n');
}

/**
 * Extract the body of the LAST `CREATE OR REPLACE FUNCTION api.<name>(`
 * definition from the given SQL. Assumes `CREATE OR REPLACE FUNCTION` blocks
 * are terminated by `$$;` on its own line (project convention).
 */
function extractLastFunctionBody(sql: string, qualifiedName: string): string | null {
  // Match `CREATE OR REPLACE FUNCTION api.name(` or `"api"."name"(`
  const escaped = qualifiedName.replace('.', '"?\\."?');
  const pattern = new RegExp(
    `CREATE OR REPLACE FUNCTION "?${escaped}"?\\([\\s\\S]*?^\\$\\$;$`,
    'gm'
  );
  const matches = sql.match(pattern);
  return matches && matches.length > 0 ? matches[matches.length - 1] : null;
}

describe('User RPC contract assertions (anti-drift)', () => {
  const sql = readAllMigrationsSQL();

  describe('api.update_user_phone', () => {
    const body = extractLastFunctionBody(sql, 'api.update_user_phone');

    it('function definition is found in migrations', () => {
      expect(body).not.toBeNull();
    });

    it('success envelope contains {success, phoneId, eventId, phone}', () => {
      expect(body).toContain("'success', true");
      expect(body).toContain("'phoneId'");
      expect(body).toContain("'eventId'");
      expect(body).toContain("'phone'");
    });

    it('returns row_to_json(v_row) for the phone read-back', () => {
      expect(body).toMatch(/row_to_json\(v_row\)::jsonb/);
    });
  });

  describe('api.add_user_phone', () => {
    const body = extractLastFunctionBody(sql, 'api.add_user_phone');

    it('function definition is found in migrations', () => {
      expect(body).not.toBeNull();
    });

    it('success envelope contains {success, phoneId, eventId, phone}', () => {
      expect(body).toContain("'success'");
      expect(body).toContain("'phoneId'");
      expect(body).toContain("'eventId'");
      expect(body).toContain("'phone'");
    });

    it('branches on p_org_id to read from the correct projection (Blocker 3 architect MUST-FIX)', () => {
      expect(body).toContain('IF p_org_id IS NULL');
      expect(body).toMatch(/FROM user_phones\b/);
      expect(body).toMatch(/FROM user_org_phone_overrides\b/);
    });

    it('uses camelCase keys via jsonb_build_object (not row_to_json)', () => {
      // The v2 migration for add_user_phone uses explicit jsonb_build_object
      // with camelCase keys rather than row_to_json to match the frontend
      // UserPhone type directly. This is load-bearing for the no-adapter
      // VM patch convention.
      expect(body).toContain("'countryCode'");
      expect(body).toContain("'isPrimary'");
      expect(body).toContain("'smsCapable'");
      expect(body).toContain("'isActive'");
    });

    it('Pattern A v2 guards — IF NOT FOUND path surfaces processing_error', () => {
      expect(body).toContain('IF v_phone IS NULL');
      expect(body).toMatch(
        /SELECT processing_error INTO v_processing_error\s+FROM domain_events WHERE id = v_event_id/
      );
    });
  });

  describe('api.update_user', () => {
    const body = extractLastFunctionBody(sql, 'api.update_user');

    it('function definition is found in migrations', () => {
      expect(body).not.toBeNull();
    });

    it('success envelope contains {success, event_id, user}', () => {
      expect(body).toContain("'success', true");
      expect(body).toContain("'event_id'");
      expect(body).toContain("'user'");
    });

    it('reads back from public.users base table', () => {
      // update_user predates the `_projection` convention and writes via
      // a separate handler to `public.users` (baseline_v4).
      expect(body).toMatch(/FROM public\.users WHERE id = p_user_id/);
    });
  });
});
