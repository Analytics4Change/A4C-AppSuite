# Implementation Plan: Subdomain Redirect for Subsequent Logins

## Executive Summary

Fix the subdomain redirect functionality that breaks on subsequent logins. Currently, users are correctly redirected to their organization's subdomain (e.g., `poc-test2-20251218.firstovertheline.com`) on their first login after invitation acceptance, but subsequent logins redirect them back to `a4c.firstovertheline.com/clients` instead.

The root cause is that the frontend uses a **direct table query** to `organizations_projection` which is subject to RLS. The existing `api.get_organization_by_id` RPC function has `SECURITY DEFINER` which bypasses RLS - we just need to use it.

## Solution: Use Existing RPC Function

**Key insight**: The existing `api.get_organization_by_id(p_org_id)` function:
1. Is `SECURITY DEFINER` (runs as owner - postgres superuser)
2. Already returns `subdomain_status` (added in Phase 9 of previous fix)
3. Bypasses RLS because superuser has BYPASSRLS privilege

**No new SQL files needed!**

## Phase 1: Update Frontend Service (Single File Change)

### 1.1 Modify getOrganizationSubdomainInfo
- Update `frontend/src/services/organization/getOrganizationSubdomainInfo.ts`
- Change from direct table query to RPC call
- Use `.schema('api').rpc('get_organization_by_id', { p_org_id: orgId })`

## Phase 2: Deployment and Validation

### 2.1 Deploy Changes
- Commit and push changes
- Deploy frontend via GitHub Actions

### 2.2 End-to-End Testing
- Test with fresh private browser window
- Test with returning user (existing session)
- Verify subdomain redirect works on subsequent logins

## Files to Modify

1. **MODIFY**: `frontend/src/services/organization/getOrganizationSubdomainInfo.ts`

## Success Metrics

### Immediate
- [ ] Frontend service updated to use RPC
- [ ] No TypeScript errors

### Medium-Term
- [ ] Fresh login in private window redirects to subdomain
- [ ] Subsequent logins redirect to subdomain
- [ ] User without org_id falls back gracefully

### Long-Term
- [ ] No reported issues with subdomain redirect
- [ ] Consistent behavior across all auth flows (email/password and OAuth)

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Breaking existing functionality | Minimal change - single file, uses existing RPC |
| Security | SECURITY DEFINER + superuser is standard pattern |

## Next Steps After Completion

1. Monitor for any redirect issues in production
2. Update archived subdomain-redirect-fix docs with this follow-on fix
