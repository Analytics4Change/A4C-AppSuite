# Context: Organization Form Styling to Match Medication Management

**Date Started**: 2025-11-17
**Date Completed**: 2025-11-18
**Status**: ✅ COMPLETE - All styling updates deployed
**Branch**: main
**Related Issue**: Organization form UI/UX improvements (continuation of organization-permission-bugfix)

## Objective

Update OrganizationCreatePage and related components to match medication management look and feel exactly, following medication management styling patterns instead of custom patterns.

## Key Decisions

### 1. **Match Medication Management Styling Exactly** - 2025-11-18
- REQUIREMENT: Use exact same classes as medication management components
- Do NOT create custom styling patterns
- Border color: `border-gray-300` (NOT `border-gray-200`)
- Component wrapper: `bg-white shadow rounded-lg p-6` (NOT `border border-gray-200`)
- Input styling: Exact medication pattern with `border-gray-300 shadow-sm`
- Label styling: `block text-sm font-medium text-gray-700`

### 2. **Card Width Increase** - 2025-11-18
- Increased all 9 cards by 80%: `max-w-6xl` → `max-w-[130rem]`
- Calculation: 72rem × 1.8 = 130rem (2080px max-width)
- User explicitly requested 80% wider cards

### 3. **Remove All Visual Hints** - 2025-11-18
- Keep ARIA attributes for screen readers (aria-label, aria-describedby, etc.)
- Remove ALL placeholder text from inputs
- Remove ALL dropdown placeholder text
- Remove page instruction text
- Accessibility remains intact with ARIA

### 4. **Section Heading Pattern** - 2025-11-18
- Convert "Organization Type" from label to section heading
- Heading text: "Organization Info" (not "Organization Type")
- Match Cards 2 & 3 pattern: `<h3 className="text-lg font-semibold text-gray-900 mb-4">`
- All fields below heading use horizontal layout

## Implementation Summary

### Phase 1: Initial Glassmorphic Styling (2025-11-17)
- Commits: 5340b788, ad3c11f7
- Applied glassmorphic UI with backdrop-filter and blur effects
- Restructured to 9-card layout (3 cards each for General Info, Billing, Technical)
- Light theme gradient: from-gray-50 via-white to-blue-50

### Phase 2: Horizontal Label Layout (2025-11-17)
- Commit: 2bd06fa5
- Converted all inputs to horizontal label layout
- Pattern: `grid grid-cols-[160px_1fr]` with label on left, input on right
- Updated all fields in Card 1 (Organization Type through Referring Partner)

### Phase 3: Match Medication Management Styling (2025-11-18)
- Commits: 2c5ed167, 35482d6d
- Changed label alignment from `text-right` to `text-left`
- Added light gray border boxes to ContactInput, AddressInput, PhoneInputEnhanced
- Fixed border color from `border-gray-200` to `border-gray-300`
- Updated all inputs to use exact medication styling

### Phase 4: Card Width Increase (2025-11-18)
- Commit: 35482d6d
- Increased card container width by 80%
- Updated component wrappers, labels, and inputs to medication styling
- Removed all placeholder text

### Phase 5: Remove Hints and Add Section Heading (2025-11-18)
- Commits: 4ab92bec, 89dc12a0
- Removed page instruction text
- Removed 7 placeholder hints across 5 files
- Converted "Organization Type" to "Organization Info" section heading
- Added horizontal layout to Organization Type dropdown

### Phase 6: Standardize Card 1 Components for Safari (2025-11-18)
- Commit: 8f2b4855
- Converted native `<select>` (SelectDropdown) to Radix UI Select for Organization Type, Partner Type, Timezone
- Converted `<Input>` component to native `<input>` for Organization Name, Display Name
- Updated SubdomainInput to use native input instead of Input component
- All Card 1 now matches Cards 2-9 styling (border-gray-300, shadow-sm, focus:ring-blue-500)

### Phase 7: Remove Duplicate Labels (2025-11-18)
- Commit: 1af5508a
- Converted `<Label>` components to native `<label>` elements with text-gray-700
- Updated SubdomainInput to horizontal grid layout (grid-cols-[160px_1fr])
- Updated ReferringPartnerDropdown to horizontal grid layout
- Removed external grid wrappers from SubdomainInput and ReferringPartnerDropdown calls
- Standardized asterisk color to text-red-500 across all labels
- All Card 1 fields now have single visible labels (no duplicates)

## Files Modified

### OrganizationCreatePage.tsx
**Major Changes**:
- Card width: `max-w-6xl` → `max-w-[130rem]` (80% wider)
- Removed page instruction: "Complete all sections to onboard..."
- Removed placeholders: "e.g., Sunshine Recovery Center", "e.g., Sunshine Recovery"
- Converted to section heading: "Organization Info"
- Added horizontal layout to Organization Type dropdown
- All labels changed to `text-left` (from `text-right`)

### ContactInput.tsx
**Major Changes**:
- Wrapper: `bg-white shadow rounded-lg p-6` (removed `border border-gray-200`)
- All 7 labels: `block text-sm font-medium text-gray-700`
- All 6 inputs: `mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm`
- Removed placeholder: "Select type..."
- Required asterisks: `text-red-500` (from `text-destructive`)

### AddressInput.tsx
**Major Changes**:
- Wrapper: `bg-white shadow rounded-lg p-6`
- All 7 labels: `block text-sm font-medium text-gray-700`
- All 6 inputs: medication styling with `border-gray-300`
- Removed placeholder: "Select type..."

### PhoneInputEnhanced.tsx
**Major Changes**:
- Wrapper: `bg-white shadow rounded-lg p-6`
- All 4 labels: `block text-sm font-medium text-gray-700`
- All 3 inputs: medication styling
- Removed placeholder: "Select type..."

