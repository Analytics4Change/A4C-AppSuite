# Plan — Migrate Services to apiRpcEnvelope + Ship ESLint Rule

## Phases

| Phase | Description |
|-------|-------------|
| 0 | Inventory — grep `frontend/src/services/` for `.schema('api').rpc(`. Categorize each call site as envelope-shaped (write) or read-shape (returns array/scalar/object). Record current return shape of each enclosing service method to confirm the intersection-type contract preserves it. |
| 1 | Migrate one pilot service end-to-end: `SupabaseRoleService`. Smallest envelope-shape variation; serves as the reference for the codemod. Confirm `npm run typecheck` + Vitest pass after. |
| 2 | Migrate the remaining 7 services in priority order: `SupabaseUserCommandService` (highest PHI), `SupabaseClientService` (PHI: addresses/names/DOB), `SupabaseClientFieldService`, `SupabaseScheduleService`, `SupabaseOrganizationCommandService`, `SupabaseOrganizationEntityService`, `SupabaseOrganizationUnitService`. Each migration is isolated; run typecheck after each to catch shape drift early. |
| 3 | Migrate read-shape callers (`SupabaseUserQueryService`, `SupabaseOrganizationQueryService`) from direct `.rpc()` to `supabaseService.apiRpc<T>(...)`. These don't need `apiRpcEnvelope<T>` (no envelope shape) but DO benefit from the wrapper-level `PostgrestError` masking. |
| 4 | Re-enable the ESLint rule in `frontend/eslint.config.js`. Replace the placeholder comment block (committed in PR #43) with the actual `no-restricted-syntax` rule. Add the file-level override that allow-lists `supabase.service.ts` and `envelope.ts`. |
| 5 | Verify `npm run lint` passes with `--max-warnings 0`. Run full typecheck + build. Run all Vitest suites including any service tests. |

## Mechanical pattern (per envelope-shaped call site)

**Before**:
```typescript
const { data, error } = await supabase.schema('api').rpc('update_user', {
  p_user_id: id,
  p_email: email,
});
if (error) {
  log.error('Failed to update user', { error });
  return { success: false, error: error.message };
}
if (!data?.success) {
  return { success: false, error: data?.error || 'Update failed' };
}
return { success: true, user: data.user };
```

**After**:
```typescript
const env = await supabaseService.apiRpcEnvelope<{ user: User; event_id: string }>(
  'update_user',
  { p_user_id: id, p_email: email },
);
if (!env.success) {
  return { success: false, error: env.error };  // env.error already masked
}
return { success: true, user: env.user };  // intersection-type contract: env.user is typed
```

The `import { supabase } from '@/lib/supabase'` import in each service can stay if the file still uses it for non-RPC calls; otherwise drop it.

## Mechanical pattern (per read-shape call site)

**Before**:
```typescript
const { data, error } = await supabase.schema('api').rpc('list_users', {
  p_org_id: claims.org_id,
});
if (error) { /* handle */ }
return data ?? [];
```

**After**:
```typescript
const { data, error } = await supabaseService.apiRpc<UserListItem[]>('list_users', {
  p_org_id: claims.org_id,
});
if (error) {
  // error.message / details / hint already masked
  /* handle */
}
return data ?? [];
```

Caller-side handling is unchanged; the wrapper masks `PostgrestError` fields.

## ESLint rule (Phase 4)

Replace the placeholder in `frontend/eslint.config.js`:

```javascript
// In the main `rules` block:
'no-restricted-syntax': [
  'error',
  {
    selector:
      "CallExpression[callee.type='MemberExpression'][callee.property.name='rpc']" +
      "[callee.object.type='CallExpression'][callee.object.callee.type='MemberExpression']" +
      "[callee.object.callee.property.name='schema']",
    message:
      'Direct .schema("api").rpc(...) calls bypass PII masking. Use ' +
      'supabaseService.apiRpcEnvelope<T>(...) for envelope-shaped writes or ' +
      'supabaseService.apiRpc<T>(...) for read-shaped RPCs.',
  },
],
```

Add a file-level override:
```javascript
{
  files: [
    'src/services/auth/supabase.service.ts',
    'src/services/api/envelope.ts',
  ],
  rules: { 'no-restricted-syntax': 'off' },
},
```

## Open questions

- **Q1**: Some services (`SupabaseOrganizationEntityService`) construct dynamic RPC names (`rpcName` variable). The ESLint rule's AST selector matches the static `.schema('api').rpc(...)` call shape; dynamic-name calls still trip the rule. Decide: refactor to static names, or whitelist via per-line `eslint-disable-next-line` with justification.
- **Q2**: Do any service test files (`*.mapping.test.ts`) mock `supabase.schema('api').rpc(...)` directly? If yes, they'll trip the rule. Decide: add the test files to the allow-list, or migrate the mocks to mock `supabaseService.apiRpcEnvelope<T>`.
- **Q3**: After migration, are there any services that no longer import from `@/lib/supabase`? If yes, remove the unused import to keep files clean.

## Critical files (read-only until Phase 1)

- `frontend/src/services/auth/supabase.service.ts` — helper definitions; SHOULD NOT be modified during this migration.
- `frontend/src/services/api/envelope.ts` — boundary helper; SHOULD NOT be modified during this migration.
- `frontend/src/services/CLAUDE.md` § 3 — usage convention; reference for explaining the migration in code review.
- `frontend/eslint.config.js` — placeholder comment block to replace.
- All 8 services listed in `context.md` § Scope.

## Verification

- `npm run typecheck` passes after each service migration (Phase 1, 2, 3).
- `npm run lint` passes with `--max-warnings 0` after Phase 4. Confirms the ESLint rule fires only on intentional violations (which shouldn't exist).
- `npm run build` passes — no missed type narrowing introduced by the helper's discriminated union.
- Vitest suites for any migrated services pass (existing tests cover envelope handling via mocks).
- Manual smoke check on one envelope-shaped UI flow (e.g., role assignment, user update) — confirm error toasts still display correctly post-migration.
