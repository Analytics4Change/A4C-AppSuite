# Tasks: Organization Form Styling to Match Medication Management

**Feature**: Organization Form UI/UX Improvements
**Status**: ✅ COMPLETE
**Last Updated**: 2025-11-18

## Phase 1: Initial Styling Investigation ✅ COMPLETE

- [x] Read wireframe images from `~/tmp/`
- [x] Review medication management glassmorphic patterns
- [x] Apply glassmorphic UI to OrganizationCreatePage
- [x] Restructure to 9-card layout (3 sections × 3 cards each)
- [x] Add light theme gradient background
- [x] Add hover effects to cards

## Phase 2: Horizontal Label Layout ✅ COMPLETE

- [x] Convert Card 1 inputs to horizontal layout (label left, input right)
- [x] Use grid pattern: `grid-cols-[160px_1fr]`
- [x] Update all labels to text-right alignment
- [x] Test responsive behavior

## Phase 3: Match Medication Management Styling ✅ COMPLETE

### Label Alignment
- [x] Change all labels from text-right to text-left in ContactInput
- [x] Change all labels from text-right to text-left in AddressInput
- [x] Change all labels from text-right to text-left in PhoneInputEnhanced
- [x] Change all labels in OrganizationCreatePage Card 1 to text-left

### Border Visibility Fix
- [x] Research medication border color (found: border-gray-300)
- [x] Update ContactInput wrapper: add shadow, remove border-gray-200
- [x] Update AddressInput wrapper: add shadow, remove border-gray-200
- [x] Update PhoneInputEnhanced wrapper: add shadow, remove border-gray-200

### Input Styling
- [x] Update all ContactInput inputs to medication pattern
- [x] Update all AddressInput inputs to medication pattern
- [x] Update all PhoneInputEnhanced inputs to medication pattern
- [x] Change all borders to border-gray-300
- [x] Add shadow-sm to all inputs
- [x] Add focus:border-blue-500 focus:ring-blue-500 to all inputs

### Label Styling
- [x] Update all labels to: block text-sm font-medium text-gray-700
- [x] Change asterisks from text-destructive to text-red-500

## Phase 4: Card Width Increase ✅ COMPLETE

- [x] Calculate 80% increase: 72rem × 1.8 = 130rem
- [x] Update OrganizationCreatePage container: max-w-6xl → max-w-[130rem]
- [x] Verify cards are wider in deployment

## Phase 5: Remove All Hints ✅ COMPLETE

### Page-Level Hints
- [x] Remove page instruction text in OrganizationCreatePage line 116
- [x] Remove Organization Name placeholder (line 234)
- [x] Remove Display Name placeholder (line 258)

### Component-Level Hints
- [x] Remove Contact Type placeholder in ContactInput (line 88)
- [x] Remove Address Type placeholder in AddressInput (line 87)
- [x] Remove Phone Type placeholder in PhoneInputEnhanced (line 104)
- [x] Remove Referring Partner placeholders in ReferringPartnerDropdown (line 99)

### Accessibility Verification
- [x] Verify all aria-label attributes remain
- [x] Verify all aria-describedby attributes remain
- [x] Verify all aria-required attributes remain

## Phase 6: Section Heading and Layout ✅ COMPLETE

- [x] Convert "Organization Type" label to h3 section heading
- [x] Change heading text to "Organization Info"
- [x] Add horizontal layout to Organization Type dropdown
- [x] Match heading style: text-lg font-semibold text-gray-900 mb-4

## Phase 7: Standardize Card 1 Components for Safari ✅ COMPLETE

- [x] Convert Organization Type from SelectDropdown to Radix UI Select
- [x] Convert Partner Type from SelectDropdown to Radix UI Select
- [x] Convert Timezone from SelectDropdown to Radix UI Select
- [x] Convert Organization Name from Input component to native input
- [x] Convert Display Name from Input component to native input
- [x] Update SubdomainInput to use native input instead of Input component
- [x] Apply consistent styling: border-gray-300, shadow-sm, focus:ring-blue-500

## Phase 8: Remove Duplicate Labels ✅ COMPLETE

- [x] Convert Label components to native label elements with text-gray-700
- [x] Update SubdomainInput to horizontal grid layout (grid-cols-[160px_1fr])
- [x] Update ReferringPartnerDropdown to horizontal grid layout
- [x] Remove external grid wrappers from SubdomainInput call
- [x] Remove external grid wrappers from ReferringPartnerDropdown call
- [x] Standardize asterisk color to text-red-500

## Deployment Tasks ✅ COMPLETE

- [x] Build frontend (automated via GitHub Actions)
- [x] Commit all changes to main branch
- [x] Push to trigger deployment workflow
- [x] Verify deployment completes successfully
- [x] Check deployed pods are running latest image

## Testing Tasks ⏸️ PENDING (Manual User Testing)

- [ ] Visual verification: Cards are 80% wider
- [ ] Visual verification: Borders are visible (gray-300)
- [ ] Visual verification: Labels are left-aligned
- [ ] Visual verification: No placeholder text visible
- [ ] Visual verification: "Organization Info" heading appears
- [ ] Visual verification: Organization Type dropdown horizontal layout
- [ ] Functional testing: Form submission still works
- [ ] Functional testing: Validation still works
- [ ] Accessibility testing: Screen reader announces fields correctly

## Current Status

**Phase**: All Phases Complete (8/8)
**Status**: ✅ COMPLETE - Styling work done
**Last Updated**: 2025-11-18
**Completed**: OrganizationBootstrapParams mismatch fixed (see dev/active/organization-params-mismatch-context.md)
**Next Step**: Address security advisor issues (see dev/active/security-advisor-issues-context.md)

## Commits

1. `ad3c11f7` - feat(frontend): Apply glassmorphic UI to OrganizationCreatePage
2. `5340b788` - feat(frontend): Restructure OrganizationCreatePage to 9-card layout
3. `2bd06fa5` - feat(frontend): Convert organization form inputs to horizontal label layout
4. `2c5ed167` - fix(frontend): Align organization form styling with medication management patterns
5. `35482d6d` - feat(frontend): Match organization forms to medication management styling
6. `4ab92bec` - feat(frontend): Clean up organization form - remove hints and add section heading
7. `89dc12a0` - feat(frontend): Update Organization Type section layout
8. `8f2b4855` - fix(frontend): Standardize Card 1 form controls to match Cards 2-9 styling
9. `1af5508a` - fix(frontend): Remove duplicate labels from Card 1 to match Cards 2-9 pattern

## Files Changed

- `frontend/src/pages/organizations/OrganizationCreatePage.tsx` (major refactor)
- `frontend/src/components/organizations/ContactInput.tsx` (322 lines changed)
- `frontend/src/components/organizations/AddressInput.tsx` (328 lines changed)
- `frontend/src/components/organizations/PhoneInputEnhanced.tsx` (222 lines changed)
- `frontend/src/components/organizations/ReferringPartnerDropdown.tsx` (horizontal grid layout)
- `frontend/src/components/organization/SubdomainInput.tsx` (horizontal grid layout, native input)

## Issue Discovered

**OrganizationBootstrapParams Mismatch** - Frontend sends params in wrong structure for workflow.
See: `dev/active/organization-params-mismatch-context.md`
