#!/usr/bin/env node

/**
 * RPC Reachability Matrix Codegen (Phase 1 step 12 of
 * cross-tenant-access-grant-rollout).
 *
 * Reads `@a4c-bucket`, `@a4c-consultant-callable`,
 * `@a4c-consultant-callable-reason`, `@a4c-phase-target` tags from
 * `COMMENT ON FUNCTION` on every `api.*` function and emits the per-RPC
 * portion of the reachability matrix doc inside marker-comment boundaries.
 * Prose outside the markers is preserved across regenerations.
 *
 * Output (in-place edit): documentation/architecture/authorization/
 *                         cross-tenant-access-grant-rpc-reachability-matrix.md
 *
 * Five regenerated sections (each delimited by paired GENERATED: markers):
 *   1. PER-BUCKET-COUNTS  — the per-bucket counts table
 *   2. PER-RPC-TABLE      — the full 170-row per-RPC inventory table
 *   3. PHASE-3-TARGETS    — Phase 3 refactor target list (A + A-variant)
 *   4. PHASE-4-TARGETS    — Phase 4 RLS audit target list (D + D-variant)
 *   5. LAST-UPDATED       — frontmatter `last_updated` field timestamp
 *
 * Connection strategy:
 *   - $SUPABASE_DB_URL if set
 *   - else local container default postgresql://postgres:postgres@127.0.0.1:54322/postgres
 *   - shells out to `psql` (system binary; matches gen-rpc-registry.cjs precedent)
 *
 * Failure modes (exit non-zero):
 *   - psql connection fails
 *   - any api.* function lacks one of the four required @a4c-* tags
 *   - matrix doc lacks the expected marker comments (operator must seed them)
 *
 * See:
 *   - documentation/architecture/decisions/adr-cross-tenant-access-grant-jwt-shape.md
 *     § Phase 1 manifest step 12
 *   - infrastructure/supabase/supabase/migrations/<phase-1-migration>.sql
 *     § Step 11 (the backfill that populates the tags this script reads)
 *   - frontend/scripts/gen-rpc-registry.cjs (M3 precedent — sibling codegen)
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const MATRIX_DOC = path.resolve(
  __dirname,
  '..',
  '..',
  'documentation',
  'architecture',
  'authorization',
  'cross-tenant-access-grant-rpc-reachability-matrix.md'
);

const DB_URL =
  process.env.SUPABASE_DB_URL ||
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const FIELD_SEP = '<<<A4C_FIELD>>>';

const QUERY = `
  SELECT
    p.proname AS name,
    pg_get_function_identity_arguments(p.oid) AS args,
    pg_get_function_result(p.oid) AS returns,
    COALESCE(d.description, '') AS description
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
  const cmd =
    `psql "${DB_URL}" -A -t -F'${FIELD_SEP}' -X -v ON_ERROR_STOP=1 -c "${QUERY.replace(/\n/g, ' ')}"`;
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
      const [name, args, returns, description] = line.split(FIELD_SEP);
      return {
        name,
        args: args || '',
        returns: returns || '',
        description: description || '',
      };
    });
}

function parseTag(description, tagName) {
  const re = new RegExp(`@a4c-${tagName}:\\s*([^\\n]+?)(?=\\n|$)`);
  const m = description.match(re);
  return m ? m[1].trim() : null;
}

function classify(rows) {
  const classified = [];
  const untagged = [];
  const conflicts = [];

  // Dedup by proname — overloads share the same logical tags (Step 11
  // applies the same COMMENT to all overloads of a given proname). However,
  // a future migration could DROP+CREATE one overload and leave the others
  // tagged differently, OR a developer could manually retag only one
  // overload via direct COMMENT ON FUNCTION. F1 fold-in 2026-06-02 architect
  // review: explicitly detect cross-overload tag disagreement (mirrors M3
  // gen-rpc-registry.cjs:118-119,127-132). Silent first-wins dedup masks the
  // inconsistency and produces a matrix that doesn't reflect reality.
  const byName = new Map(); // proname → { bucket, callable, phaseTarget }

  for (const row of rows) {
    const bucket = parseTag(row.description, 'bucket');
    const callable = parseTag(row.description, 'consultant-callable');
    const reason = parseTag(row.description, 'consultant-callable-reason');
    const phaseTarget = parseTag(row.description, 'phase-target');

    if (!bucket || !callable || !phaseTarget) {
      untagged.push({
        name: row.name,
        args: row.args,
        missing: [
          !bucket && '@a4c-bucket',
          !callable && '@a4c-consultant-callable',
          !phaseTarget && '@a4c-phase-target',
        ].filter(Boolean),
      });
      continue;
    }

    // Conflict detection across overloads of the same proname.
    if (byName.has(row.name)) {
      const prior = byName.get(row.name);
      if (
        prior.bucket !== bucket ||
        prior.callable !== callable ||
        prior.phaseTarget !== phaseTarget
      ) {
        conflicts.push({
          name: row.name,
          args: row.args,
          prior: {
            bucket: prior.bucket,
            callable: prior.callable,
            phaseTarget: prior.phaseTarget,
          },
          current: { bucket, callable, phaseTarget },
        });
      }
      // First-wins for the classified output; conflict array surfaces the
      // disagreement so main() can fail before writing.
      continue;
    }
    byName.set(row.name, { bucket, callable, phaseTarget });

    classified.push({
      name: row.name,
      args: row.args,
      returns: row.returns,
      bucket,
      callable,
      reason: reason || '',
      phaseTarget,
    });
  }

  return { classified, untagged, conflicts };
}

function emitPerBucketCounts(classified) {
  const counts = new Map();
  for (const row of classified) {
    counts.set(row.bucket, (counts.get(row.bucket) || 0) + 1);
  }

  const bucketOrder = [
    'A',
    'A-variant',
    'B',
    'C',
    'C-legacy',
    'D',
    'D-variant',
    'E',
    'E-variant',
  ];

  const lines = [
    '| Bucket | Count |',
    '|---|---:|',
  ];

  let total = 0;
  for (const b of bucketOrder) {
    if (!counts.has(b)) continue;
    const n = counts.get(b);
    total += n;
    lines.push(`| ${b} | ${n} |`);
  }
  lines.push(`| **Total** | **${total}** |`);

  return lines.join('\n');
}

function emitPerRpcTable(classified) {
  const sorted = [...classified].sort((a, b) => a.name.localeCompare(b.name));
  const lines = [
    '| `api.<name>` | bucket | consultant-callable | phase-target | reason |',
    '|---|---|---|---|---|',
  ];
  for (const row of sorted) {
    const reason = (row.reason || '').replace(/\|/g, '\\|');
    lines.push(
      `| \`${row.name}\` | ${row.bucket} | ${row.callable} | ${row.phaseTarget} | ${reason} |`
    );
  }
  return lines.join('\n');
}

function emitPhase3Targets(classified) {
  const targets = classified.filter(
    (r) => r.bucket === 'A' || r.bucket === 'A-variant'
  );
  if (targets.length === 0) {
    return '_No Phase 3 refactor targets (Bucket A + A-variant are empty)._';
  }
  const lines = [
    '| `api.<name>` | Bucket | Reason |',
    '|---|---|---|',
  ];
  for (const r of targets.sort((a, b) => a.name.localeCompare(b.name))) {
    const reason = (r.reason || '').replace(/\|/g, '\\|');
    lines.push(`| \`${r.name}\` | ${r.bucket} | ${reason} |`);
  }
  return lines.join('\n');
}

function emitPhase4Targets(classified) {
  const targets = classified.filter(
    (r) => r.bucket === 'D' || r.bucket === 'D-variant'
  );
  if (targets.length === 0) {
    return '_No Phase 4 RLS audit targets (Bucket D + D-variant are empty)._';
  }
  const lines = [
    '| `api.<name>` | Bucket | Reason |',
    '|---|---|---|',
  ];
  for (const r of targets.sort((a, b) => a.name.localeCompare(b.name))) {
    const reason = (r.reason || '').replace(/\|/g, '\\|');
    lines.push(`| \`${r.name}\` | ${r.bucket} | ${reason} |`);
  }
  return lines.join('\n');
}

function replaceSection(doc, sectionId, newContent) {
  const startMarker = `<!-- GENERATED:${sectionId}:START -->`;
  const endMarker = `<!-- GENERATED:${sectionId}:END -->`;
  const startIdx = doc.indexOf(startMarker);
  const endIdx = doc.indexOf(endMarker);

  if (startIdx === -1 || endIdx === -1) {
    fail(
      `Matrix doc missing required marker comments for section ${sectionId}.\n` +
        `Expected: ${startMarker} ... ${endMarker}\n` +
        `Operator must seed the markers in the matrix doc before running this script.`
    );
  }

  const before = doc.slice(0, startIdx + startMarker.length);
  const after = doc.slice(endIdx);
  return `${before}\n${newContent}\n${after}`;
}

function updateFrontmatterLastUpdated(doc) {
  const today = new Date().toISOString().slice(0, 10);
  return doc.replace(/^last_updated:\s*\S+$/m, `last_updated: ${today}`);
}

function main() {
  info(`Querying ${DB_URL}`);
  const rows = runQuery();
  if (rows.length === 0) fail('No api.* functions returned by query');
  info(`Found ${rows.length} api.* function rows (incl. overloads)`);

  const { classified, untagged, conflicts } = classify(rows);

  if (conflicts.length > 0) {
    console.error('❌ Overload tag disagreement detected (F1 fold-in 2026-06-02):');
    for (const c of conflicts) {
      console.error(`   - api.${c.name}(${c.args}):`);
      console.error(`       prior overload tagged   bucket=${c.prior.bucket}, callable=${c.prior.callable}, phase-target=${c.prior.phaseTarget}`);
      console.error(`       current overload tagged bucket=${c.current.bucket}, callable=${c.current.callable}, phase-target=${c.current.phaseTarget}`);
    }
    console.error('   Each api.* function name must carry consistent @a4c-bucket/@a4c-consultant-callable/@a4c-phase-target across all signatures.');
    console.error('   Re-run Step 11 backfill OR manually align via COMMENT ON FUNCTION on each signature.');
    fail(`${conflicts.length} overload conflict(s)`);
  }

  if (untagged.length > 0) {
    console.error('❌ Untagged api.* functions found:');
    for (const u of untagged.sort((a, b) => a.name.localeCompare(b.name))) {
      console.error(
        `   - api.${u.name}(${u.args}) — missing: ${u.missing.join(', ')}`
      );
    }
    console.error(
      "   Add `COMMENT ON FUNCTION api.<name>(<args>) IS '... @a4c-bucket: ... @a4c-consultant-callable: ... @a4c-phase-target: ...';` in the next migration."
    );
    fail(`${untagged.length} untagged function(s)`);
  }

  if (!fs.existsSync(MATRIX_DOC)) {
    fail(`Matrix doc not found at ${MATRIX_DOC}`);
  }

  let doc = fs.readFileSync(MATRIX_DOC, 'utf8');

  doc = replaceSection(doc, 'PER-BUCKET-COUNTS', emitPerBucketCounts(classified));
  doc = replaceSection(doc, 'PER-RPC-TABLE', emitPerRpcTable(classified));
  doc = replaceSection(doc, 'PHASE-3-TARGETS', emitPhase3Targets(classified));
  doc = replaceSection(doc, 'PHASE-4-TARGETS', emitPhase4Targets(classified));
  doc = updateFrontmatterLastUpdated(doc);

  fs.writeFileSync(MATRIX_DOC, doc, 'utf8');
  success(
    `Updated ${MATRIX_DOC}\n   ${classified.length} api.* RPCs tagged across 4 sections`
  );
}

module.exports = {
  parseTag,
  classify,
  emitPerBucketCounts,
  emitPerRpcTable,
  emitPhase3Targets,
  emitPhase4Targets,
  replaceSection,
};

if (require.main === module) {
  main();
}
