# Tasks: Navigation Pane Tree Reorganization

## Phase 1: Data Model & Configuration ✅ COMPLETE
- [x] Create navigation.types.ts (NavItem, NavGroup, NavEntry)
- [x] Create navigation.config.ts (NAVIGATION_CONFIG)

## Phase 2: Hooks ✅ COMPLETE
- [x] Create useFilteredNavEntries.ts (shared filtering with per-item try/catch)
- [x] Create useNavExpansion.ts (localStorage persistence + auto-expand)

## Phase 3: Components ✅ COMPLETE
- [x] Create NavItemLink.tsx with data-testid
- [x] Create NavGroupSection.tsx with aria-expanded/aria-controls
- [x] Create SidebarNavigation.tsx with loading/empty states

## Phase 4: Integration ✅ COMPLETE
- [x] Refactor MainLayout.tsx (424 → ~210 lines)
- [x] Update MoreMenuSheet.tsx (shared filtering + heading dividers)
- [x] Update navigation/index.ts exports
- [x] Verify BottomNavigation.tsx unchanged

## Phase 5: Validation ✅ COMPLETE
- [x] npm run typecheck passes
- [x] npm run lint passes
- [x] npm run build passes
- [ ] Visual: Provider view — Clinical + Staff & Organization groups
- [ ] Visual: Platform Owner view — Admin group
- [ ] Visual: Provider Partner view — flat list
- [ ] Collapse/expand persists across refresh
- [ ] Active route auto-expands its parent group
- [ ] Keyboard: Tab + Enter/Space on group headers
- [ ] Screen reader: aria-expanded announced
- [ ] E2E selectors: data-testid queryable

## Phase 6: GitHub Actions Node.js 24 Upgrade ✅ COMPLETE
- [x] Upgrade all 9 workflow files (27 deprecated action instances)
- [x] actions/checkout v4→v5, actions/setup-node v4→v5
- [x] docker/build-push-action v5→v7, docker/login-action v3→v4
- [x] docker/metadata-action v5→v6, docker/setup-buildx-action v3→v4
- [x] azure/setup-kubectl v3→v4 (still Node.js 20 upstream — no fix available)
- [x] All 5 deploy pipelines passed
- [x] Only remaining warning: azure/setup-kubectl@v4 (upstream issue)

## Current Status
**Phase**: 5 (Validation — manual testing remaining for nav tree)
**Status**: ✅ Code complete, deployed, CI/CD upgraded
**Last Updated**: 2026-03-25
**Next Step**: Manual testing of nav tree with different org_types (provider, platform_owner, provider_partner). Also verify collapse/expand localStorage persistence, keyboard nav, and screen reader announcements.
