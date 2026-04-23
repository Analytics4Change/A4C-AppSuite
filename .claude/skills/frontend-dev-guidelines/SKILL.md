---
name: Frontend Development Guidelines
description: Guard rails for React/MobX reactivity, session management, CQRS queries, and WCAG 2.1 AA accessibility in A4C-AppSuite.
version: 3.0.0
category: frontend
tags: [mobx, accessibility, wcag, cqrs, logging, viewmodel]
---

# Frontend Guard Rails

Critical rules that prevent bugs in the React/TypeScript frontend. For deeper guidance:

- **Architecture / pattern questions** — search `documentation/AGENT-INDEX.md` with keywords: `mobx`, `viewmodel`, `cqrs`, `events`, `authentication`, `session-management`, `forgot-password`, `password-reset`, `logging`, `accessibility`, `wcag`.
- **UI component / pattern selection** (dropdowns, modals, checkbox groups) — consult the decision tree in `frontend/CLAUDE.md` and `documentation/frontend/patterns/ui-patterns.md` directly.

---

## 1. MobX: Never Spread Observable Arrays

Spreading breaks the observable chain — components silently stop re-rendering.

```typescript
// ❌ WRONG — loses reactivity, component won't update
<CategorySelection selectedClasses={[...vm.selectedTherapeuticClasses]} />

// ✅ CORRECT — pass observable directly
<CategorySelection selectedClasses={vm.selectedTherapeuticClasses} />

// ✅ For copies: use .slice() or toJS()
const copy = store.items.slice();
```

## 2. MobX: Always `observer()` + `runInAction()`

Every component reading observables MUST be wrapped with `observer()`. Async state updates after `await` MUST use `runInAction()`.

```typescript
// ✅ Component wrapped with observer
export const MyComponent = observer(() => {
  const store = useMyStore();
  return <div>{store.items.map(item => <Item key={item.id} {...item} />)}</div>;
});

// ✅ Async updates wrapped in runInAction
async fetchData() {
  const response = await api.get('/data');
  runInAction(() => {
    this.data = response.data;
    this.loading = false;
  });
}
```

## 3. Never Cache Sessions Manually

Supabase manages session state automatically. Manual caching causes **silent failures** — empty data lists with zero results and no errors.

> **Do NOT introduce manual session caching.** A legacy `getCurrentSession()` cache exists in `supabase.service.ts` but has no active callers. Do not re-introduce this pattern or copy its shape elsewhere.

```typescript
// ❌ WRONG — manual cache returns NULL, all queries silently fail
const session = supabaseService.getCurrentSession();

// ✅ CORRECT — retrieve session from Supabase every time
const { data: { session } } = await client.auth.getSession();
const claims = JSON.parse(atob(session.access_token.split('.')[1]));
// Use claims.org_id for RLS-compatible queries
```

## 4. CQRS: `api.` Schema RPC Only

**NEVER use direct table queries with PostgREST embedding.** This violates CQRS, causes 406 errors, and breaks multi-tenant isolation.

```typescript
// ✅ CORRECT
await supabase.schema('api').rpc('list_users', { p_org_id: orgId })

// ❌ WRONG — re-normalizes denormalized projections
await supabase.from('users').select('..., user_roles_projection!inner(...)')
```

## 5. Auth: Use `IAuthProvider` Interface

Never import auth providers directly. Use the factory/interface pattern.

```typescript
// ✅ CORRECT
import { getAuthProvider } from '@/services/auth/AuthProviderFactory';
const auth = getAuthProvider();

// ❌ WRONG — tight coupling to specific provider
import { SupabaseAuthProvider } from './SupabaseAuthProvider';
```

## 6. Accessibility: WCAG 2.1 Level AA Mandatory

Healthcare compliance. All interactive elements MUST have:
- `aria-label` or `aria-labelledby`
- Full keyboard navigation (Tab, Enter, Escape, Arrow keys)
- Visible focus indicators
- Focus trapping in modals (circular Tab navigation)
- `aria-live` for dynamic content updates

## 7. Focus Management: `useEffect`, Never `setTimeout`

```typescript
// ❌ WRONG
setTimeout(() => element.focus(), 100);

// ✅ CORRECT
useEffect(() => {
  if (isOpen) inputRef.current?.focus();
}, [isOpen]);
```

## 8. Timing: Centralized Config, No Magic Numbers

All delays, debounce intervals, and transition durations must use `TIMINGS` from `@/config/timings.ts`. Never hard-code timing values.

## 9. Correlation ID: Auto-Injected via `tracingFetch`

The Supabase client uses `tracingFetch` (defined in `frontend/src/lib/supabase-ssr.ts:112-118`) to **automatically inject** `X-Correlation-ID` and `traceparent` headers on every Supabase request. No manual header injection is needed for Supabase calls.

**Gap**: `TemporalWorkflowClient.ts` uses direct `fetch()` and must inject headers manually.

**Business-scoping rule** — still applies for generating vs reusing IDs:
- **New transactions** (create org, invite user): Backend generates a new `correlation_id`
- **Continuing transactions** (accept invitation): Do NOT generate a new one — backend reuses the stored `correlation_id`

