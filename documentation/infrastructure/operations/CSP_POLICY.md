# Content Security Policy (CSP) Documentation

## Overview

This document describes the Content Security Policy implemented for the A4C-AppSuite frontend application. CSP provides defense-in-depth security against XSS and other injection attacks.

## Implementation Location

CSP is implemented at the **nginx level** (Docker container), not at Traefik or Cloudflare. This ensures:

- Configuration is versioned with application code
- Same policy in local Docker testing and production
- No additional service dependencies

### Configuration Files

| File | Purpose |
|------|---------|
| `frontend/nginx/default.conf` | Main nginx server configuration with CSP header |
| `frontend/nginx/security-headers.conf` | Shared security headers for location block includes |
| `frontend/index.html` | CSP meta tag for development mode (Vite dev server) |

## CSP Policy Reference

### Production Policy (nginx Header)

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

### Development Policy (Meta Tag)

The development policy includes additional sources for Vite HMR:

```html
<meta http-equiv="Content-Security-Policy"
      content="default-src 'self';
               script-src 'self' 'unsafe-eval' https://accounts.google.com https://*.supabase.co;
               style-src 'self' 'unsafe-inline';
               img-src 'self' data: https: blob:;
               font-src 'self' data:;
               connect-src 'self' ws://localhost:* http://localhost:* https://*.supabase.co https://accounts.google.com https://api-a4c.firstovertheline.com https://rxnav.nlm.nih.gov;
               frame-src https://accounts.google.com https://*.supabase.co;">
```

### Key Differences: Dev vs Production

| Directive | Development | Production |
|-----------|-------------|------------|
| script-src | includes `'unsafe-eval'` | no `'unsafe-eval'` |
| connect-src | includes `ws://localhost:*` | no localhost |
| frame-ancestors | not supported in meta tag | `'self'` |

## Directive Reference

### default-src 'self'
Baseline policy for all resource types not explicitly specified. Only allows resources from the same origin.

### script-src
Allows JavaScript from:
- `'self'` - Same origin
- `https://accounts.google.com` - Google OAuth SDK
- `https://*.supabase.co` - Supabase client library

**Note**: `'unsafe-eval'` is only allowed in development for Vite HMR.

### style-src 'self' 'unsafe-inline'
Allows CSS from same origin and inline styles. `'unsafe-inline'` is required for Tailwind CSS which uses inline style attributes.

### img-src 'self' data: https: blob:
Allows images from:
- `'self'` - Same origin
- `data:` - Data URIs (base64 images)
- `https:` - Any HTTPS source
- `blob:` - Blob URLs (for dynamically created images)

### font-src 'self' data:
Allows fonts from same origin and data URIs.

### connect-src
Allows XHR/fetch requests to:
- `'self'` - Same origin
- `https://*.supabase.co` - Supabase API
- `https://accounts.google.com` - Google OAuth
- `https://api-a4c.firstovertheline.com` - Backend API (Temporal)
- `https://rxnav.nlm.nih.gov` - RXNorm medication API

### frame-src
Allows iframes from OAuth providers:
- `https://accounts.google.com` - Google OAuth popups
- `https://*.supabase.co` - Supabase Auth UI

### frame-ancestors 'self'
Prevents the application from being embedded in iframes on other sites (clickjacking protection). Only enforced via HTTP header, not meta tag.

### base-uri 'self'
Restricts URLs in `<base>` element to same origin.

### form-action 'self'
Restricts form submissions to same origin.

### upgrade-insecure-requests
Automatically upgrades HTTP requests to HTTPS.

## Adding New External Resources

When adding a new external API or service:

1. **Identify the directive** - Most APIs need `connect-src`, scripts need `script-src`
2. **Add to both files**:
   - `frontend/nginx/default.conf` (server block header)
   - `frontend/nginx/security-headers.conf` (include file)
   - `frontend/index.html` (meta tag, if applicable)
3. **Test locally** - Run the Vite dev server and check for CSP violations in browser console
4. **Test in Docker** - Build and run the Docker image to verify production CSP

### Example: Adding a New API

To add `https://api.example.com`:

```nginx
# In connect-src directive, add the new domain:
connect-src 'self' https://*.supabase.co https://accounts.google.com https://api-a4c.firstovertheline.com https://rxnav.nlm.nih.gov https://api.example.com;
```

## Troubleshooting

### Finding CSP Violations

1. Open browser DevTools (F12)
2. Go to Console tab
3. Look for errors starting with "Refused to..."
4. The error message indicates which directive blocked the resource

### Common Issues

#### "Refused to execute inline script"
- **Cause**: Inline `<script>` tags or event handlers
- **Solution**: Move JavaScript to external files or use nonce/hash (not recommended)

#### "Refused to load the script"
- **Cause**: Script from unlisted domain
- **Solution**: Add domain to `script-src` directive

#### "Refused to connect to"
- **Cause**: API call to unlisted domain
- **Solution**: Add domain to `connect-src` directive

#### "Refused to frame"
- **Cause**: iframe from unlisted domain
- **Solution**: Add domain to `frame-src` directive

### Google OAuth Console Warnings

The browser console may show warnings like:
- "This page uses Trusted Types"
- "Possible new bounce tracker"

These are expected and come from Google's OAuth JavaScript, not our application. They are not security vulnerabilities.

## Testing

### Verify CSP Header in Production

```bash
curl -sI https://a4c.firstovertheline.com | grep -i content-security-policy
```

### Verify CSP Header in Docker

```bash
# Build image
docker build -t a4c-frontend-test -f frontend/Dockerfile frontend/

# Run container
docker run -d -p 8080:80 a4c-frontend-test

# Check headers
curl -sI http://localhost:8080 | grep -i content-security-policy
```

### Browser DevTools

1. Open the application
2. Open DevTools > Network tab
3. Refresh the page
4. Click on the main document request
5. Check "Response Headers" for Content-Security-Policy

## Security Considerations

### Why 'unsafe-inline' for Styles?

Tailwind CSS generates inline styles at build time. Removing `'unsafe-inline'` would require:
- Extracting all styles to external CSS
- Using nonces or hashes (complex build process)

The risk of CSS injection is lower than script injection, so this trade-off is acceptable.

### Why No Trusted Types?

Trusted Types enforcement is blocked by Google's OAuth JavaScript, which uses patterns that trigger violations. Since we cannot modify third-party code, we document this as expected behavior.

### Future Improvements

1. **CSP Reporting**: Add `report-uri` or `report-to` directive to collect violation reports
2. **Subresource Integrity (SRI)**: Add integrity hashes to external scripts
3. **Nonce-based CSP**: More restrictive script-src using cryptographic nonces

## Version History

| Date | Change |
|------|--------|
| 2025-12-20 | Initial CSP implementation with OAuth provider support |
