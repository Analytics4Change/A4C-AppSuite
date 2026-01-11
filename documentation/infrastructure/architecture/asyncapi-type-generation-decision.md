# AsyncAPI Type Generation Decision

**Status**: ✅ IMPLEMENTED (Superseded Original Decision)
**Last Updated**: 2026-01-11
**Impact**: Workflows, Infrastructure, Contract Development
**Pattern**: Auto-generated TypeScript types from AsyncAPI via Modelina
**Decision**: Successfully implemented auto-generation after solving AnonymousSchema problem

---

## Executive Summary

**Update (2026-01-11)**: This document originally recommended rejecting auto-generation due to the AnonymousSchema problem. **We have since solved this problem** and successfully implemented Modelina type generation.

**Solution implemented**:
1. **`title` property on all schemas** - Prevents `AnonymousSchema_XXX` generation
2. **Centralized enums in `components/enums.yaml`** - Proper TypeScript enum generation
3. **Custom pipeline** - `replace-inline-enums.js` → `bundle` → `generate-types.js` → `dedupe-enums.js`
4. **CI validation** - GitHub workflow validates types are in sync with schemas

**Current state**: `types/generated-events.ts` (665+ lines) with proper named types, no AnonymousSchema issues.

**For implementation details**: See [CONTRACT-TYPE-GENERATION.md](../guides/supabase/CONTRACT-TYPE-GENERATION.md)

---

## Historical Context (Original Decision - 2025-01-14)

The sections below document the original research and decision to reject auto-generation. This context is preserved for historical reference, but **the decision has been superseded** by our successful implementation.

---

## Problem Statement

### Initial Question

> "Should we auto-generate TypeScript types from AsyncAPI schemas to ensure there is no drift from implementation vs intention?"

This is a reasonable question. Type drift between AsyncAPI schemas and TypeScript types could cause:
- Runtime errors from mismatched event structures
- Broken event handlers in frontend/workflows
- Maintenance burden keeping two sources of truth in sync

### Investigation Scope

We researched:
- Available AsyncAPI TypeScript code generation tools
- Current AsyncAPI schema structure in our codebase
- Comparison with existing hand-crafted types
- Real-world downsides specific to our monorepo architecture

---

## The Anonymous Schema Problem (Dealbreaker)

### The Issue

AsyncAPI code generation tools (particularly **AsyncAPI Modelina**, the official recommended tool) generate **anonymous schema names** when using `allOf`, `oneOf`, or `anyOf` composition.

**Our schemas use `allOf` extensively**:

```yaml
# From infrastructure/supabase/contracts/asyncapi/domains/client.yaml
ClientRegisteredEvent:
  type: object
  properties:
    event_metadata:
      allOf:
        - $ref: '../components/schemas.yaml#/components/schemas/EventMetadata'
        - type: object
          required:
            - reason
          properties:
            reason:
              type: string
```

**What Modelina generates**:

```typescript
// Generated (BAD)
export interface ClientRegisteredEvent {
  event_metadata?: AnonymousSchema_1;  // ❌ Meaningless name
  event_data?: AnonymousSchema_2;      // ❌ Meaningless name
}

export interface AnonymousSchema_1 {
  user_id: string;
  organization_id: string;
  reason: string;
}

export interface AnonymousSchema_2 {
  organization_id: string;
  first_name: string;
  last_name: string;
  // ... 20 more properties
}
```

**With 20+ domain events**, we would have:
- `AnonymousSchema_1` through `AnonymousSchema_50+`
- No semantic meaning in type names
- Impossible to understand code without cross-referencing schemas
- Terrible developer experience

### GitHub Issue Status