## 10. Generated Event Types: Import from `@/types/events`

Domain event types are auto-generated from AsyncAPI schemas. **Never hand-write event interfaces.**

```typescript
// ✅ CORRECT — re-exports from generated + app-specific extensions
import { DomainEvent, EventMetadata, StreamType } from '@/types/events';

// ❌ WRONG — bypasses extensions
import { DomainEvent } from '@/types/generated/generated-events';

// ❌ WRONG — file does not exist, do not recreate it
import { DomainEvent } from '@/types/event-types';
```

See `frontend/CLAUDE.md` "Generated Event Types" section for regeneration steps.

## 11. CQRS Write Path: `api.*` RPC via Service, Check Envelope

All mutations go through `api.*` schema RPCs via service classes. The RPC emits domain events server-side — never write to projection tables directly.

- Every mutation must include a `reason` field (minimum 10 characters). Use the `ReasonInput` component (`frontend/src/components/ui/ReasonInput.tsx`) for user-facing reason capture.
- RPCs return an envelope `{ success: boolean, data?, errorDetails? }` — always check `result.success` before using `result.data`.

```typescript
// ✅ CORRECT — call api.* RPC via service, check envelope
const result = await roleService.deactivateRole({ roleId, reason });
if (!result.success) {
  showError(result.errorDetails?.message ?? 'Unknown error');
  return;
}
// use result.data

// ❌ WRONG — direct projection write bypasses event sourcing
await supabase.from('users_projection').update({ is_active: false }).eq('id', userId);
```

See `documentation/frontend/guides/EVENT-DRIVEN-GUIDE.md` for the full write-path pattern and `frontend/CLAUDE.md` (CQRS Query Pattern section) for RPC conventions.

## 12. JWT Utilities: Import from Shared Location

Do NOT duplicate `decodeJWT()` logic in individual services. Always import from the shared utility at `@/utils/jwt.ts`.

```typescript
// ✅ CORRECT
import { decodeJWT } from '@/utils/jwt';

// ❌ WRONG — inline decode
const claims = JSON.parse(atob(token.split('.')[1]));
```

**Rule**: All JWT decoding MUST import `decodeJWT` from `@/utils/jwt.ts`. Do not introduce inline `atob` / `JSON.parse` decode logic. If you find an inline copy while working nearby, migrate it in the same PR.

**Self-audit**: `grep -rnE "JSON\.parse.*atob" frontend/src` — any hits outside `@/utils/jwt.ts` are tech debt.

## 13. Logging: `Logger.getLogger()`, Never Bare Console

All logging must use the category logger. Bare `console.log` is stripped in production and provides no category filtering for the debug panel.

```typescript
import { Logger } from '@/utils/logger';
const log = Logger.getLogger('viewmodel'); // or: api, component, navigation, validation

log.debug('Loading users', { orgId });
log.error('Query failed', error);
// ❌ WRONG
console.log('Loading users');
```

**Debug panel shortcuts**: `Ctrl+Shift+D` (control panel), `Ctrl+Shift+M` (MobX monitor), `Ctrl+Shift+P` (performance).

---

## File Locations

| What | Where |
|------|-------|
| Components | `frontend/src/components/` (ui/, auth/, debug/, layouts/, medication/, navigation/, organization/, organizations/, organization-units/, roles/, schedules/, users/) |
| Pages | `frontend/src/pages/` |
| Views | `frontend/src/views/` (client/, medication/) |
| ViewModels | `frontend/src/viewModels/` |
| Services | `frontend/src/services/` (admin/, api/, assignment/, auth/, cache/, data/, direct-care/, http/, invitation/, medications/, mock/, organization/, roles/, schedule/, search/, storage/, users/, validation/, workflow/) |
| Auth config | `frontend/src/config/deployment.config.ts` (smart detection), `dev-auth.config.ts` (mock profiles), `oauth.config.ts` |
| Timing config | `frontend/src/config/timings.ts` |
| Logging config | `frontend/src/config/logging.config.ts`, `mobx.config.ts` |
| Tests | `frontend/src/test/`, `*.test.tsx` |
| File size | ~300 lines per file; split when exceeding |

## Deep Reference

- `frontend/CLAUDE.md` — Full development guidance, component decision tree, debugging MobX
- `documentation/AGENT-INDEX.md` — Search by keyword for architecture docs
- `documentation/architecture/authentication/frontend-auth-architecture.md` — Auth system
- `documentation/frontend/` — Frontend-specific guides and reference
- `documentation/frontend/patterns/mobx-patterns.md` — MobX observable and action patterns
- `documentation/frontend/patterns/ui-patterns.md` — Modal architecture, dropdown patterns
- `documentation/frontend/architecture/auth-provider-architecture.md` — Provider injection details

## Definition of Done

- `npm run docs:check` passes
- `npm run typecheck` passes
- `npm run lint` passes
- `npm run build` passes
- Zero rule violations in changed files
