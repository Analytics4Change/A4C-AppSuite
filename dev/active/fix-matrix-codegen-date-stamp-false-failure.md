---
status: seed
last_updated: 2026-07-30
---

# Seed: stop the reachability-matrix codegen stamping a date that fails CI

**Origin**: predicted by `software-architect-dbc` on PR #103 (finding F8, INFO —
*"Merge today, or expect to re-stamp"*). **Recurred on PR #106**, which is the
signal to fix it rather than re-stamp a third time.

**Priority**: Medium. Trivial fix; produces a red CI check that means nothing,
which is corrosive — an unexplained red gate is how the two-month `deno lint`
failure survived.

## Problem

`frontend/scripts/gen-rpc-reachability-matrix.cjs:305-308`:

```js
function updateFrontmatterLastUpdated(doc) {
  const today = new Date().toISOString().slice(0, 10);
  return doc.replace(/^last_updated:\s*\S+$/m, `last_updated: ${today}`);
}
```

It stamps **today's UTC date unconditionally**, and `main()` (`:353`) applies it on
every run regardless of whether any generated section changed.
`.github/workflows/rpc-reachability-matrix-sync.yml` then regenerates and
`git diff --exit-code`s the result.

So the check is **time-dependent, not content-dependent**. Any migration-touching
PR whose CI runs on a later UTC day than its last matrix commit goes red with a
one-line diff that has nothing to do with the change:

```
-last_updated: 2026-07-29
+last_updated: 2026-07-30
```

Observed on PR #106 (`run 30511163992`), and predicted on PR #103. Crossing
midnight UTC mid-review is enough to trigger it — as is any re-run, rebase, or
merge-queue execution the next day.

## Proposed

Only stamp the date when the generated content actually changed:

```js
const original = fs.readFileSync(MATRIX_DOC, 'utf8');
let doc = original;
doc = replaceSection(doc, 'PER-BUCKET-COUNTS', …);
doc = replaceSection(doc, 'PER-RPC-TABLE', …);
doc = replaceSection(doc, 'PHASE-3-TARGETS', …);
doc = replaceSection(doc, 'PHASE-4-TARGETS', …);

// Time-dependent stamping makes the CI diff-check fail for PRs that merely span
// a UTC midnight. Only bump when the generated sections actually moved.
if (doc !== original) {
  doc = updateFrontmatterLastUpdated(doc);
}

fs.writeFileSync(MATRIX_DOC, doc, 'utf8');
```

Three lines. Preserves the intent (the stamp records when the matrix last changed)
while making the check depend on content.

## Check the sibling before assuming it is fine

`frontend/scripts/gen-rpc-registry.cjs` feeds `rpc-registry-sync.yml`, which uses
the same regenerate-and-diff shape. It did **not** fail on PR #106, so it probably
does not stamp a date — but confirm rather than assume, and apply the same fix if
it does.

## Verification

- Run the codegen twice on an unchanged schema; the second run must produce **no**
  git diff (today it produces one the moment the date rolls over).
- Run it after an actual tag change; the date **must** bump.
- The `rpc-reachability-matrix-sync` check passes on a PR whose matrix commit is
  dated earlier than the CI run.

## Why it matters more than it looks

This check exists to catch real drift between `@a4c-bucket` comment tags and the
doc. A gate that also fails for calendar reasons trains people to re-stamp on
reflex and stop reading it — and the tags are *already* known-stale for two RPCs
(`dev/active/retag-email-lookup-rpcs-bucket-a.md`), which is exactly the kind of
thing this check should be surfacing rather than burying under date noise.

## Related

- `frontend/scripts/gen-rpc-reachability-matrix.cjs` — the stamping function
- `.github/workflows/rpc-reachability-matrix-sync.yml` — the regenerate-and-diff check
- PR #103 F8 (predicted), PR #106 (recurred)
- `dev/active/retag-email-lookup-rpcs-bucket-a.md` — the real drift this gate should be guarding