### ReferringPartnerDropdown.tsx
**Changes**:
- Removed placeholders: "Loading partners...", "Select referring partner..."
- Converted to horizontal grid layout (grid-cols-[160px_1fr]) - 2025-11-18
- Changed label to text-gray-700 color
- Updated Select.Trigger to match other selects (border-gray-300, shadow-sm, focus:ring-blue-500)
- Changed description text to text-gray-500

### SubdomainInput.tsx
**Changes** (2025-11-18):
- Replaced Input component with native HTML input
- Converted from vertical (space-y-2) to horizontal grid layout (grid-cols-[160px_1fr])
- Changed label to text-gray-700 color
- Removed unused Label import

## Important Constraints

### 1. **Border Color Visibility** - Discovered 2025-11-18
- `border-gray-200` (#e5e7eb) is nearly invisible on white backgrounds
- `border-gray-300` (#d1d5db) is darker and clearly visible
- ALWAYS use `border-gray-300` for visible borders on white backgrounds
- This is what medication management uses

### 2. **Component Wrapper Pattern** - 2025-11-18
- Medication management uses: `bg-white shadow rounded-lg p-6`
- DO NOT use: `border border-gray-200` on wrappers
- The `shadow` provides depth, border is NOT needed on wrapper

### 3. **Label Styling Pattern** - 2025-11-18
- Exact medication pattern: `block text-sm font-medium text-gray-700`
- Font size: `text-sm` (0.875rem / 14px)
- Font weight: `font-medium` (500)
- Font color: `text-gray-700` (#374151)

### 4. **Input Styling Pattern** - 2025-11-18
- Exact medication pattern: `mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm`
- Border: `border-gray-300` (visible gray)
- Shadow: `shadow-sm` for subtle depth
- Focus: Blue borders and rings (`focus:border-blue-500 focus:ring-blue-500`)

### 5. **Radix UI Select Value Component** - 2025-11-18
- Remove placeholder from `<Select.Value />` by passing no props
- Before: `<Select.Value placeholder="Select type..." />`
- After: `<Select.Value />`
- ARIA labels provide accessibility without visual placeholder

## Verification

**Visual Verification Needed**:
- [ ] Cards are 80% wider (2080px max-width vs 1152px)
- [ ] Component borders visible (gray-300, not invisible gray-200)
- [ ] All labels left-aligned with medication font/size
- [ ] All inputs match medication styling exactly
- [ ] No placeholder text visible in any inputs
- [ ] "Organization Info" heading appears above Organization Type field
- [ ] Organization Type dropdown uses horizontal layout (not full-width)

**Deployment Verification**:
- ✅ All commits pushed to main branch
- ✅ GitHub Actions deployment workflows completed
- ✅ Latest commits: 1af5508a, 8f2b4855, 89dc12a0, 4ab92bec, 35482d6d, 2c5ed167, 2bd06fa5
- URL: https://a4c.firstovertheline.com

## Issue Discovered During Testing

### OrganizationBootstrapParams Structural Mismatch - 2025-11-18
While verifying form data wiring, discovered a pre-existing issue:
- Frontend sends `contacts`, `addresses`, `phones` at root level
- Workflow expects them inside `orgData`
- This will cause workflow to fail when trying to access `params.orgData.contacts`
- **See**: `dev/active/organization-params-mismatch-context.md` for fix plan
- **Priority**: HIGH - must fix before organization creation works end-to-end

## Medication Management Styling Reference

**Component Wrapper** (from MedicationPrescriptionForm.tsx):
```tsx
<div className="bg-white shadow rounded-lg p-6">
```

**Label Pattern** (from medication forms):
```tsx
<label className="block text-sm font-medium text-gray-700">
  Field Name<span className="text-red-500">*</span>
</label>
```

**Input Pattern** (from medication forms):
```tsx
<input
  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
/>
```

**Section Heading Pattern** (from medication forms):
```tsx
<h3 className="text-lg font-semibold text-gray-900 mb-4">
  Section Name
</h3>
```

## Lessons Learned

### 1. **Always Match Existing Patterns Exactly** - 2025-11-18
- Don't create custom styling when existing patterns exist
- Use exact class strings from reference components
- Medication management is the design system reference

### 2. **Border Color Selection Matters** - 2025-11-18
- One Tailwind shade difference can mean invisible vs visible
- `gray-200` is too light for borders on white
- `gray-300` is the medication standard for a reason

### 3. **User Knows What They Want** - 2025-11-18
- "Use the EXACT SAME look and feel" means copying classes exactly
- "80% wider" means calculate and apply 80% increase
- "No hints" means remove ALL visible hints (keep ARIA)

### 4. **Section Headings vs Field Labels** - 2025-11-18
- Section headings group related fields: `<h3>` with larger font
- Field labels identify specific inputs: `<label>` with smaller font
- When user wants heading, don't use a label

## Reference Materials

- Medication management forms: `frontend/src/examples/MedicationPrescriptionForm.tsx`
- ReasonInput component: `frontend/src/components/ui/ReasonInput.tsx`
- Medication views: `frontend/src/views/medication/`

## After /clear, run:

```bash
# View the completed styling work
cat dev/active/organization-form-styling-context.md

# View the next action item (params mismatch fix)
cat dev/active/organization-params-mismatch-context.md

# Verify deployment
gh run list --workflow="Deploy Frontend" --limit 1

# Test the form visually
open https://a4c.firstovertheline.com/organizations/create
```

**Styling Feature is COMPLETE** - All UI/UX styling work is done and deployed.

**Next Action**: Fix OrganizationBootstrapParams mismatch (see organization-params-mismatch-context.md)