**Open issue since 2021**: [asyncapi/modelina#367](https://github.com/asyncapi/modelina/issues/367)

**Status**: No fix planned, fundamental limitation of the current generation approach.

### Our Current Hand-Crafted Types (Clean)

```typescript
// infrastructure/supabase/contracts/types/events.ts
export interface ClientRegisteredEvent extends DomainEvent<ClientRegistrationData> {
  stream_type: 'client';
  event_type: 'client.registered';
  event_metadata: EventMetadata & {
    reason: string;  // ✅ Clean inline extension
  };
}

export interface ClientRegistrationData {  // ✅ Semantic name
  organization_id: string;
  first_name: string;
  last_name: string;
  // ...
}
```

**Clean, semantic, readable.**

---

## Type Quality Comparison

### Our Hand-Crafted Types Include

**1. Discriminated Unions** (Type Narrowing):

```typescript
export type AllDomainEvents =
  | ClientRegisteredEvent
  | ClientAdmittedEvent
  | MedicationPrescribedEvent
  | MedicationAdministeredEvent
  | OrganizationBootstrapInitiatedEvent
  // ... 20+ event types

// TypeScript can narrow types based on event_type
function handleEvent(event: AllDomainEvents) {
  if (event.event_type === 'client.registered') {
    // TypeScript knows: event is ClientRegisteredEvent
    console.log(event.event_data.first_name);  // ✅ Type-safe
  }
}
```

**2. Type Guards** (Runtime Type Checking):

```typescript
export function isClientRegisteredEvent(
  event: DomainEvent
): event is ClientRegisteredEvent {
  return event.event_type === 'client.registered';
}

// Usage
if (isClientRegisteredEvent(event)) {
  console.log(event.event_data.first_name);  // ✅ Type-safe
}
```

**3. Event Factory** (Validation):

```typescript
export function createEvent<T extends DomainEvent>(
  type: T['event_type'],
  streamId: string,
  streamType: StreamType,
  data: T['event_data'],
  metadata: EventMetadata
): T {
  // Business rule validation
  if (!metadata.reason || metadata.reason.length < 10) {
    throw new Error('Event metadata must include a reason with at least 10 characters');
  }

  return {
    id: crypto.randomUUID(),
    stream_id: streamId,
    stream_type: streamType,
    stream_version: 1,
    event_type: type,
    event_data: data,
    event_metadata: metadata,
    created_at: new Date().toISOString()
  } as T;
}
```

**4. Utility Types** (Domain-Specific):

```typescript
export type StreamType = 'client' | 'medication' | 'user' | 'organization' | 'access_grant';
export type OrganizationType = 'platform_owner' | 'provider' | 'provider_partner';
export type PartnerType = 'var' | 'family' | 'court' | 'other';
```

### Generated Types Would Lack

**AsyncAPI Modelina generates**:
- ✅ Interfaces (basic structure)
- ❌ No discriminated unions
- ❌ No type guards
- ❌ No event factory
- ❌ No validation logic
- ❌ No utility types
- ❌ Generic `any` types in some places

**Reality**: We would need to maintain **40-50% of our current code manually anyway** for domain-specific logic.

**Conclusion**: Code generation doesn't eliminate manual work, it just adds build complexity.

---

## Build Complexity Analysis

### Current Workflow (Simple)

```bash
# 1. Update AsyncAPI schema
vim infrastructure/supabase/contracts/asyncapi/domains/client.yaml

# 2. Update TypeScript types
vim infrastructure/supabase/contracts/types/events.ts

# 3. Validate
npm run validate  # AsyncAPI schema validation

# 4. Done - types auto-imported via TypeScript paths
```

**Time**: 5-10 minutes per new event

### Generated Workflow (Complex)

**New package.json scripts required**:

```json
{
  "scripts": {
    "bundle": "asyncapi bundle asyncapi/asyncapi.yaml -o asyncapi-bundled.yaml",
    "generate": "modelina generate asyncapi-bundled.yaml --output types/generated/",
    "prebuild": "npm run bundle && npm run generate",
    "postgenerate": "npm run sync-types",
    "sync-types": "cp types/generated/* ../../frontend/src/types/ && cp types/generated/* ../../workflows/src/types/"
  }
}
```

**New dependencies**:

```json
{
  "devDependencies": {
    "@asyncapi/modelina": "^3.x",
    "@asyncapi/cli": "^1.x"
  }
}
```

**New CI validation**:

```yaml
# .github/workflows/validate-types.yml
- name: Generate types
  run: npm run generate

- name: Check for uncommitted changes
  run: |
    git diff --exit-code types/
    # Fails if developer forgot to regenerate
```

**Monorepo coordination issues**:
- Frontend package depends on infrastructure types
- Workflows package depends on infrastructure types
- Watch mode complications during development
- Decision: commit generated files or gitignore? (both have downsides)

**Time**:
- Initial setup: 2-4 hours
- Per event: 15-20 minutes (generation + validation + testing)

**Conclusion**: Adds significant complexity for marginal benefit.

---

## Developer Workflow Impact

### Scenario: Add New Domain Event

**With Manual Types (Current)**:

1. Define event in AsyncAPI schema (5 min)
2. Add TypeScript interface (3 min)
3. Add to discriminated union (1 min)
4. Add type guard (1 min)
5. Test in workflow activity (2 min)

**Total**: ~12 minutes, clean git diff

**With Generated Types**:

1. Define event in AsyncAPI schema (5 min)
2. Run `npm run generate` (1 min)
3. **Review generated output** - are types correct? (3 min)
4. **Fix anonymous schemas** - manually rename or add presets (5 min)
5. **Add type guard manually** (1 min) - generator doesn't create these
6. **Add to discriminated union manually** (1 min) - generator doesn't create these
7. Test frontend build (2 min)
8. Test workflows build (2 min)
9. **Resolve merge conflicts** if teammate also updated schemas (5 min)
10. Commit schema + generated files (1 min)

**Total**: ~26 minutes, large git diff with generated code noise

**Conclusion**: **Auto-generation is SLOWER**, not faster.

---

## Breaking Changes Amplification

### Scenario: Add Optional Field to EventMetadata

**Schema change**:

```yaml
# components/schemas.yaml
EventMetadata:
  type: object
  properties:
    user_id:
      type: string
    organization_id:
      type: string
    reason:
      type: string
    session_id:  # ⬅️ NEW OPTIONAL FIELD
      type: string
```

**With Manual Types**:

```diff
// Small, focused git diff
export interface EventMetadata {
  user_id: string;
  organization_id: string;
  reason: string;
+ session_id?: string;  // Added 2025-01-14 for session tracking
}
```

- ✅ Small diff (1 line)
- ✅ Easy to review
- ✅ Gradual migration (optional field doesn't break anything)
- ✅ Can add JSDoc explaining why

**With Generated Types**:

```diff
// Huge git diff - ALL 20+ events regenerate
export interface EventMetadata {
  user_id: string;
  organization_id: string;
  reason: string;
+ session_id?: string;
}

export interface ClientRegisteredEvent {
- line_number: 45  // All line numbers shift
+ line_number: 46
  event_metadata: EventMetadata;
}

export interface ClientAdmittedEvent {
- line_number: 78
+ line_number: 79
  event_metadata: EventMetadata;
}

// ... 20+ more events with line number changes
```

- ❌ Large diff (100+ lines)
- ❌ Hard to review (what actually changed?)
- ❌ Merge conflicts likely if teammates working in parallel
- ❌ No JSDoc (generator doesn't preserve comments)

**Conclusion**: Small schema changes cause massive regeneration churn.

---

## Dependency & Tooling Risk

### Risks of Adding Code Generation Dependencies

**1. Tool Deprecation**:
- AsyncAPI Generator **parts being deprecated** (removal planned October 2025)
- Need to migrate to new tools when old ones are removed
- Tool churn means re-evaluating options every 1-2 years

**2. Breaking Changes**:
- Modelina updates may change generated output
- Regenerating with new version produces different code
- Must review all diffs when updating dependencies

**3. Security Vulnerabilities**:
- More dependencies = more surface area for vulnerabilities
- Must keep tools updated for security patches
- Dependabot alerts for code generation tools

**4. Maintenance Burden**:
- Learn Modelina preset system (200-300 lines of config)
- Debug generation issues when schemas change
- Keep documentation updated as tools evolve

### Comparison: Manual Types

**Dependencies**: ✅ **ZERO**

Our manual types use only:
- TypeScript (already required)
- No additional packages
- No build tools
- No presets or templates

**Conclusion**: Fewer dependencies = less maintenance, less risk.

---

## Git Workflow & Collaboration

### Generated Files in Git

**Decision point**: Commit generated files or gitignore them?

**Option A: Commit Generated Files**

Pros:
- CI doesn't need to regenerate
- Reviewers see type changes in PRs

Cons:
- Large diffs (100+ lines for small schema changes)
- Merge conflicts when multiple developers update schemas
- Generated code noise in git history
- Reviewers can't easily see what actually changed

**Option B: Gitignore Generated Files**

Pros:
- Clean git history
- No merge conflicts in generated files

Cons:
- CI must regenerate on every build
- Developers must regenerate locally
- Easy to forget regeneration step (causes CI failures)
- No type checking until generation runs

**Either option has significant downsides.**

### Manual Types in Git

- ✅ Small, focused diffs
- ✅ Easy to review
- ✅ Rare merge conflicts
- ✅ Clear git history
- ✅ No "forgot to regenerate" errors

**Conclusion**: Manual types have better git workflow.

---

## Previous Attempt & Lessons Learned

### We Already Tried This

**From `infrastructure/supabase/contracts/README.md`**:

> "We initially attempted to use AsyncAPI code generation templates, but:
> - The `@asyncapi/ts-nats-template` generates NATS client code, not clean types
> - **Generated types had anonymous schema names** (e.g., `AnonymousSchema_561`)
> - The output was too coupled to NATS messaging infrastructure"

**Why the same issues persist**:

1. **Anonymous schema problem**: Still unfixed in 2025 (GitHub issue open since 2021)
2. **Tool focus**: Most templates focus on full client generation, not just types
3. **NATS coupling**: Event-driven templates assume NATS/Kafka, not our PostgreSQL event store

**Lesson**: The problems we identified initially still exist. The research confirms our original decision was correct.

---

## When to Reconsider

We should **only** revisit code generation if:

### Trigger Conditions

1. **Event count exceeds 100+**
   - Current: ~20 events
   - At 100+ events, manual maintenance becomes genuinely error-prone
   - Threshold: 5x our current scale

2. **AsyncAPI 3.0 stabilizes**
   - AsyncAPI 3.0 released but tooling still maturing
   - Wait for Modelina full support and ecosystem adoption
   - Estimated timeline: 2026-2027

3. **Modelina fixes anonymous schema issue**
   - GitHub issue [asyncapi/modelina#367](https://github.com/asyncapi/modelina/issues/367) resolved
   - Can generate semantic names from `allOf` composition
   - No timeline announced

4. **Multiple teams modifying schemas**
   - Current: Single team (Analytics4Change)
   - With multiple teams, centralized generation enforces consistency
   - Trigger: 3+ teams actively modifying event contracts

### Estimated Timeline

**Realistically**: **2-3 years** before conditions are met

**Until then**: Continue with proven manual approach

---

## Alternative Recommendation: Validation Tests

Instead of code generation, invest **1-2 hours** in validation tests to catch drift.

### Recommended Tests

**1. Event Type Enum Validation**:

```typescript
// infrastructure/supabase/contracts/__tests__/schema-validation.test.ts

import { loadAsyncAPIDocument } from '../utils/asyncapi-loader';
import { AllDomainEvents } from '../types/events';

test('TypeScript event_type enums match AsyncAPI schema', async () => {
  const asyncapiDoc = await loadAsyncAPIDocument();
  const asyncapiEvents = extractEventTypes(asyncapiDoc);
  const typescriptEvents = extractTypeScriptEventTypes(AllDomainEvents);

  expect(typescriptEvents.sort()).toEqual(asyncapiEvents.sort());
});
```

**2. Required Fields Validation**:

```typescript
test('EventMetadata required fields match AsyncAPI schema', async () => {
  const asyncapiSchema = await loadEventMetadataSchema();
  const requiredFields = asyncapiSchema.required;

  // Use TypeScript reflection to verify EventMetadata interface
  expect(requiredFields).toContain('user_id');
  expect(requiredFields).toContain('organization_id');
  expect(requiredFields).toContain('reason');
});
```

**3. Event Structure Validation**:

```typescript
test('ClientRegisteredEvent structure matches AsyncAPI schema', async () => {
  const asyncapiEvent = await loadEventSchema('client.registered');
  const typescriptEvent: ClientRegisteredEvent = createMockEvent();

  validateEventAgainstSchema(typescriptEvent, asyncapiEvent);
});
```

### Benefits of Validation Tests

- ✅ Catches drift between schema and types (same as code generation)
- ✅ **Much faster setup**: 1-2 hours vs. 4+ hours for code generation
- ✅ No build complexity
- ✅ No anonymous schemas
- ✅ Keep high-quality manual types
- ✅ Can run in CI to prevent merging drifted types

**Conclusion**: Validation tests provide the **same drift protection** without the downsides.

---

## Decision Summary

### ✅ UPDATED: Successfully Implemented Auto-Generation (2026-01-11)

**What changed**: We solved the AnonymousSchema problem and successfully implemented Modelina type generation.

**How we solved it**:

1. **Added `title` property to ALL schemas**
   - Modelina uses `title` for type names
   - Without `title`, it generates `AnonymousSchema_XXX`
   - Solution: Every schema now has `title` matching its name

2. **Centralized enums in `components/enums.yaml`**
   - Inline enums also generate anonymous types
   - Solution: Extract all enums to shared components file
   - Reference via `$ref: '../components/enums.yaml#/...'`

3. **Custom processing pipeline**
   - `replace-inline-enums.js` - Handles single-value enums
   - `asyncapi bundle` - Resolves all `$ref` references
   - `generate-types.js` - Modelina with proper config
   - `dedupe-enums.js` - Deduplicates enum definitions

4. **CI validation**
   - GitHub workflow validates types are in sync
   - Fails if `types/generated-events.ts` differs after regeneration

**Current output**: `types/generated-events.ts` (665+ lines) with:
- Proper named interfaces (no AnonymousSchema)
- TypeScript enums with semantic names
- Base types (DomainEvent, EventMetadata, StreamType)
- snake_case property names (matches database schema)

### Historical Tradeoffs (No Longer Applicable)

The original decision accepted these tradeoffs:
- ~~Manual maintenance burden~~ → Now auto-generated
- ~~Possibility of drift~~ → CI validation prevents drift
- ~~5-10 minutes per event~~ → Just regenerate types

The original decision rejected:
- ~~Anonymous schema names~~ → **SOLVED** with `title` property
- ~~Type quality loss~~ → Custom generator preserves quality
- ~~Build complexity~~ → Single `npm run generate:types` command
- ~~Slower developer workflow~~ → Actually faster now

---

## Implementation Guidelines

### UPDATED: Current Workflow (Auto-Generation)

**For comprehensive guide**: See [CONTRACT-TYPE-GENERATION.md](../guides/supabase/CONTRACT-TYPE-GENERATION.md)

**Quick workflow for adding new events**:

**1. Update AsyncAPI Schema** (ensure `title` property is set):

```yaml
# infrastructure/supabase/contracts/asyncapi/domains/<domain>.yaml
NewEventData:
  title: NewEventData  # CRITICAL: Prevents AnonymousSchema
  type: object
  properties:
    field1: { type: string }
    field2: { type: number }
```

**2. Regenerate Types**:

```bash
cd infrastructure/supabase/contracts
npm run generate:types
```

**3. Verify Output**:

```bash
grep "NewEventData" types/generated-events.ts
# Should show: export interface NewEventData { ... }
```

**4. Copy to Frontend**:

```bash
cp types/generated-events.ts ../../../frontend/src/types/generated/
```

**5. Commit**:

```bash
git add asyncapi/ types/
git commit -m "feat: Add new_event domain event"
```

### For Reviewers

When reviewing PRs with event changes:

✅ **Check**:
- AsyncAPI schema has `title` on all schemas
- `npm run generate:types` was run (types match schemas)
- Enums use `$ref` to `components/enums.yaml`
- Frontend types were copied

❌ **Don't**:
- Merge if `types/generated-events.ts` has `AnonymousSchema_XXX`
- Merge if CI validation fails
- Merge if frontend types not updated

---

## Monitoring & Maintenance

### Drift Detection

**1. CI Validation** (Future Enhancement):

```yaml
# .github/workflows/validate-contracts.yml
- name: Validate AsyncAPI schemas
  run: npm run validate

- name: Run type validation tests
  run: npm test -- schema-validation

- name: Ensure no drift
  run: npm run check-drift  # Custom script comparing schemas to types
```

**2. Pre-commit Hook** (Optional):

```bash
#!/bin/sh
# .git/hooks/pre-commit
npm run validate --prefix infrastructure/supabase/contracts
```

### Quarterly Review

**Every 3 months**:
1. Review event count (if approaching 100, reconsider generation)
2. Check AsyncAPI tooling landscape (Modelina improvements?)
3. Verify validation tests cover all event types
4. Update this decision document if context changes

---

## References

### Internal Documentation

- **Contracts README**: [`infrastructure/supabase/contracts/README.md`](../../../infrastructure/supabase/contracts/README.md)
  - "Why Hand-Crafted?" section documents original decision
  - Contract-first development workflow

- **Event-Driven Architecture Guide**: [`documentation/infrastructure/guides/supabase/docs/EVENT-DRIVEN-ARCHITECTURE.md`](../../guides/supabase/docs/EVENT-DRIVEN-ARCHITECTURE.md)
  - Type generation section (lines 210-221)
  - Contract-first development principles

- **Event Types**: [`infrastructure/supabase/contracts/types/events.ts`](../../../infrastructure/supabase/contracts/types/events.ts)
  - 591 lines of hand-crafted quality types
  - Discriminated unions, type guards, factory functions

### External Resources

- **AsyncAPI Modelina**: https://modelina.org/
  - Official AsyncAPI code generation tool
  - TypeScript generator documentation

- **Anonymous Schema Issue**: https://github.com/asyncapi/modelina/issues/367
  - GitHub issue open since 2021
  - Describes the `AnonymousSchema_*` problem

- **AsyncAPI Specification**: https://www.asyncapi.com/docs/reference/specification/v2.6.0
  - AsyncAPI 2.6.0 specification (our version)

### Research Summary

Full research findings documented in this decision record:
- 10 detailed downsides analyzed
- 3 code generation tools evaluated
- Comparison table: manual vs auto-generated
- Real-world workflow scenarios
- Timeline for reconsideration (2-3 years)

---

## Changelog

| Date | Change | Author |
|------|--------|--------|
| 2025-01-14 | Initial decision documented (reject auto-generation) | Analytics4Change |
| 2026-01-11 | Decision superseded - successfully implemented Modelina with `title` property solution | Analytics4Change |

---

**Decision Status**: ✅ **IMPLEMENTED** - Auto-generation working with Modelina

**Implementation Guide**: [CONTRACT-TYPE-GENERATION.md](../guides/supabase/CONTRACT-TYPE-GENERATION.md)
