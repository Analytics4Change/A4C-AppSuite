# Implementation Plan: CSP Headers for Frontend

## Executive Summary

This feature implements Content Security Policy (CSP) headers for the A4C-AppSuite frontend application to provide defense-in-depth security. The current OAuth redirect flow implementation is architecturally sound and uses industry-standard PKCE, but browser console warnings during Google SSO authentication prompted a security review. While those warnings originate from third-party code (Google OAuth JS) and are not security vulnerabilities, adding CSP headers provides additional protection against XSS and other injection attacks.

The implementation adds CSP headers at the nginx level (Docker container) rather than Traefik middleware or Cloudflare Workers, keeping the security configuration versioned with the application code.

## Phase 1: nginx Configuration Refactoring

### 1.1 Create Dedicated nginx Configuration Files
- Extract inline nginx config from Dockerfile to proper configuration files
- Create `frontend/nginx/default.conf` for main server configuration
- Create `frontend/nginx/security-headers.conf` for shared header includes
- Key tasks: File creation, nginx syntax validation
- Expected outcome: Maintainable nginx configuration
- Time estimate: 30 minutes

### 1.2 Implement CSP Header
- Define CSP policy for OAuth flow (Google, Supabase)
- Define CSP policy for application APIs (RXNorm, Backend API)
- Handle Tailwind CSS `'unsafe-inline'` requirement
- Key tasks: Policy definition, directive selection
- Expected outcome: Working CSP policy without breaking OAuth
- Time estimate: 45 minutes

## Phase 2: Development Mode Support

### 2.1 Add CSP Meta Tag for Development
- Add CSP meta tag to `frontend/index.html` for Vite dev server
- Include `'unsafe-eval'` for Vite HMR
- Include `ws://localhost:*` for WebSocket connections
- Key tasks: Meta tag creation, development-specific policy
- Expected outcome: CSP violations visible during development
- Time estimate: 15 minutes

### 2.2 Update Dockerfile
- Modify Dockerfile to copy nginx config files
- Remove inline echo commands
- Test Docker build
- Key tasks: Dockerfile modification, build verification
- Expected outcome: Cleaner Dockerfile, working build
- Time estimate: 15 minutes

## Phase 3: Testing and Validation

### 3.1 Local Docker Testing
- Build Docker image with new configuration
- Test CSP headers are present in responses
- Verify OAuth flow works without CSP violations
- Key tasks: Docker build, curl testing, browser testing
- Expected outcome: Working CSP in local Docker environment
- Time estimate: 30 minutes

### 3.2 Production Deployment
- Push changes to trigger GitHub Actions
- Verify CSP headers in production
- Monitor for CSP violation reports
- Key tasks: Deployment, production verification
- Expected outcome: CSP active in production
- Time estimate: 30 minutes

## Phase 4: Documentation

### 4.1 Create CSP Policy Documentation
- Document each CSP directive and rationale
- Document how to add new external resources
- Document troubleshooting procedures
- Key tasks: Documentation creation
- Expected outcome: Complete CSP documentation
- Time estimate: 30 minutes

## Success Metrics

### Immediate
- [ ] CSP header present in nginx response headers
- [ ] OAuth flow (Google SSO) completes without CSP violations
- [ ] All application features work without console CSP errors

### Medium-Term
- [ ] Production deployment successful
- [ ] No user-reported authentication issues
- [ ] Mozilla Observatory security score improvement (optional)

### Long-Term
- [ ] CSP policy maintained as new features added
- [ ] Documentation kept up-to-date
- [ ] No CSP-related production incidents

## Implementation Schedule

| Phase | Duration | Description |
|-------|----------|-------------|
| Phase 1 | 1.5 hours | nginx configuration and CSP policy |
| Phase 2 | 30 minutes | Development mode support |
| Phase 3 | 1 hour | Testing and validation |
| Phase 4 | 30 minutes | Documentation |
| **Total** | **3.5 hours** | Complete implementation |

## Risk Mitigation

### Risk: CSP breaks OAuth flow
- **Mitigation**: Test OAuth flow in Docker before production deployment
- **Rollback**: Remove CSP header from nginx config, rebuild, deploy

### Risk: CSP blocks legitimate resources
- **Mitigation**: Use browser DevTools to identify blocked resources
- **Rollback**: Add missing sources to CSP directives

### Risk: Development CSP differs from production
- **Mitigation**: Document differences (`'unsafe-eval'` for Vite HMR)
- **Rollback**: N/A - this is expected difference

## Next Steps After Completion

1. Consider CSP reporting endpoint (report-uri or report-to directive)
2. Evaluate Subresource Integrity (SRI) for external scripts
3. Review and harden other security headers (already mostly present)
4. Consider optional popup OAuth for returning users (future UX enhancement)
