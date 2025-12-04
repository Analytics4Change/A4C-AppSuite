# Plan: Add Email Verification Field to Provider Admin Card

## Summary
Add an email confirmation field directly below the email field in the Provider Admin card on the organizations/create route. The confirmation field must:
- Prevent pasting (force manual re-entry)
- Validate that email and confirmation match exactly

## Scope
- **Provider Admin card only** (not Billing Contact)
- **Paste disabled on confirmation field only** (email field allows paste)

---

## Implementation Steps

### 1. Update Type Definition
**File**: `frontend/src/types/organization.types.ts`

Add `emailConfirmation` field to `ContactFormData` interface:
```typescript
export interface ContactFormData {
  label: string;
  type: 'billing' | 'technical' | 'emergency' | 'a4c_admin';
  firstName: string;
  lastName: string;
  email: string;
  emailConfirmation?: string;  // NEW: Optional, only used for Provider Admin
  title?: string;
  department?: string;
}
```

### 2. Update Default Constants
**File**: `frontend/src/constants/organization.constants.ts`

Add `emailConfirmation: ''` to `providerAdminContact` in `DEFAULT_ORGANIZATION_FORM` (line ~240):
```typescript
providerAdminContact: {
  // ...existing fields
  email: '',
  emailConfirmation: '',  // NEW
  // ...
}
```

### 3. Add Validation Rule
**File**: `frontend/src/utils/organization-validation.ts`

Add email match validation after line 308 (provider admin email validation):
```typescript
// NEW: Email confirmation must match email for Provider Admin
if (data.providerAdminContact.email !== data.providerAdminContact.emailConfirmation) {
  addError(
    errors,
    'providerAdminContact.emailConfirmation',
    'Email addresses must match'
  );
}
```

### 4. Update ContactInput Component
**File**: `frontend/src/components/organizations/ContactInput.tsx`

#### 4a. Add prop for email confirmation visibility
```typescript
interface ContactInputProps extends Omit<ComponentPropsWithoutRef<"div">, "onChange"> {
  value: ContactFormData;
  onChange: (contact: ContactFormData) => void;
  disabled?: boolean;
  showEmailConfirmation?: boolean;  // NEW: Only true for Provider Admin
}
```

#### 4b. Add email confirmation field (after line 168)
Insert new field block directly after the Email field:
```tsx
{/* Email Confirmation (Provider Admin only) */}
{showEmailConfirmation && (
  <div className="grid grid-cols-[160px_1fr] items-start gap-4">
    <label className="block text-sm font-medium text-gray-700">
      Confirm Email<span className="text-red-500">*</span>
    </label>
    <input
      type="email"
      value={value.emailConfirmation || ''}
      onChange={(e) => handleChange("emailConfirmation", e.target.value)}
      onPaste={(e) => e.preventDefault()}  // Disable paste
      disabled={disabled}
      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
      aria-label="Confirm email address"
      aria-required="true"
      autoComplete="off"  // Discourage autofill
    />
  </div>
)}
```

### 5. Update OrganizationCreatePage
**File**: `frontend/src/pages/organizations/OrganizationCreatePage.tsx`

Pass `showEmailConfirmation={true}` to the Provider Admin ContactInput:
```tsx
<ContactInput
  value={formData.providerAdminContact}
  onChange={(contact) => viewModel.updateField('providerAdminContact', contact)}
  disabled={isSubmitting}
  showEmailConfirmation={true}  // NEW
/>
```

---

## Files to Modify
1. `frontend/src/types/organization.types.ts` - Add type
2. `frontend/src/constants/organization.constants.ts` - Add default
3. `frontend/src/utils/organization-validation.ts` - Add validation
4. `frontend/src/components/organizations/ContactInput.tsx` - Add field
5. `frontend/src/pages/organizations/OrganizationCreatePage.tsx` - Enable feature

## Testing Considerations
- Verify paste is blocked on confirmation field (Ctrl+V, right-click paste)
- Verify paste works normally on email field
- Verify validation error shows when emails don't match
- Verify form submits when emails match
- Verify tab order is correct (email -> confirmation -> title)
