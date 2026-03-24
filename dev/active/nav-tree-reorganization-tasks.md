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

## Current Status
**Phase**: 5 (Validation — manual testing remaining)
**Status**: ✅ Code complete, build passes
**Last Updated**: 2026-03-24
**Next Step**: Manual testing with different org_types
