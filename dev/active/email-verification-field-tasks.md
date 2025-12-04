# Tasks: Email Verification Field

## Phase 1: Type and Constant Updates ✅ COMPLETE

- [x] Add `emailConfirmation?: string` to `ContactFormData` interface in `organization.types.ts`
- [x] Add `emailConfirmation: ''` to `providerAdminContact` in `organization.constants.ts`

## Phase 2: Validation Logic ✅ COMPLETE

- [x] Add email match validation rule in `organization-validation.ts`
- [x] Ensure validation only triggers when both fields have values (avoid false errors during typing)

## Phase 3: UI Implementation ✅ COMPLETE

- [x] Add `showEmailConfirmation?: boolean` prop to `ContactInputProps` interface
- [x] Add email confirmation field JSX after email field in `ContactInput.tsx`
- [x] Implement `onPaste={(e) => e.preventDefault()}` on confirmation field
- [x] Add proper ARIA attributes (`aria-label`, `aria-required`)
- [x] Add `autoComplete="off"` to discourage browser autofill

## Phase 4: Integration ✅ COMPLETE

- [x] Pass `showEmailConfirmation={true}` to Provider Admin ContactInput in `OrganizationCreatePage.tsx`
- [x] Verify Billing Contact does NOT show confirmation field (no prop passed = false)

## Phase 5: Testing & Validation ⏸️ PENDING

- [ ] Manual test: Paste blocked on confirmation field (Ctrl+V)
- [ ] Manual test: Paste blocked via right-click context menu
- [ ] Manual test: Paste works normally on email field
- [ ] Manual test: Validation error shows when emails don't match
- [ ] Manual test: Form submits successfully when emails match
- [ ] Manual test: Tab order is correct (email → confirmation → title)
- [ ] Manual test: Screen reader announces confirmation field properly

## Success Validation Checkpoints

### Immediate Validation
- [x] TypeScript compiles without errors
- [ ] Application loads without runtime errors
- [ ] Email confirmation field appears on Provider Admin card only

### Feature Complete Validation
- [ ] Paste is blocked on confirmation field
- [ ] Validation error displays when emails don't match
- [ ] Form submits when emails match exactly
- [ ] Accessibility requirements met (ARIA, keyboard nav)

## Current Status

**Phase**: Phase 5 - Testing & Validation
**Status**: ⏸️ PENDING (implementation complete, manual testing needed)
**Last Updated**: 2025-12-04
**Next Step**: Start development server and manually test the feature
