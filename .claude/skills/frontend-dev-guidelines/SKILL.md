---
name: Frontend Development Guidelines
description: Guard rails for React/MobX reactivity, session management, CQRS queries, and WCAG 2.1 AA accessibility in A4C-AppSuite.
version: 2.0.0
category: frontend
tags: [react, mobx, accessibility, wcag, cqrs, radix-ui, tailwind]
---

# Frontend Guard Rails

Critical rules that prevent bugs in the React/TypeScript frontend. For full guidance, component patterns, and the dropdown decision tree, see `frontend/CLAUDE.md` and search `documentation/AGENT-INDEX.md` with keywords: `react`, `mobx`, `accessibility`, `wcag`, `component`, `radix`, `tailwind`, `auth`, `session`, `cqrs`.

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

## 9. Correlation ID: Business-Scoped

- **New transactions** (create org, invite user): Generate new `correlation_id`, pass via `x-correlation-id` header
- **Continuing transactions** (accept invitation): Let backend reuse the stored `correlation_id` — do NOT generate a new one

---

## File Locations

| What | Where |
|------|-------|
| Components | `frontend/src/components/` (ui/, auth/, medication/, layouts/) |
| Pages | `frontend/src/pages/` |
| ViewModels | `frontend/src/viewModels/` |
| Services | `frontend/src/services/` (api/, auth/, data/) |
| Auth config | `frontend/src/config/oauth.config.ts` |
| Timing config | `frontend/src/config/timings.ts` |
| Tests | `frontend/src/test/`, `*.test.tsx` |

## Deep Reference

- `frontend/CLAUDE.md` — Full development guidance, component decision tree, debugging MobX
- `documentation/AGENT-INDEX.md` — Search by keyword for architecture docs
- `documentation/architecture/authentication/frontend-auth-architecture.md` — Auth system
- `documentation/frontend/` — Frontend-specific guides and reference
