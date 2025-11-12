# Authentication Setup Guide

## Overview

This application uses **Zitadel** for authentication/authorization and **Supabase** for data storage with Row-Level Security (RLS) based on Zitadel JWT claims.

## Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  React App   │────▶│   Zitadel    │     │   Supabase   │
│              │     │    (Auth)    │     │  (Database)  │
└──────────────┘     └──────────────┘     └──────────────┘
       │                    │                     ▲
       │                    │                     │
       └────────────────────┴─────────────────────┘
            Uses Zitadel JWT for Supabase RLS
```

## Quick Start

### 1. Environment Configuration

Copy `.env.example` to `.env.local` and add your credentials:

```bash
cp .env.example .env.local
```

Update `.env.local` with your actual values from Zitadel and Supabase dashboards.

### 2. Install Dependencies

```bash
npm install
```

### 3. Run Development Server

```bash
npm run dev
```

## Zitadel Configuration

### Initial Setup

1. **Create Zitadel Account**: Sign up at [zitadel.com](https://zitadel.com)

2. **Create Organization**: Your super-admin tenant

3. **Create Project**: "A4C Platform" or similar

4. **Add Application**:
   - Type: **Single Page Application (SPA)**
   - Authentication Method: **PKCE**
   - Development Mode: **Yes** (for initial setup)
   - Note your Client ID

### Required Zitadel Settings

```javascript
// Application Configuration
{
  "applicationType": "SPA",
  "authMethod": "PKCE",
  "grantTypes": ["authorization_code", "refresh_token"],
  "responseTypes": ["code"],
  "redirectUris": [
    "http://localhost:5173/auth/callback",
    "https://yourdomain.com/auth/callback"
  ],
  "postLogoutRedirectUris": [
    "http://localhost:5173",
    "https://yourdomain.com"
  ]
}
```

## Supabase Configuration

### Initial Setup

1. **Create Supabase Project**: Sign up at [supabase.com](https://supabase.com)

2. **Configuration Options**:
   - Connection: **Data API + Connection String**
   - API Schema: **Use dedicated API schema**

3. **Note Credentials**:
   - Project URL
   - Anon Key
   - Service Role Key (backend only)

### Database Schema Setup

Run these SQL commands in Supabase SQL Editor:

```sql
-- Create schemas
CREATE SCHEMA IF NOT EXISTS api;
CREATE SCHEMA IF NOT EXISTS private;
CREATE SCHEMA IF NOT EXISTS audit;

-- Example table with organization scoping
CREATE TABLE api.medications (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    organization_id TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS Policy using Zitadel JWT claims
ALTER TABLE api.medications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own org data" ON api.medications
    FOR ALL USING (
        organization_id = current_setting('request.jwt.claims', true)::json->>'org_id'
    );
```

### Configuring Supabase to Accept Zitadel JWTs

You'll need to configure Supabase to validate Zitadel JWTs. This typically involves:

1. Setting up JWT secret/public key from Zitadel
2. Configuring custom JWT claims mapping
3. Ensuring organization_id is passed in JWT

## Authentication Flows

### 1. Zitadel Login Flow

```
User clicks "Sign in with SSO"
    ↓
Redirect to Zitadel
    ↓
User authenticates
    ↓
Redirect to /auth/callback
    ↓
Exchange code for tokens
    ↓
Update Supabase client with JWT
    ↓
Navigate to app
```

### 2. Mock/Development Login

For development, use the mock credentials:
- Username: `admin` / Password: `admin123`
- Username: `demo` / Password: `demo123`

## Multi-Tenancy Implementation

### Organization Structure

```typescript
interface Organization {
  id: string;                // Zitadel org ID
  name: string;              // Display name
  type: 'healthcare_facility' | 'var' | 'admin';
  metadata?: Record<string, any>;
}
```

### Role Mapping

Zitadel roles are mapped to application roles:

- `admin`, `administrator` → `admin`
- `clinician`, `doctor`, `physician` → `clinician`
- `nurse` → `nurse`
- All others → `viewer`

### Switching Organizations

Users with access to multiple organizations can switch context:

```typescript
const { switchOrganization } = useAuth();
await switchOrganization(orgId);
```

## API Usage Examples

### Using Supabase with Organization Scope

```typescript
// Query data (automatically scoped to user's org)
const { data, error } = await supabaseService.queryWithOrgScope('medications', {
  select: '*',
  orderBy: { column: 'name', ascending: true },
  limit: 10
});

// Insert data (automatically adds org_id)
const { data, error } = await supabaseService.insertWithOrgScope('medications', {
  name: 'Aspirin',
  dosage: '100mg'
});

// Update data (verifies org scope)
const { data, error } = await supabaseService.updateWithOrgScope(
  'medications',
  medicationId,
  { dosage: '200mg' }
);

// Delete data (verifies org scope)
const { error } = await supabaseService.deleteWithOrgScope(
  'medications',
  medicationId
);
```

### Permission Checking

```typescript
const { hasRole, hasPermission } = useAuth();

// Check role
if (hasRole('admin')) {
  // Show admin features
}

// Check permission
if (hasPermission('medications.write')) {
  // Allow medication editing
}
```

## Troubleshooting

### Common Issues

1. **"No Zitadel instance URL"**: Check `.env.local` has `VITE_ZITADEL_INSTANCE_URL`

2. **"Authentication failed"**: Verify:
   - Client ID is correct
   - Redirect URIs match exactly
   - Development mode is enabled in Zitadel

3. **"No organization context"**: User's JWT missing org claim:
   - Check Zitadel user has organization assignment
   - Verify JWT includes organization claims

4. **Supabase RLS blocking queries**:
   - Ensure JWT is being passed correctly
   - Check RLS policies reference correct claim names
   - Verify organization_id in data matches JWT claim

### Debug Mode

Enable auth debugging in `.env.local`:

```env
VITE_DEBUG_AUTH=true
```

This will log:
- Token exchanges
- JWT claims
- API calls
- Organization switches

## Security Best Practices

1. **Never expose service keys**: Keep `SUPABASE_SERVICE_ROLE_KEY` server-side only

2. **Use environment variables**: Never hardcode credentials

3. **Implement token refresh**: Tokens are auto-refreshed before expiry

4. **Validate permissions server-side**: Don't trust client-side permission checks

5. **Audit logging**: Track all authentication events

6. **Regular security reviews**: Update dependencies and review access patterns

## Production Checklist

- [ ] Switch Zitadel from development to production mode
- [ ] Configure production redirect URIs
- [ ] Set up custom domain for Zitadel
- [ ] Enable Supabase RLS on all tables
- [ ] Configure CORS policies
- [ ] Set up monitoring and alerting
- [ ] Implement audit logging
- [ ] Review and test all RLS policies
- [ ] Document role and permission matrix
- [ ] Set up backup authentication method

## Support

For issues or questions:
- Zitadel Documentation: [docs.zitadel.com](https://docs.zitadel.com)
- Supabase Documentation: [supabase.com/docs](https://supabase.com/docs)
- Application Issues: Create an issue in the repository