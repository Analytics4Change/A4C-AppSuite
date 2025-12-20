# Context: CSP Headers Implementation

## Decision Record

**Date**: 2025-12-20
**Feature**: Content Security Policy (CSP) Headers for Frontend
**Goal**: Add defense-in-depth security headers to mitigate XSS and injection attacks, while ensuring OAuth flow compatibility.

### Key Decisions

1. **Implementation Location**: nginx configuration (Docker container)
   - Chosen over Traefik middleware: Keeps security config with application code
   - Chosen over Cloudflare Workers: Easier version control, no separate deployment
   - Benefit: Config changes deploy with application releases

2. **CSP Policy Approach**: Allowlist with specific domains
   - `'self'` as default-src baseline
   - Explicit domains for Google OAuth and Supabase
   - `'unsafe-inline'` for styles (required by Tailwind CSS)
   - No `'unsafe-eval'` in production (only in development for Vite HMR)

3. **Development vs Production CSP**: Different policies
   - Development: Meta tag in index.html with `'unsafe-eval'` for HMR
   - Production: nginx headers without `'unsafe-eval'`
   - Rationale: Production bundle is pre-compiled, no eval needed

4. **nginx Configuration Refactoring**: Separate files
   - Move inline Dockerfile echo commands to `nginx/default.conf`
   - Create `nginx/security-headers.conf` for reusable includes
   - Rationale: nginx's `add_header` in location blocks overrides parent headers

5. **Trusted Types Not Implemented**: External code limitation
   - Google OAuth JS uses patterns that trigger Trusted Types warnings
   - These warnings are from third-party code, not our application
   - Decision: Document as expected behavior, don't try to enforce Trusted Types

## Technical Context

### Architecture

```
User Browser
    |
    v
Cloudflare Tunnel (TLS termination)
    |
    v
Traefik Ingress Controller (k3s cluster)
    |
    v
nginx:alpine container (frontend) <-- CSP headers added here
    |
    v
React SPA (Vite build, static files)
```

### Tech Stack
- **Container**: nginx:alpine (official image)
- **Build**: Docker multi-stage (GitHub Actions pre-builds dist/)
- **Deployment**: Kubernetes (k3s) with Traefik ingress
- **TLS**: Cloudflare Universal SSL (*.firstovertheline.com)

### Dependencies
- **Google OAuth**: accounts.google.com (script-src, frame-src, connect-src)
- **Supabase Auth**: *.supabase.co (script-src, frame-src, connect-src)
- **Backend API**: api-a4c.firstovertheline.com (connect-src)
- **RXNorm API**: rxnav.nlm.nih.gov (connect-src)

## File Structure

### Existing Files Modified
- `frontend/Dockerfile` - Remove inline nginx config, add COPY for nginx files
- `frontend/index.html` - Add CSP meta tag for development mode

### New Files Created
- `frontend/nginx/default.conf` - Main nginx server configuration with CSP
- `frontend/nginx/security-headers.conf` - Shared security headers include file
- `documentation/infrastructure/operations/CSP_POLICY.md` - CSP documentation

## Related Components

- **OAuth Flow**: `frontend/src/lib/supabase-ssr.ts` - Supabase client with PKCE
- **Login Page**: `frontend/src/pages/auth/LoginPage.tsx` - OAuth initiation
- **Auth Callback**: `frontend/src/pages/auth/AuthCallback.tsx` - OAuth callback handler
- **Redirect Validation**: `frontend/src/utils/redirect-validation.ts` - URL sanitization
- **K8s Ingress**: `frontend/k8s/ingress.yaml` and `frontend/k8s/tenant-wildcard-ingress.yaml`

## Key Patterns and Conventions

### nginx Security Headers Pattern
```nginx
# In location blocks that use add_header (which overrides parent)
location ~* \.js$ {
    add_header Content-Type "application/javascript" always;
    include /etc/nginx/security-headers.conf;  # Include all security headers
    try_files $uri =404;
}
```

### CSP Directive Grouping
```
default-src 'self';                          # Baseline
script-src 'self' [oauth-providers];         # JavaScript
style-src 'self' 'unsafe-inline';            # Tailwind CSS
connect-src 'self' [api-endpoints];          # XHR/fetch
frame-src [oauth-providers];                 # iframes
frame-ancestors 'self';                      # Clickjacking prevention
```

## Reference Materials

- [MDN CSP Documentation](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP)
- [Google CSP Evaluator](https://csp-evaluator.withgoogle.com/)
- [Supabase Auth Documentation](https://supabase.com/docs/guides/auth)
- [nginx add_header behavior](http://nginx.org/en/docs/http/ngx_http_headers_module.html#add_header)

## Important Constraints

1. **nginx add_header inheritance**: Headers in location blocks REPLACE (not append) parent headers
   - Solution: Use include file for security headers in all location blocks

2. **Tailwind CSS requires 'unsafe-inline'**: Cannot use strict CSP for styles
   - Trade-off: Accept this risk (CSS injection is less severe than script injection)

3. **Vite HMR requires 'unsafe-eval'**: Development mode only
   - Solution: Different CSP for dev (meta tag) vs prod (nginx header)

4. **Google OAuth JavaScript**: Uses patterns that trigger CSP/Trusted Types warnings
   - Solution: Allow Google domains, document warnings as expected

5. **Supabase wildcard domain**: Use `*.supabase.co` to cover project-specific URLs
   - Alternative: Could use specific project domain, but wildcard is simpler

## Why This Approach?

### Why nginx over Traefik middleware?
- **Versioning**: Config travels with application code
- **Testing**: Can test CSP locally with Docker before deployment
- **Simplicity**: No additional Kubernetes CRDs needed

### Why nginx over Cloudflare Workers?
- **Version control**: Config in git with application
- **No additional service**: Don't need Cloudflare API access in CI/CD
- **Consistency**: Same CSP in local Docker testing and production

### Why not stricter CSP?
- **Tailwind CSS**: Requires 'unsafe-inline' for styles (no practical alternative)
- **Third-party OAuth**: Google's OAuth JS uses patterns we can't control
- **Pragmatic security**: Current policy blocks XSS while allowing OAuth to work

### Alternatives Considered

1. **Meta tag only**: Wouldn't work for frame-ancestors directive
2. **Report-only mode first**: Could add, but adds complexity
3. **Trusted Types**: Not feasible due to Google OAuth JS
4. **Popup OAuth**: Could avoid bounce tracker, but poor mobile UX

## OAuth Flow Analysis Summary

The analysis that led to this CSP implementation confirmed:
- Current PKCE OAuth flow is secure and follows OAuth 2.1 best practices
- Browser console warnings are from third-party code (Google OAuth JS)
- "Bounce tracker" classification is unavoidable due to OAuth redirect architecture
- No security vulnerabilities in the current implementation
- CSP is a defense-in-depth enhancement, not a vulnerability fix
