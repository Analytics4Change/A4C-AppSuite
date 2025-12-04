# Context: Email Verification Field

## Decision Record

**Date**: 2025-12-04
**Feature**: Email Verification Field for Provider Admin
**Goal**: Add an email confirmation field to the Provider Admin card to prevent typos in critical admin email addresses.

### Key Decisions
1. **Scope**: Provider Admin card only (not Billing Contact) - this is the critical contact that receives admin invitations
2. **Paste Prevention**: Only on confirmation field - users can paste into the email field, but must manually type the confirmation
3. **Optional Type Field**: `emailConfirmation` is optional on `ContactFormData` interface since only Provider Admin uses it
4. **Component Prop Pattern**: Use `showEmailConfirmation` prop on `ContactInput` rather than creating a separate component
5. **Validation Location**: Email match validation in `validateOrganizationForm()` function, specific to Provider Admin contact

## Technical Context

### Architecture
This feature follows the existing MVVM pattern in the frontend:
- **View**: `ContactInput.tsx` renders the email confirmation field conditionally
- **ViewModel**: `OrganizationFormViewModel.ts` manages form state (no changes needed - generic field handling)
- **Validation**: `organization-validation.ts` contains form validation logic

### Tech Stack
- React 19 with TypeScript
- MobX for state management
- Tailwind CSS for styling
- Radix UI for base components

### Dependencies
- Extends existing `ContactFormData` type
- Uses existing `ContactInput` component
- Integrates with existing form validation flow

## File Structure

### Existing Files Modified
- `frontend/src/types/organization.types.ts` - Add `emailConfirmation?: string` to `ContactFormData`
- `frontend/src/constants/organization.constants.ts` - Add default value for provider admin
- `frontend/src/utils/organization-validation.ts` - Add email match validation rule
- `frontend/src/components/organizations/ContactInput.tsx` - Add conditional email confirmation field
- `frontend/src/pages/organizations/OrganizationCreatePage.tsx` - Pass `showEmailConfirmation={true}` prop

### New Files Created
None - all changes are to existing files

## Related Components

- `OrganizationCreatePage.tsx` - Parent page that renders ContactInput
- `OrganizationFormViewModel.ts` - ViewModel managing form state
- `ContactInput.tsx` - Reusable contact form component (being extended)

## Key Patterns and Conventions

### Paste Prevention Pattern
```tsx
onPaste={(e) => e.preventDefault()}
```
Standard browser event prevention - simple and widely supported.

### Conditional Field Rendering Pattern
```tsx
{showEmailConfirmation && (
  <div>...</div>
)}
```
Follows existing patterns in the codebase for optional form sections.

### Validation Error Pattern
```typescript
addError(errors, 'providerAdminContact.emailConfirmation', 'Email addresses must match');
```
Uses dot-notation field paths consistent with existing validation.

## Reference Materials

- Existing ContactInput component: `frontend/src/components/organizations/ContactInput.tsx`
- Validation utilities: `frontend/src/utils/organization-validation.ts`
- Organization types: `frontend/src/types/organization.types.ts`

## Important Constraints

1. **WCAG 2.1 Level AA Compliance**: All new fields must have proper ARIA attributes
2. **Tab Order**: Email confirmation must be in logical tab sequence (after email, before title)
3. **MobX Reactivity**: Changes must work with observable state management
4. **Autofill Behavior**: Use `autoComplete="off"` to discourage browser autofill on confirmation field

## Why This Approach?

### Chosen: Prop-based conditional rendering
- **Pro**: Reuses existing `ContactInput` component
- **Pro**: Minimal code changes
- **Pro**: Clear intent via prop name
- **Con**: Slightly larger ContactInput component

### Rejected: Separate ProviderAdminContactInput component
- Would duplicate most of ContactInput code
- More maintenance overhead
- Not justified for a single additional field

### Rejected: Always show confirmation on all contacts
- Provider Admin is the only critical email for workflow invitations
- Billing contact emails are less critical (can be corrected later)
- Reduces form complexity for billing section
