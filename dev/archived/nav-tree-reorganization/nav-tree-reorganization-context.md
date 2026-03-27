# Context: Navigation Pane Tree Reorganization

## Decision Record

**Date**: 2026-03-24
**Feature**: Navigation pane collapsible tree structure
**Goal**: Reorganize flat 12-item sidebar into grouped collapsible sections by org_type.

### Key Decisions
1. **Disclosure pattern** (not role="tree") — nav is only 1 level deep
2. **localStorage persistence** — key `a4c-nav-expanded`, default all-expanded
3. **No animation** on collapse — simple conditional render, chevron rotates
4. **Provider partner edge case** — Clients as ungrouped item (separate NavEntry)
5. **Shared filtering hook** — fixes pre-existing MoreMenuSheet permission-check bug
6. **Fail-closed** per-item permission checks — one failure skips item, doesn't abort loop

## Files Created
- `frontend/src/components/navigation/navigation.types.ts`
- `frontend/src/components/navigation/navigation.config.ts`
- `frontend/src/components/navigation/useFilteredNavEntries.ts`
- `frontend/src/components/navigation/useNavExpansion.ts`
- `frontend/src/components/navigation/NavItemLink.tsx`
- `frontend/src/components/navigation/NavGroupSection.tsx`
- `frontend/src/components/navigation/SidebarNavigation.tsx`

## Files Modified
- `frontend/src/components/layouts/MainLayout.tsx` — removed ~240 lines of inline nav logic
- `frontend/src/components/navigation/MoreMenuSheet.tsx` — shared filtering + heading dividers
- `frontend/src/components/navigation/index.ts` — added new exports

## Deployment

- **Commit**: `e61f076d` — feat: reorganize sidebar navigation into collapsible tree structure
- **CI/CD**: Both Deploy Frontend and Validate Frontend Documentation pipelines passed
- **Live**: Deployed to K8s cluster (2026-03-24)

## GitHub Actions Upgrade (same session)

Also upgraded all 9 GitHub Actions workflows from Node.js 20 → Node.js 24 compatible versions:
- `actions/checkout` v4→v5, `actions/setup-node` v4→v5
- `docker/build-push-action` v5→v7, `docker/login-action` v3→v4
- `docker/metadata-action` v5→v6, `docker/setup-buildx-action` v3→v4
- `azure/setup-kubectl` v3→v4 (still Node.js 20 upstream — no v5 from Azure yet)
- **Commits**: `7e528d20`, `ba925982`
- **All 5 deploy pipelines passed**

## Important Constraints
- No route changes
- Bottom navigation keeps its own curated 4-item list
- Group headers are buttons, not links
- Reports and Settings always survive filtering (no permission/org_type filters)
