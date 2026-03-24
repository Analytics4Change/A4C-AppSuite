# Implementation Plan: Navigation Pane Tree Reorganization

## Executive Summary

Reorganize the left navigation sidebar from a flat list of 12 items into a collapsible tree structure with 1-level-deep groups. Provider sees "Clinical" + "Staff & Organization" groups; platform_owner sees "Admin" group; provider_partner sees flat list. No routes change. Expand/collapse state persists in localStorage.

## Architecture

- `navigation.types.ts` — NavItem, NavGroup, NavEntry discriminated union
- `navigation.config.ts` — Static NAVIGATION_CONFIG array
- `useFilteredNavEntries.ts` — Shared filtering hook (org_type + async hasPermission, fail-closed per item)
- `useNavExpansion.ts` — localStorage persistence + auto-expand active group
- `NavItemLink.tsx` — NavLink wrapper with glass styling + data-testid
- `NavGroupSection.tsx` — Collapsible group with aria-expanded/aria-controls
- `SidebarNavigation.tsx` — Top-level nav component with loading/empty states
- `MainLayout.tsx` — Refactored from 424 → ~210 lines
- `MoreMenuSheet.tsx` — Now uses shared filtering with section heading dividers

## Architecture Review Remediation

| Finding | Severity | Resolution |
|---------|----------|-----------|
| M1: No data-testid | Major | Added to all components |
| M2: No localStorage error handling | Major | Defensive try/catch + fallback |
| M3: Blank sidebar on filter failure | Major | Reports/Settings invariant + fallback message |
| m1: hasPermission fail-closed | Minor | Individual try/catch per item |
| m2: aria-controls/id pairing | Minor | Explicit IDs: nav-group-{key}-items |
| m3: MoreMenuSheet clarity | Minor | Flat list with semantic h3 dividers |
| m4: Line estimate | Minor | Adjusted to ~140 lines |
