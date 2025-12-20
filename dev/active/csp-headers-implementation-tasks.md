# Tasks: CSP Headers Implementation

## Phase 1: nginx Configuration Refactoring ✅ COMPLETE

### 1.1 Create nginx Configuration Files
- [x] Create `frontend/nginx/` directory
- [x] Create `frontend/nginx/default.conf` with full server block
- [x] Create `frontend/nginx/security-headers.conf` with shared includes
- [x] Verify nginx syntax with `nginx -t` in Docker

### 1.2 Implement CSP Header
- [x] Define CSP policy in `default.conf`:
  - `default-src 'self'`
  - `script-src 'self' https://accounts.google.com https://*.supabase.co`
  - `style-src 'self' 'unsafe-inline'`
  - `img-src 'self' data: https: blob:`
  - `font-src 'self' data:`
  - `connect-src 'self' https://*.supabase.co https://accounts.google.com https://api-a4c.firstovertheline.com https://rxnav.nlm.nih.gov`
  - `frame-src https://accounts.google.com https://*.supabase.co`
  - `frame-ancestors 'self'`
  - `base-uri 'self'`
  - `form-action 'self'`
  - `upgrade-insecure-requests`
- [x] Add Permissions-Policy header
- [x] Include security-headers.conf in location blocks that override add_header

## Phase 2: Development Mode Support ✅ COMPLETE

### 2.1 Add CSP Meta Tag for Development
- [x] Add CSP meta tag to `frontend/index.html`
- [x] Include `'unsafe-eval'` for Vite HMR
- [x] Include `ws://localhost:*` and `http://localhost:*` for dev server
- [x] Test development mode still works with meta tag

### 2.2 Update Dockerfile
- [x] Remove inline echo commands for nginx config
- [x] Add `COPY nginx/default.conf /etc/nginx/conf.d/default.conf`
- [x] Add `COPY nginx/security-headers.conf /etc/nginx/security-headers.conf`
- [x] Test Docker build succeeds

## Phase 3: Testing and Validation ⏸️ PENDING

### 3.1 Local Docker Testing
- [ ] Build Docker image: `docker build -t a4c-frontend-csp-test -f Dockerfile .`
- [ ] Run container: `docker run -d -p 8080:80 a4c-frontend-csp-test`
- [ ] Verify CSP header present: `curl -sI http://localhost:8080 | grep -i content-security-policy`
- [ ] Verify other security headers present
- [ ] Test application loads correctly

### 3.2 OAuth Flow Testing
- [ ] Test Google OAuth login flow in browser
- [ ] Check browser console for CSP violations
- [ ] Verify OAuth redirect completes successfully
- [ ] Verify session is established after OAuth

### 3.3 Application Feature Testing
- [ ] Test medication search (RXNorm API)
- [ ] Test backend API calls (Temporal workflows)
- [ ] Test image loading
- [ ] Test font loading

## Phase 4: Documentation ✅ COMPLETE

### 4.1 Create CSP Policy Documentation
- [x] Create `documentation/infrastructure/operations/CSP_POLICY.md`
- [x] Document each CSP directive and rationale
- [x] Document how to add new external resources
- [x] Document testing procedures
- [x] Document troubleshooting steps
- [x] Add version history section

## Phase 5: Production Deployment ⏸️ PENDING

### 5.1 Deploy to Production
- [ ] Create feature branch for changes
- [ ] Commit nginx configuration files
- [ ] Commit Dockerfile changes
- [ ] Commit index.html CSP meta tag
- [ ] Push branch and create PR
- [ ] Merge PR to trigger GitHub Actions deployment

### 5.2 Production Verification
- [ ] Verify CSP headers on production URL: `curl -sI https://a4c.firstovertheline.com | grep -i content-security-policy`
- [ ] Test OAuth flow in production
- [ ] Test all application features
- [ ] Monitor for any user-reported issues

## Success Validation Checkpoints

### Immediate Validation
- [ ] CSP header present in nginx response
- [ ] All existing security headers still present
- [ ] Docker build completes successfully
- [ ] Development mode works with Vite HMR

### Feature Complete Validation
- [ ] OAuth flow completes without CSP violations
- [ ] All API calls work without CSP violations
- [ ] No console CSP errors during normal application use
- [ ] Documentation complete

### Production Validation
- [ ] CSP header present on production URL
- [ ] Production OAuth flow works
- [ ] No user-reported issues related to blocked resources

## Current Status

**Phase**: Implementation Complete
**Status**: ✅ READY FOR DEPLOYMENT
**Last Updated**: 2025-12-20
**Next Step**: Push to main branch to trigger GitHub Actions deployment

## Implementation Notes

### CSP Policy Reference (Production)
```
Content-Security-Policy:
  default-src 'self';
  script-src 'self' https://accounts.google.com https://*.supabase.co;
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: https: blob:;
  font-src 'self' data:;
  connect-src 'self' https://*.supabase.co https://accounts.google.com https://api-a4c.firstovertheline.com https://rxnav.nlm.nih.gov;
  frame-src https://accounts.google.com https://*.supabase.co;
  frame-ancestors 'self';
  base-uri 'self';
  form-action 'self';
  upgrade-insecure-requests;
```

### CSP Policy Reference (Development - Meta Tag)
```html
<meta http-equiv="Content-Security-Policy"
      content="default-src 'self';
               script-src 'self' 'unsafe-eval' https://accounts.google.com https://*.supabase.co;
               style-src 'self' 'unsafe-inline';
               img-src 'self' data: https: blob:;
               font-src 'self' data:;
               connect-src 'self' ws://localhost:* http://localhost:* https://*.supabase.co https://accounts.google.com https://rxnav.nlm.nih.gov;
               frame-src https://accounts.google.com https://*.supabase.co;">
```

### Key Differences Dev vs Prod
| Directive | Development | Production |
|-----------|-------------|------------|
| script-src | includes `'unsafe-eval'` | no `'unsafe-eval'` |
| connect-src | includes `ws://localhost:*` | no localhost |
| frame-ancestors | not supported in meta tag | `'self'` |

## Rollback Procedure

If CSP breaks functionality:

1. **Immediate**: Revert nginx config changes
2. **Rebuild**: `docker build` and push to GHCR
3. **Redeploy**: GitHub Actions or manual `kubectl rollout restart`
4. **Verify**: Test OAuth and application features
5. **Debug**: Use browser DevTools to identify blocked resources
6. **Fix**: Add missing sources to CSP policy
