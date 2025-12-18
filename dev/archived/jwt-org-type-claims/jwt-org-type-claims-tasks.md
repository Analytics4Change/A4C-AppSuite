# Tasks: Add org_type to JWT Claims

## Phase 1: Backend JWT Hook Update ✅ COMPLETE

- [x] Read current `003-supabase-auth-jwt-hook.sql` to understand structure
- [x] Add `v_org_type text;` variable declaration
- [x] Add org_type lookup with super_admin handling:
  ```sql
  -- Get organization type for UI feature gating
  -- Super admins (NULL org_id) default to 'platform_owner' for consistency
  IF v_org_id IS NULL THEN
    v_org_type := 'platform_owner';
  ELSE
    SELECT o.type::text INTO v_org_type
    FROM public.organizations_projection o
    WHERE o.id = v_org_id;
  END IF;
  ```
- [x] Add `'org_type', v_org_type` to claims object
- [x] **MUST-DO**: Add `'org_type', NULL` to exception handler fallback claims
- [x] Apply same changes to `CONSOLIDATED_SCHEMA.sql`
- [x] Verify SQL syntax is correct

## Phase 2: Frontend Type Updates ✅ COMPLETE

- [x] Update `frontend/src/types/auth.types.ts`:
  - [x] Add `OrganizationType` type alias: `'platform_owner' | 'provider' | 'provider_partner'`
  - [x] Add org_type as **required**:
    ```typescript
    org_type: OrganizationType;
    ```
- [x] Update `frontend/src/config/dev-auth.config.ts`:
  - [x] Add `org_type: 'platform_owner'` to super_admin profile
  - [x] Add `org_type: 'provider'` to provider_admin profile
  - [x] Add `org_type: 'provider_partner'` to partner_admin profile (architect recommendation)
  - [x] Add appropriate org_type to other profiles
- [x] Update `frontend/src/services/auth/SupabaseAuthProvider.ts`:
  - [x] Add `org_type` to JWT decoding

## Phase 3: Navigation Filter Implementation ✅ COMPLETE

- [x] Update `frontend/src/components/layouts/MainLayout.tsx`:
  - [x] Create `NavItem` interface with `hideForOrgTypes?: OrganizationType[]`
  - [x] Add `hideForOrgTypes: ['platform_owner']` to Organization Units nav item
  - [x] Add filter logic: skip if `claims.org_type` in `hideForOrgTypes`
  - [x] Add debug logging for org_type filtering

## Phase 4: Testing & Validation ✅ COMPLETE

- [x] Run TypeScript check: `npm run typecheck` - PASSED
- [x] Run linter: `npm run lint` - Pre-existing issues only
- [x] Build succeeds: `npm run build` - PASSED

## Success Validation Checkpoints

### Immediate Validation ✅
- [x] TypeScript compiles without errors
- [x] All mock profiles have org_type defined
- [x] Build succeeds

### Feature Complete Validation (Manual Testing Required)
- [ ] Platform owner user does NOT see "Org Units" in navigation
- [ ] Provider admin user DOES see "Org Units" in navigation
- [ ] Nav filtering debug logs show org_type check
- [ ] JWT in integration mode contains org_type claim

## Current Status

**Phase**: Complete
**Status**: ✅ IMPLEMENTED
**Last Updated**: 2025-12-18
**Next Step**: Manual testing in mock mode with different profiles

## Files Modified

| File | Change |
|------|--------|
| `infrastructure/supabase/sql/03-functions/authorization/003-supabase-auth-jwt-hook.sql` | Added org_type to claims ✅ |
| `infrastructure/supabase/CONSOLIDATED_SCHEMA.sql` | Same as above ✅ |
| `frontend/src/types/auth.types.ts` | Added OrganizationType and org_type to JWTClaims ✅ |
| `frontend/src/config/dev-auth.config.ts` | Added org_type to all profiles ✅ |
| `frontend/src/components/layouts/MainLayout.tsx` | Added hideForOrgTypes filter ✅ |
| `frontend/src/services/auth/SupabaseAuthProvider.ts` | Added org_type to JWT decoding ✅ |

## Notes

- Added `partner_admin` mock profile with `org_type: 'provider_partner'` as recommended by architect
- Default `org_type` in SupabaseAuthProvider fallback is `'provider'` (most common case)
- Super admins with NULL org_id default to `'platform_owner'`
