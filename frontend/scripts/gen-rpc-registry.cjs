#!/usr/bin/env node

/**
 * RPC Shape Registry Codegen (M3)
 *
 * Reads `@a4c-rpc-shape: envelope|read` tags from `COMMENT ON FUNCTION` on
 * every `api.*` function and emits a TypeScript registry file consumed by
 * the typed helpers `apiRpcEnvelope<T>` and `apiRpc<T>` to enforce
 * shape-correct helper choice at compile time.
 *
 * Output: `frontend/src/services/api/rpc-registry.generated.ts`
 *   Three union types:
 *     EnvelopeRpcs    — call via supabaseService.apiRpcEnvelope<T>
 *     ReadRpcs        — call via supabaseService.apiRpc<T>
 *     UncategorizedRpcs — should be `never` at all times in `main`; CI
 *                         registry-sync workflow fails when non-empty.
 *
 * Connection strategy:
 *   - $SUPABASE_DB_URL if set
 *   - else local container default postgresql://postgres:postgres@127.0.0.1:54322/postgres
 *   - shells out to `psql` (system binary; no extra deps needed)
 *
 * Failure modes (exit non-zero):
 *   - psql connection fails
 *   - any api.* function lacks an @a4c-rpc-shape tag (UncategorizedRpcs would not be `never`)
 *   - two overloads of the same proname disagree on shape (per architect NT-1)
 *
 * See:
 *   - documentation/architecture/decisions/adr-rpc-readback-pattern.md
 *     §"Type-level enforcement (M3)"
 *   - .claude/skills/infrastructure-guidelines/SKILL.md (shape-comment rule)
 *   - .claude/skills/frontend-dev-guidelines/SKILL.md Rule 11
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const OUTPUT = path.resolve(
  __dirname,
  '..',
  'src',
  'services',
  'api',
  'rpc-registry.generated.ts'
);

const DB_URL =
  process.env.SUPABASE_DB_URL ||
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const QUERY = `
  SELECT
    p.proname AS name,
    pg_get_function_identity_arguments(p.oid) AS args,
    COALESCE(
      (regexp_matches(d.description, '@a4c-rpc-shape:\\s*(envelope|read)'))[1],
      ''
    ) AS shape
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  LEFT JOIN pg_description d ON d.objoid = p.oid AND d.objsubid = 0
  WHERE n.nspname = 'api'
    AND p.prokind = 'f'
  ORDER BY p.proname, args
`;

function fail(msg) {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

function info(msg) {
  console.log(`ℹ️  ${msg}`);
}

function success(msg) {
  console.log(`✅ ${msg}`);
}

function runQuery() {
  // -A unaligned, -t tuples only, -F separator, -X no psqlrc, -v ON_ERROR_STOP
  const cmd =
    `psql "${DB_URL}" -A -t -F'\\t' -X -v ON_ERROR_STOP=1 -c "${QUERY.replace(/\n/g, ' ')}"`;
  let output;
  try {
    output = execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    fail(`psql query failed: ${e.message || e}\nDB_URL: ${DB_URL}`);
  }
  return output
    .trim()
    .split('\n')
    .filter((l) => l.length > 0)
    .map((line) => {
      const [name, args, shape] = line.split('\t');
      return { name, args: args || '', shape: shape || '' };
    });
}

function classify(rows) {
  const envelope = new Set();
  const read = new Set();
  const uncategorized = new Set();
  const byName = new Map(); // proname → first-seen shape (for overload-disagreement check)
  const conflicts = [];

  for (const { name, args, shape } of rows) {
    if (shape === 'envelope') envelope.add(name);
    else if (shape === 'read') read.add(name);
    else uncategorized.add(`${name}(${args})`);

    if (shape) {
      if (byName.has(name) && byName.get(name) !== shape) {
        conflicts.push({ name, shapes: [byName.get(name), shape], args });
      } else {
        byName.set(name, shape);
      }
    }
  }
  return { envelope, read, uncategorized, conflicts };
}

function emitUnion(name, set) {
  if (set.size === 0) return `export type ${name} = never;`;
  const sorted = [...set].sort();
  return `export type ${name} =\n  | ${sorted.map((s) => `'${s}'`).join('\n  | ')};`;
}

function main() {
  info(`Querying ${DB_URL}`);
  const rows = runQuery();
  if (rows.length === 0) fail('No api.* functions returned by query');
  info(`Found ${rows.length} api.* function rows (incl. overloads)`);

  const { envelope, read, uncategorized, conflicts } = classify(rows);

  if (conflicts.length > 0) {
    console.error('❌ Overload-shape disagreement detected (NT-1):');
    for (const c of conflicts) {
      console.error(`   - api.${c.name}(${c.args}) declared shape ${c.shapes[1]} but earlier overload was ${c.shapes[0]}`);
    }
    console.error('   Each function name must have a single shape across overloads.');
    fail(`${conflicts.length} overload conflict(s)`);
  }

  if (uncategorized.size > 0) {
    console.error('❌ Untagged RPCs found (UncategorizedRpcs would be non-empty):');
    for (const u of [...uncategorized].sort()) console.error(`   - api.${u}`);
    console.error("   Add `COMMENT ON FUNCTION api.<name>(<args>) IS '...\\n\\n@a4c-rpc-shape: envelope|read';` to the next migration.");
    fail(`${uncategorized.size} untagged function(s)`);
  }

  const header = `// AUTOGENERATED by frontend/scripts/gen-rpc-registry.cjs. Do not edit.
// Source of truth: \`COMMENT ON FUNCTION api.<name> IS '... @a4c-rpc-shape: envelope|read';\`
//
// Run \`npm run gen:rpc-registry\` after applying any migration that adds, drops,
// or retags an api.* RPC. CI workflow .github/workflows/rpc-registry-sync.yml
// asserts this file is in sync with the database state.
//
// Helpers \`apiRpcEnvelope<T>\` and \`apiRpc<T>\` narrow on these unions to make
// wrong-helper-for-shape a compile-time error.
//
// ADR: documentation/architecture/decisions/adr-rpc-readback-pattern.md
//      §"Type-level enforcement (M3)"

`;

  const body = [
    emitUnion('EnvelopeRpcs', envelope),
    '',
    emitUnion('ReadRpcs', read),
    '',
    '/**',
    ' * Should always be `never` in main. CI registry-sync gate fails',
    ' * the build when non-empty (untagged RPCs detected at codegen time).',
    ' */',
    'export type UncategorizedRpcs = never;',
    '',
  ].join('\n');

  fs.writeFileSync(OUTPUT, header + body, 'utf8');
  success(
    `Wrote ${OUTPUT}\n   ${envelope.size} envelope, ${read.size} read, 0 uncategorized`
  );
}

main();
