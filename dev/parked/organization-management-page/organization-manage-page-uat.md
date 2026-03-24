# UAT: Organization Manage Page

> **Target**: Claude for Chrome (LLM browser automation agent)
> **Route**: `/organizations/manage`
> **Date**: 2026-03-02

---

## BLOCKING DEFECT PROTOCOL

> **Every `data-testid` selector referenced in this test plan MUST resolve to exactly one DOM element.**
> If a `[data-testid="..."]` query returns zero elements, the test case is a **FAIL** (not a skip).
> Report the exact testid value, the test case ID, and the step number.
> Do not attempt workarounds (text selectors, DOM traversal) -- the missing testid indicates a code defect.

## IMPORTANT: Test Infrastructure Notice

> If any test step references a `data-testid` selector and the element cannot be found,
> this is a TEST FAILURE -- not a test skip. Missing `data-testid` attributes indicate
> that the prerequisite code changes were not applied correctly.
> Stop execution and report the missing testid as a blocking defect.

---

## Prerequisites

### Environment Setup
1. `cd frontend && npm install`
2. `npm run dev` (mock mode, port 5173 or 3000)
3. Open browser to `http://localhost:5173`

### Profile Switching
Switch profiles using the debug profile switcher in the app header.

| Profile | Email | Sees Left Panel? |
|---------|-------|-----------------|
| super_admin | super.admin@example.com | Yes (platform owner) |
| provider_admin | dev@example.com | No (auto-selects own org) |
| partner_admin | partner.admin@example.com | No (auto-selects own org) |

---

### data-testid Selector Reference

#### Page Shell

| Selector | Element | Condition |
|----------|---------|-----------|
| `org-manage-page` | Page root container | Always present |
| `org-manage-back-btn` | "Back to Settings" button | Always present |
| `org-manage-heading` | "Organization Management" h1 | Always present |
| `org-manage-error-banner` | Error alert banner | Only when error is present |
| `org-manage-error-dismiss-btn` | Dismiss button inside error banner | Only when error is present |

#### Left Panel (platform owner only)

| Selector | Element | Condition |
|----------|---------|-----------|
| `org-list-panel` | Left panel card | Platform owner only |
| `org-list-refresh-btn` | Refresh icon button | Platform owner only |
| `org-list-search-input` | Search text input | Platform owner only |
| `org-list-filter-all-btn` | "All" status filter button | Platform owner only |
| `org-list-filter-active-btn` | "Active" status filter button | Platform owner only |
| `org-list-filter-inactive-btn` | "Inactive" status filter button | Platform owner only |
| `org-list` | Org list container (`role="listbox"`) | Platform owner only |
| `org-list-loading` | Loading text | While loading |
| `org-list-empty` | "No organizations found" text | When list is empty |
| `org-list-item-{id}` | Org list item button (`role="option"`) | Per organization |
| `org-list-item-name` | Org display name text (inside list item) | Per organization |
| `org-list-item-type` | Org type text (inside list item) | Per organization |
| `org-list-item-status-badge` | Active/Inactive badge (inside list item) | Per organization |

#### Right Panel -- Empty State

| Selector | Element | Condition |
|----------|---------|-----------|
| `org-form-empty-state` | Empty state card | When no org is selected |

#### Right Panel -- Edit Mode

| Selector | Element | Condition |
|----------|---------|-----------|
| `org-inactive-banner` | Amber inactive warning banner | When selected org is inactive |
| `org-inactive-banner-reactivate-btn` | Reactivate button inside inactive banner | Platform owner + inactive org |
| `org-details-card` | Organization details card | When org is selected |
| `org-details-status-badge` | Active/Inactive status badge in card header | When org is selected |
| `org-details-loading` | "Loading details..." text | While details are loading |
| `org-details-submit-error` | Submission error alert | After failed save |
| `org-details-submit-error-dismiss-btn` | Dismiss button for submission error | After failed save |

#### Form Fields (identified by `id` attribute, not data-testid)

| Field ID | Label | Required | Editable By |
|----------|-------|----------|-------------|
| `org-name` | Organization Name | Yes | Platform owner only (when active) |
| `org-display-name` | Display Name | Yes | Any admin (when active) |
| `org-tax-number` | Tax Number | No | Any admin (when active) |
| `org-phone-number` | Phone Number | No | Any admin (when active) |
| `org-timezone` | Timezone | Yes | Any admin (when active) |

#### Read-Only Fields

| Selector | Field |
|----------|-------|
| `org-field-slug-value` | Slug (text) |
| `org-field-type-value` | Type (text) |
| `org-field-path-value` | Path (text) |

#### Form Actions

| Selector | Element | Condition |
|----------|---------|-----------|
| `org-form-unsaved-indicator` | "Unsaved changes" text | When form is dirty |
| `org-form-reset-btn` | Reset button | When form is dirty |
| `org-form-save-btn` | "Save Changes" button | When org is selected |

#### Entity Sections

| Selector | Element |
|----------|---------|
| `org-contacts-section` | Contacts card |
| `org-contacts-add-btn` | "Add" button for contacts |
| `org-contacts-empty` | "No contacts yet" text |
| `org-contact-row-{id}` | Contact row by ID |
| `org-contact-edit-btn-{id}` | Edit button for contact |
| `org-contact-delete-btn-{id}` | Delete button for contact |
| `org-addresses-section` | Addresses card |
| `org-addresses-add-btn` | "Add" button for addresses |
| `org-addresses-empty` | "No addresses yet" text |
| `org-address-row-{id}` | Address row by ID |
| `org-address-edit-btn-{id}` | Edit button for address |
| `org-address-delete-btn-{id}` | Delete button for address |
| `org-phones-section` | Phones card |
| `org-phones-add-btn` | "Add" button for phones |
| `org-phones-empty` | "No phones yet" text |
| `org-phone-row-{id}` | Phone row by ID |
| `org-phone-edit-btn-{id}` | Edit button for phone |
| `org-phone-delete-btn-{id}` | Delete button for phone |

Note: The add button testid is derived from the section testid by replacing `-section` with `-add-btn`. For example, `org-contacts-section` produces `org-contacts-add-btn`.

#### Entity Dialogs

| Selector | Element |
|----------|---------|
| `contact-dialog` | Contact add/edit dialog container (`role="dialog"`) |
| `contact-dialog-title` | Dialog title text |
| `contact-dialog-close-btn` | Close (X) button |
| `contact-dialog-cancel-btn` | Cancel button |
| `contact-dialog-save-btn` | Save button |
| `address-dialog` | Address add/edit dialog container (`role="dialog"`) |
| `address-dialog-title` | Dialog title text |
| `address-dialog-close-btn` | Close (X) button |
| `address-dialog-cancel-btn` | Cancel button |
| `address-dialog-save-btn` | Save button |
| `phone-dialog` | Phone add/edit dialog container (`role="dialog"`) |
| `phone-dialog-title` | Dialog title text |
| `phone-dialog-close-btn` | Close (X) button |
| `phone-dialog-cancel-btn` | Cancel button |
| `phone-dialog-save-btn` | Save button |

Entity dialog form fields use `id` attributes (not data-testid):

| Dialog | Field IDs |
|--------|-----------|
| Contact | `contact-first-name`, `contact-last-name`, `contact-email`, `contact-label`, `contact-type`, `contact-title`, `contact-department` |
| Address | `address-label`, `address-type`, `address-street1`, `address-street2`, `address-city`, `address-state`, `address-zip` |
| Phone | `phone-label`, `phone-type`, `phone-number`, `phone-extension` |

#### DangerZone Component

| Selector | Element | Condition |
|----------|---------|-----------|
| `danger-zone` | DangerZone section wrapper | Platform owner only |
| `danger-zone-toggle-btn` | Collapse/expand toggle (`aria-expanded`) | Platform owner only |
| `danger-zone-content` | Expanded content (`role="region"`) | When expanded |
| `danger-zone-deactivate-section` | Deactivate sub-section | Active org + expanded |
| `danger-zone-deactivate-btn` | "Deactivate Organization" button | Active org + expanded |
| `danger-zone-reactivate-section` | Reactivate sub-section | Inactive org + expanded |
| `danger-zone-reactivate-btn` | "Reactivate Organization" button | Inactive org + expanded |
| `danger-zone-delete-section` | Delete sub-section | Expanded |
| `danger-zone-delete-btn` | "Delete Organization" button | Expanded |
| `danger-zone-active-constraint` | "Must be deactivated" warning text | Active org + expanded |

#### ConfirmDialog Component

| Selector | Element |
|----------|---------|
| `confirm-dialog` | Dialog container (`role="alertdialog"`) |
| `confirm-dialog-backdrop` | Semi-transparent backdrop |
| `confirm-dialog-panel` | White dialog panel |
| `confirm-dialog-title` | Dialog title text |
| `confirm-dialog-message` | Dialog message text |
| `confirm-dialog-details-list` | Details bullet list (when details prop is set) |
| `confirm-dialog-close-btn` | Close (X) button |
| `confirm-dialog-cancel-btn` | Cancel button (label varies) |
| `confirm-dialog-confirm-btn` | Confirm button (label varies) |
| `confirm-dialog-confirm-text-input` | "Type DELETE" text input (delete flow only) |

#### AccessBlockedPage

| Selector | Element |
|----------|---------|
| `access-blocked-page` | Page root |
| `access-blocked-card` | Content card |
| `access-blocked-heading` | Heading text |
| `access-blocked-message` | Description text |
| `access-blocked-email` | User email display |
| `access-blocked-signout-btn` | Sign out button |

---

## Test Suites

### TS-01: Navigation & Page Load (5 cases)

---

#### TC-01-01: super_admin navigates to page and sees split layout
**Profile**: super_admin
**Precondition**: Logged in as super_admin, on any page

**Steps**:
1. Navigate to `http://localhost:5173/organizations/manage`
2. Wait for page to load -- verify `[data-testid="org-manage-page"]` is present
3. Check for left panel -- `[data-testid="org-list-panel"]`
4. Check for right panel empty state -- `[data-testid="org-form-empty-state"]`

**Expected**:
- Page container `org-manage-page` is visible
- Left panel `org-list-panel` is visible (platform owner sees the org list)
- Right panel shows empty state card `org-form-empty-state` with text "No Organization Selected"

---

#### TC-01-02: Page heading and subtitle are correct
**Profile**: super_admin
**Precondition**: On `/organizations/manage`

**Steps**:
1. Locate the heading -- `[data-testid="org-manage-heading"]`
2. Read the heading text
3. Read the subtitle text below the heading (the `<p>` sibling)

**Expected**:
- Heading text is "Organization Management"
- Subtitle text is "Manage organizations, lifecycle, and details"

---

#### TC-01-03: provider_admin sees no left panel and shows empty/loading state
**Profile**: provider_admin
**Precondition**: Switch to provider_admin profile (dev@example.com)

**Steps**:
1. Navigate to `http://localhost:5173/organizations/manage`
2. Wait for page to load -- verify `[data-testid="org-manage-page"]` is present
3. Check that left panel is NOT present -- `[data-testid="org-list-panel"]` should not exist
4. Check right panel state -- `[data-testid="org-form-empty-state"]`

**Expected**:
- `org-list-panel` does NOT exist in the DOM (provider_admin is not platform_owner)
- Right panel shows empty state with text "Loading..." and "Loading your organization details..."
- The page attempts to auto-select org_id `dev-org-660e8400-e29b-41d4-a716-446655440000`, but this ID does not exist in mock data, so the empty state remains

**Mock Limitation**: provider_admin's org_id does not match any mock org, so auto-select fails silently and the empty state persists.

---

#### TC-01-04: partner_admin sees no left panel
**Profile**: partner_admin
**Precondition**: Switch to partner_admin profile (partner.admin@example.com)

**Steps**:
1. Navigate to `http://localhost:5173/organizations/manage`
2. Wait for page to load -- verify `[data-testid="org-manage-page"]` is present
3. Check that left panel is NOT present -- `[data-testid="org-list-panel"]` should not exist

**Expected**:
- `org-list-panel` does NOT exist in the DOM
- Same behavior as provider_admin (auto-select fails for mock partner org_id)

**Mock Limitation**: partner_admin org_id does not match any mock org.

---

#### TC-01-05: Back button navigates to /settings
**Profile**: super_admin
**Precondition**: On `/organizations/manage`

**Steps**:
1. Click the back button -- `[data-testid="org-manage-back-btn"]`
2. Wait for navigation

**Expected**:
- Browser navigates to `/settings`
- Back button text includes "Back to Settings"

---

### TS-02: Organization List (9 cases)

---

#### TC-02-01: List loads with 9 orgs alphabetically sorted
**Profile**: super_admin
**Precondition**: On `/organizations/manage`, default "All" filter

**Steps**:
1. Wait for list to finish loading (no `[data-testid="org-list-loading"]` visible)
2. Locate the list container -- `[data-testid="org-list"]`
3. Count all `[role="option"]` elements inside the list

**Expected**:
- 9 organizations displayed (platform_owner "Analytics4Change" is filtered out by the ViewModel)
- First item: "ABC Healthcare" (ABC Healthcare Partners, alphabetical by `name`)
- Last item: "XYZ Medical" (XYZ Medical Group)
- Full sort order by display_name: ABC Healthcare, City Care, County Court, HealthIT, New Clinic, Summit Health, Sunrise Family, TechSolutions, XYZ Medical

---

#### TC-02-02: Each org item shows display_name, type, and status badge
**Profile**: super_admin
**Precondition**: List loaded with 9 orgs

**Steps**:
1. Locate the first org item -- `[data-testid="org-list-item-provider-abc-healthcare-id"]`
2. Inside that item, read `[data-testid="org-list-item-name"]`
3. Read `[data-testid="org-list-item-type"]`
4. Read `[data-testid="org-list-item-status-badge"]`

**Expected**:
- Name shows "ABC Healthcare" (the display_name)
- Type shows "provider"
- Status badge shows "Active" with green styling

---

#### TC-02-03: Active filter shows 8 orgs (Summit Health excluded)
**Profile**: super_admin
**Precondition**: List loaded, "All" filter currently selected

**Steps**:
1. Click the "Active" filter button -- `[data-testid="org-list-filter-active-btn"]`
2. Wait for list reload
3. Count `[role="option"]` elements inside `[data-testid="org-list"]`
4. Verify Summit Health is NOT in the list -- `[data-testid="org-list-item-provider-summit-health-id"]` should not exist

**Expected**:
- 8 organizations displayed (Summit Health Systems is inactive, excluded)
- `org-list-item-provider-summit-health-id` does not exist in the list
- Active filter button has selected styling (blue background)

---

#### TC-02-04: Inactive filter shows 1 org (Summit Health only)
**Profile**: super_admin
**Precondition**: List loaded

**Steps**:
1. Click the "Inactive" filter button -- `[data-testid="org-list-filter-inactive-btn"]`
2. Wait for list reload
3. Count `[role="option"]` elements inside `[data-testid="org-list"]`
4. Verify Summit Health IS in the list -- `[data-testid="org-list-item-provider-summit-health-id"]`

**Expected**:
- 1 organization displayed
- Summit Health item is visible with status badge "Inactive"

---

#### TC-02-05: All filter shows 9 orgs
**Profile**: super_admin
**Precondition**: A non-All filter is currently active (e.g., Inactive from TC-02-04)

**Steps**:
1. Click the "All" filter button -- `[data-testid="org-list-filter-all-btn"]`
2. Wait for list reload
3. Count `[role="option"]` elements inside `[data-testid="org-list"]`

**Expected**:
- 9 organizations displayed (all orgs except platform_owner)

---

#### TC-02-06: Search "ABC" filters to ABC Healthcare
**Profile**: super_admin
**Precondition**: All filter active, 9 orgs showing

**Steps**:
1. Click the search input -- `[data-testid="org-list-search-input"]`
2. Type "ABC"
3. Wait for filtered results

**Expected**:
- List shows 1 result: ABC Healthcare Partners
- `[data-testid="org-list-item-provider-abc-healthcare-id"]` is visible
- Other org items are not visible

---

#### TC-02-07: Search "xyz" (case-insensitive) shows XYZ Medical
**Profile**: super_admin
**Precondition**: Clear previous search first

**Steps**:
1. Clear the search input -- `[data-testid="org-list-search-input"]` set value to ""
2. Type "xyz" (lowercase)
3. Wait for filtered results

**Expected**:
- List shows 1 result: XYZ Medical Group
- `[data-testid="org-list-item-provider-xyz-medical-id"]` is visible
- Search is case-insensitive (typed "xyz" matches "XYZ Medical Group")

---

#### TC-02-08: Search "nonexistent" shows empty state
**Profile**: super_admin
**Precondition**: Clear previous search

**Steps**:
1. Clear the search input -- `[data-testid="org-list-search-input"]` set value to ""
2. Type "nonexistent"
3. Wait for filtered results
4. Locate empty state -- `[data-testid="org-list-empty"]`

**Expected**:
- `org-list-empty` is visible with text "No organizations found"
- No `[role="option"]` elements in the list

---

#### TC-02-09: Refresh button triggers list reload
**Profile**: super_admin
**Precondition**: Clear search, All filter, list showing orgs

**Steps**:
1. Click the refresh button -- `[data-testid="org-list-refresh-btn"]`
2. Observe the button icon briefly (the RefreshCw icon may show animation)
3. Wait for list to finish loading

**Expected**:
- RefreshCw icon inside the button has `animate-spin` class during loading
- After reload completes, list still shows 9 orgs
- No errors appear

---

### TS-03: Form Field Editability (6 cases)

---

#### TC-03-01: super_admin selects ABC Healthcare -- all fields editable
**Profile**: super_admin
**Precondition**: On manage page, no org selected

**Steps**:
1. Click ABC Healthcare in the list -- `[data-testid="org-list-item-provider-abc-healthcare-id"]`
2. Wait for details to load -- `[data-testid="org-details-card"]` appears
3. Check the `#org-name` input field `disabled` attribute
4. Check the `#org-display-name` input field `disabled` attribute
5. Check the `#org-tax-number` input field `disabled` attribute
6. Check the `#org-phone-number` input field `disabled` attribute
7. Check the `#org-timezone` input field `disabled` attribute

**Expected**:
- `org-form-empty-state` is gone, replaced by `org-details-card`
- `#org-name` is NOT disabled (super_admin = platform owner, can edit name)
- `#org-display-name` is NOT disabled
- `#org-tax-number` is NOT disabled
- `#org-phone-number` is NOT disabled
- `#org-timezone` is NOT disabled
- The list item has `aria-selected="true"`

---

#### TC-03-02: super_admin sees all expected form fields
**Profile**: super_admin
**Precondition**: ABC Healthcare selected (from TC-03-01)

**Steps**:
1. Verify `#org-name` input exists with label "Organization Name"
2. Verify `#org-display-name` input exists with label "Display Name"
3. Verify `#org-tax-number` input exists with label "Tax Number"
4. Verify `#org-phone-number` input exists with label "Phone Number"
5. Verify `#org-timezone` input exists with label "Timezone"

**Expected**:
- All 5 input fields are present with correct labels
- `#org-name` value is "ABC Healthcare Partners"
- `#org-display-name` value is "ABC Healthcare"
- `#org-timezone` value is "America/Los_Angeles"
- `#org-tax-number` is empty (mock returns null)
- `#org-phone-number` is empty (mock returns null)

---

#### TC-03-03: Read-only fields are displayed but not editable
**Profile**: super_admin
**Precondition**: ABC Healthcare selected

**Steps**:
1. Locate slug display -- `[data-testid="org-field-slug-value"]`
2. Locate type display -- `[data-testid="org-field-type-value"]`
3. Locate path display -- `[data-testid="org-field-path-value"]`
4. Verify these are plain text elements, not input fields

**Expected**:
- `org-field-slug-value` text is "abc-healthcare" (the subdomain)
- `org-field-type-value` text is "provider"
- `org-field-path-value` text is "a4c-platform-id.provider-abc-healthcare-id"
- All three are `<p>` elements (read-only, no input)

---

#### TC-03-04: Inactive org shows all fields disabled with inactive banner
**Profile**: super_admin
**Precondition**: On manage page

**Steps**:
1. Click Summit Health in the list -- `[data-testid="org-list-item-provider-summit-health-id"]`
2. Wait for details to load -- `[data-testid="org-details-card"]` appears
3. Check for inactive banner -- `[data-testid="org-inactive-banner"]`
4. Check `#org-name` input `disabled` attribute
5. Check `#org-display-name` input `disabled` attribute
6. Check `#org-timezone` input `disabled` attribute
7. Check status badge -- `[data-testid="org-details-status-badge"]`

**Expected**:
- `org-inactive-banner` is visible with text "Inactive Organization - Editing Disabled"
- Reactivate button visible in banner -- `[data-testid="org-inactive-banner-reactivate-btn"]`
- ALL form fields are disabled (`disabled` attribute is present)
- Status badge shows "Inactive"
- Save button is disabled -- `[data-testid="org-form-save-btn"]` has `disabled` attribute

---

#### TC-03-05: provider_admin cannot edit Organization Name
**Profile**: provider_admin
**Precondition**: This test requires manually selecting an org since auto-select fails for provider_admin mock profile. Use URL parameter instead.

**Steps**:
1. Navigate to `http://localhost:5173/organizations/manage`
2. Since provider_admin cannot see the left panel and auto-select fails, this field cannot be tested in mock mode for provider_admin

**Expected**:
- When a provider_admin views an active org, `#org-name` is disabled (`canEditName` is false for non-platform-owner)
- Other editable fields (`#org-display-name`, `#org-tax-number`, `#org-phone-number`, `#org-timezone`) are enabled

**Mock Limitation**: provider_admin org_id does not match any mock org, so the edit form never loads. This test case cannot be fully verified in mock mode. Document as known limitation.

---

#### TC-03-06: provider_admin -- non-name fields ARE editable
**Profile**: provider_admin
**Precondition**: Same limitation as TC-03-05

**Steps**:
1. (If org could be loaded) Check `#org-display-name` is NOT disabled
2. Check `#org-tax-number` is NOT disabled
3. Check `#org-phone-number` is NOT disabled
4. Check `#org-timezone` is NOT disabled

**Expected**:
- Display Name, Tax Number, Phone Number, and Timezone fields are editable for provider_admin on active orgs

**Mock Limitation**: Cannot verify -- provider_admin auto-select fails in mock mode. Document as known limitation.

---

### TS-04: Form Validation (7 cases)

---

#### TC-04-01: Clear Organization Name shows error on blur
**Profile**: super_admin
**Precondition**: ABC Healthcare selected (active org, all fields editable)

**Steps**:
1. Click into `#org-name` input
2. Select all text and delete it (clear the field)
3. Click away from the field (blur) -- click on `#org-display-name`
4. Look for error message associated with `#org-name` (the `[role="alert"]` below the input, identified by `id="org-name-error"`)

**Expected**:
- Error text "Organization name is required" appears below the field
- `#org-name` has `aria-invalid="true"`
- `#org-name` has `aria-describedby="org-name-error"`

---

#### TC-04-02: Clear Display Name shows error on blur
**Profile**: super_admin
**Precondition**: ABC Healthcare selected

**Steps**:
1. Click into `#org-display-name` input
2. Clear the field
3. Blur the field
4. Look for error message `id="org-display-name-error"`

**Expected**:
- Error text "Display name is required" appears below the field
- `#org-display-name` has `aria-invalid="true"`

---

#### TC-04-03: Clear Timezone shows error on blur
**Profile**: super_admin
**Precondition**: ABC Healthcare selected

**Steps**:
1. Click into `#org-timezone` input
2. Clear the field
3. Blur the field
4. Look for error message `id="org-timezone-error"`

**Expected**:
- Error text "Timezone is required" appears below the field
- `#org-timezone` has `aria-invalid="true"`

---

#### TC-04-04: Save button disabled when form has errors
**Profile**: super_admin
**Precondition**: ABC Healthcare selected, Name field cleared (from TC-04-01)

**Steps**:
1. Ensure `#org-name` is empty and has been blurred (showing error)
2. Check `[data-testid="org-form-save-btn"]` disabled state

**Expected**:
- Save button has `disabled` attribute
- Button cannot be clicked

---

#### TC-04-05: Save button disabled when form is pristine
**Profile**: super_admin
**Precondition**: ABC Healthcare freshly selected (no changes made)

**Steps**:
1. Select ABC Healthcare (fresh load, no edits)
2. Check `[data-testid="org-form-save-btn"]` disabled state

**Expected**:
- Save button has `disabled` attribute (no changes = pristine form, `canSubmit` is false)

---

#### TC-04-06: Tax Number and Phone Number are optional
**Profile**: super_admin
**Precondition**: ABC Healthcare selected

**Steps**:
1. Verify `#org-tax-number` has no `aria-required` attribute (or `aria-required="false"`)
2. Verify `#org-phone-number` has no `aria-required` attribute
3. Clear both fields if they have values
4. Blur both fields
5. Check that no error messages appear for either field

**Expected**:
- No error messages for empty Tax Number or Phone Number
- These fields have `placeholder="Optional"`
- No required indicator (*) next to their labels

---

#### TC-04-07: Whitespace-only Name shows error on blur
**Profile**: super_admin
**Precondition**: ABC Healthcare selected

**Steps**:
1. Click into `#org-name` input
2. Clear the field
3. Type "   " (spaces only)
4. Blur the field

**Expected**:
- Error text "Organization name is required" appears (`.trim()` produces empty string)
- `#org-name` has `aria-invalid="true"`

---

### TS-05: Save, Dirty State, Reset (3 cases)

---

#### TC-05-01: Changing Display Name shows unsaved indicator and Reset button
**Profile**: super_admin
**Precondition**: ABC Healthcare selected, form is pristine

**Steps**:
1. Click into `#org-display-name` input
2. Append " Updated" to the current value (e.g., "ABC Healthcare Updated")
3. Check for unsaved indicator -- `[data-testid="org-form-unsaved-indicator"]`
4. Check for Reset button -- `[data-testid="org-form-reset-btn"]`

**Expected**:
- `org-form-unsaved-indicator` is visible with text "Unsaved changes"
- `org-form-reset-btn` is visible with text "Reset"
- Save button is now enabled (not disabled)

---

#### TC-05-02: Click Reset reverts form and hides unsaved indicator
**Profile**: super_admin
**Precondition**: Form has unsaved changes (from TC-05-01)

**Steps**:
1. Click Reset button -- `[data-testid="org-form-reset-btn"]`
2. Check `#org-display-name` value
3. Check for unsaved indicator -- `[data-testid="org-form-unsaved-indicator"]`
4. Check for Reset button -- `[data-testid="org-form-reset-btn"]`

**Expected**:
- `#org-display-name` reverted to "ABC Healthcare"
- `org-form-unsaved-indicator` is NOT present in the DOM
- `org-form-reset-btn` is NOT present in the DOM
- Save button is disabled again (pristine form)

---

#### TC-05-03: Save changes succeeds
**Profile**: super_admin
**Precondition**: ABC Healthcare selected, form pristine

**Steps**:
1. Change `#org-display-name` to "ABC Healthcare Updated"
2. Click Save button -- `[data-testid="org-form-save-btn"]`
3. Wait for save to complete (button text changes from "Saving..." back to "Save Changes")

**Expected**:
- Save operation completes without error
- `org-form-unsaved-indicator` disappears (form reloads from service)
- No error banner appears

**Mock Limitation**: Mock command service returns `{success: true}` but query service re-fetches static data, so the display name reverts to "ABC Healthcare" after reload.

---

### TS-06: Unsaved Changes Guard (4 cases)

---

#### TC-06-01: Switching org with unsaved changes triggers discard dialog
**Profile**: super_admin
**Precondition**: ABC Healthcare selected

**Steps**:
1. Change `#org-display-name` to "Modified"
2. Click XYZ Medical in the list -- `[data-testid="org-list-item-provider-xyz-medical-id"]`
3. Wait for dialog to appear -- `[data-testid="confirm-dialog"]`

**Expected**:
- `confirm-dialog` appears with `role="alertdialog"`
- Title is "Unsaved Changes" -- `[data-testid="confirm-dialog-title"]`
- Message includes "unsaved changes" -- `[data-testid="confirm-dialog-message"]`
- Cancel button label is "Stay Here" -- `[data-testid="confirm-dialog-cancel-btn"]`
- Confirm button label is "Discard Changes" -- `[data-testid="confirm-dialog-confirm-btn"]`

---

#### TC-06-02: "Stay Here" returns to current org with changes intact
**Profile**: super_admin
**Precondition**: Discard dialog is open (from TC-06-01)

**Steps**:
1. Click "Stay Here" -- `[data-testid="confirm-dialog-cancel-btn"]`
2. Verify dialog closes (no `[data-testid="confirm-dialog"]` in DOM)
3. Check `#org-display-name` value
4. Check which org is still selected -- `[data-testid="org-list-item-provider-abc-healthcare-id"]` should have `aria-selected="true"`

**Expected**:
- Dialog closes
- `#org-display-name` still has value "Modified"
- ABC Healthcare is still selected in the list
- Unsaved indicator still visible

---

#### TC-06-03: "Discard Changes" loads new org
**Profile**: super_admin
**Precondition**: ABC Healthcare selected with unsaved changes

**Steps**:
1. Change `#org-display-name` to "Modified" (if not already)
2. Click XYZ Medical in the list -- `[data-testid="org-list-item-provider-xyz-medical-id"]`
3. Wait for discard dialog -- `[data-testid="confirm-dialog"]`
4. Click "Discard Changes" -- `[data-testid="confirm-dialog-confirm-btn"]`
5. Wait for XYZ Medical details to load

**Expected**:
- Dialog closes
- XYZ Medical details load -- `#org-name` shows "XYZ Medical Group"
- `#org-display-name` shows "XYZ Medical"
- XYZ Medical has `aria-selected="true"` in the list
- No unsaved indicator visible

---

#### TC-06-04: Switching without changes loads immediately
**Profile**: super_admin
**Precondition**: ABC Healthcare selected, form is pristine (no changes)

**Steps**:
1. Click XYZ Medical in the list -- `[data-testid="org-list-item-provider-xyz-medical-id"]`
2. Wait for details to load

**Expected**:
- No discard dialog appears
- XYZ Medical details load directly
- `#org-name` shows "XYZ Medical Group"

---

### TS-07: Contact CRUD (7 cases)

---

#### TC-07-01: Contacts section shows existing contact
**Profile**: super_admin
**Precondition**: ABC Healthcare selected

**Steps**:
1. Locate contacts section -- `[data-testid="org-contacts-section"]`
2. Look for contact row -- `[data-testid="org-contact-row-mock-contact-1"]`
3. Read the contact name and details text within the row

**Expected**:
- Contacts section is visible
- Jane Smith contact row is present (`mock-contact-1`)
- Row shows "Jane Smith" with "Primary" badge
- Row shows email, label "Billing Contact", and type "(billing)"

**Note**: The QueryService `getOrganizationDetails` returns 1 contact (Jane Smith). The EntityService contains 2 contacts (Jane Smith + John Doe) but `loadDetails()` reads from QueryService only.

---

#### TC-07-02: Click Add opens empty contact dialog
**Profile**: super_admin
**Precondition**: ABC Healthcare selected (active org)

**Steps**:
1. Click Add button in contacts section -- `[data-testid="org-contacts-add-btn"]`
2. Wait for dialog to appear -- `[data-testid="contact-dialog"]`
3. Check dialog title -- `[data-testid="contact-dialog-title"]`
4. Check form fields are empty

**Expected**:
- `contact-dialog` appears with `role="dialog"` and `aria-modal="true"`
- Title text is "Add Contact"
- `#contact-first-name` is empty
- `#contact-last-name` is empty
- `#contact-email` is empty
- `#contact-label` is empty
- `#contact-type` defaults to "administrative"

---

#### TC-07-03: Fill required fields and save creates new contact
**Profile**: super_admin
**Precondition**: Add contact dialog is open (from TC-07-02)

**Steps**:
1. Type "Bob" in `#contact-first-name`
2. Type "Jones" in `#contact-last-name`
3. Type "bob@test.com" in `#contact-email`
4. Type "IT Contact" in `#contact-label`
5. Click Save -- `[data-testid="contact-dialog-save-btn"]`
6. Wait for dialog to close
7. Verify contact list updated

**Expected**:
- Dialog closes after save
- Contact section reloads (via `reload()` which calls `getOrganizationDetails`)
- No error banner appears

**Mock Limitation**: After save, `reload()` calls `getOrganizationDetails` which returns static mock data (only Jane Smith). The new contact created via EntityService will not appear in the refreshed list.

---

#### TC-07-04: Click edit on Jane Smith opens pre-filled dialog
**Profile**: super_admin
**Precondition**: ABC Healthcare selected, Jane Smith contact visible

**Steps**:
1. Click edit button on Jane Smith -- `[data-testid="org-contact-edit-btn-mock-contact-1"]`
2. Wait for dialog -- `[data-testid="contact-dialog"]`
3. Check dialog title -- `[data-testid="contact-dialog-title"]`
4. Check pre-filled values

**Expected**:
- `contact-dialog` appears
- Title text is "Edit Contact"
- `#contact-first-name` value is "Jane"
- `#contact-last-name` value is "Smith"
- `#contact-email` value contains "billing@abc-healthcare" (from QueryService mock)
- `#contact-label` value is "Billing Contact"
- `#contact-type` value is "billing"

---

#### TC-07-05: Change email and save updates contact
**Profile**: super_admin
**Precondition**: Edit contact dialog open for Jane Smith (from TC-07-04)

**Steps**:
1. Clear `#contact-email` and type "jane.new@test.com"
2. Click Save -- `[data-testid="contact-dialog-save-btn"]`
3. Wait for dialog to close

**Expected**:
- Dialog closes
- No error banner appears
- Form reloads via `reload()`

**Mock Limitation**: Mock EntityService updates in-memory data, but QueryService reload returns original static data.

---

#### TC-07-06: Click delete on a contact removes it
**Profile**: super_admin
**Precondition**: ABC Healthcare selected, Jane Smith contact visible

**Steps**:
1. Click delete button on Jane Smith -- `[data-testid="org-contact-delete-btn-mock-contact-1"]`
2. Wait for the operation to complete

**Expected**:
- Delete executes immediately (no confirmation dialog for entity deletion)
- Contact list reloads
- No error banner appears

**Mock Limitation**: Mock EntityService removes contact from memory, but QueryService reload returns original static data (Jane Smith reappears).

---

#### TC-07-07: Contact dialog cancel closes without changes
**Profile**: super_admin
**Precondition**: ABC Healthcare selected

**Steps**:
1. Click Add button -- `[data-testid="org-contacts-add-btn"]`
2. Wait for dialog -- `[data-testid="contact-dialog"]`
3. Type "Temporary" in `#contact-first-name`
4. Click Cancel -- `[data-testid="contact-dialog-cancel-btn"]`
5. Verify dialog is gone

**Expected**:
- `contact-dialog` is removed from DOM
- No changes to contacts section
- No error banner

---

### TS-08: Address CRUD (5 cases)

---

#### TC-08-01: Addresses section shows Headquarters address
**Profile**: super_admin
**Precondition**: ABC Healthcare selected

**Steps**:
1. Locate addresses section -- `[data-testid="org-addresses-section"]`
2. Look for address row -- `[data-testid="org-address-row-mock-address-1"]`
3. Read the address details

**Expected**:
- Address section is visible
- Headquarters row present with "Primary" badge
- Shows "123 Healthcare Blvd, Suite 400"
- Shows "Los Angeles, CA 90001"

---

#### TC-08-02: Click Add opens empty address dialog
**Profile**: super_admin
**Precondition**: ABC Healthcare selected

**Steps**:
1. Click Add button -- `[data-testid="org-addresses-add-btn"]`
2. Wait for dialog -- `[data-testid="address-dialog"]`
3. Check dialog title -- `[data-testid="address-dialog-title"]`

**Expected**:
- `address-dialog` appears with `role="dialog"` and `aria-modal="true"`
- Title is "Add Address"
- `#address-label` is empty
- `#address-type` defaults to "physical"
- `#address-street1` is empty
- `#address-city` is empty
- `#address-state` is empty
- `#address-zip` is empty

---

#### TC-08-03: Fill required fields and save creates address
**Profile**: super_admin
**Precondition**: Add address dialog is open (from TC-08-02)

**Steps**:
1. Type "Branch Office" in `#address-label`
2. Type "456 Main St" in `#address-street1`
3. Type "Denver" in `#address-city`
4. Type "CO" in `#address-state`
5. Type "80202" in `#address-zip`
6. Click Save -- `[data-testid="address-dialog-save-btn"]`
7. Wait for dialog to close

**Expected**:
- Dialog closes after save
- No error banner appears

**Mock Limitation**: New address created in EntityService memory but QueryService reload returns static data (only Headquarters).

---

#### TC-08-04: Click edit on Headquarters opens pre-filled dialog
**Profile**: super_admin
**Precondition**: ABC Healthcare selected, Headquarters address visible

**Steps**:
1. Click edit button -- `[data-testid="org-address-edit-btn-mock-address-1"]`
2. Wait for dialog -- `[data-testid="address-dialog"]`
3. Check dialog title -- `[data-testid="address-dialog-title"]`
4. Check pre-filled values

**Expected**:
- Title is "Edit Address"
- `#address-label` value is "Headquarters"
- `#address-type` value is "physical"
- `#address-street1` value is "123 Healthcare Blvd"
- `#address-street2` value is "Suite 400"
- `#address-city` value is "Los Angeles"
- `#address-state` value is "CA"
- `#address-zip` value is "90001"

---

#### TC-08-05: Click delete on address removes it
**Profile**: super_admin
**Precondition**: ABC Healthcare selected, Headquarters address visible

**Steps**:
1. Click delete button -- `[data-testid="org-address-delete-btn-mock-address-1"]`
2. Wait for operation to complete

**Expected**:
- Delete executes immediately (no confirmation dialog)
- Address list reloads
- No error banner

**Mock Limitation**: QueryService reload returns static data (Headquarters reappears).

---

### TS-09: Phone CRUD (5 cases)

---

#### TC-09-01: Phones section shows Main Office phone
**Profile**: super_admin
**Precondition**: ABC Healthcare selected

**Steps**:
1. Locate phones section -- `[data-testid="org-phones-section"]`
2. Look for phone row -- `[data-testid="org-phone-row-mock-phone-1"]`
3. Read the phone details

**Expected**:
- Phone section is visible
- Main Office row present with "Primary" badge
- Shows "(555) 123-4567"
- Shows type "office"

---

#### TC-09-02: Click Add opens empty phone dialog
**Profile**: super_admin
**Precondition**: ABC Healthcare selected

**Steps**:
1. Click Add button -- `[data-testid="org-phones-add-btn"]`
2. Wait for dialog -- `[data-testid="phone-dialog"]`
3. Check dialog title -- `[data-testid="phone-dialog-title"]`

**Expected**:
- `phone-dialog` appears with `role="dialog"` and `aria-modal="true"`
- Title is "Add Phone"
- `#phone-label` is empty
- `#phone-type` defaults to "office"
- `#phone-number` is empty
- `#phone-extension` is empty

---

#### TC-09-03: Fill required fields and save creates phone
**Profile**: super_admin
**Precondition**: Add phone dialog is open (from TC-09-02)

**Steps**:
1. Type "Emergency Line" in `#phone-label`
2. Type "(555) 999-0000" in `#phone-number`
3. Click Save -- `[data-testid="phone-dialog-save-btn"]`
4. Wait for dialog to close

**Expected**:
- Dialog closes after save
- No error banner appears

**Mock Limitation**: New phone created in EntityService memory but QueryService reload returns static data (only Main Office).

---

#### TC-09-04: Click edit on Main Office opens pre-filled dialog
**Profile**: super_admin
**Precondition**: ABC Healthcare selected, Main Office phone visible

**Steps**:
1. Click edit button -- `[data-testid="org-phone-edit-btn-mock-phone-1"]`
2. Wait for dialog -- `[data-testid="phone-dialog"]`
3. Check dialog title -- `[data-testid="phone-dialog-title"]`
4. Check pre-filled values

**Expected**:
- Title is "Edit Phone"
- `#phone-label` value is "Main Office"
- `#phone-type` value is "office"
- `#phone-number` value is "(555) 123-4567"
- `#phone-extension` is empty (mock returns null)

---

#### TC-09-05: Click delete on phone removes it
**Profile**: super_admin
**Precondition**: ABC Healthcare selected, Main Office phone visible

**Steps**:
1. Click delete button -- `[data-testid="org-phone-delete-btn-mock-phone-1"]`
2. Wait for operation to complete

**Expected**:
- Delete executes immediately (no confirmation dialog)
- Phone list reloads
- No error banner

**Mock Limitation**: QueryService reload returns static data (Main Office reappears).

---

### TS-10: Empty Entity Sections (1 case)

---

#### TC-10-01: Empty entity sections show empty state messages
**Profile**: super_admin
**Precondition**: This test case validates the empty state messaging. Since mock CRUD operations do not persist through QueryService reload, the empty state can only be observed if QueryService returns empty arrays. In current mock data, all orgs return 1 contact, 1 address, 1 phone.

**Steps**:
1. Select any org (e.g., ABC Healthcare)
2. Verify that `[data-testid="org-contacts-empty"]` is NOT visible (because Jane Smith exists)
3. Verify that `[data-testid="org-addresses-empty"]` is NOT visible (because Headquarters exists)
4. Verify that `[data-testid="org-phones-empty"]` is NOT visible (because Main Office exists)
5. Confirm the testid selectors exist in the DOM structure (they render conditionally when `.length === 0`)

**Expected**:
- When an entity array is empty, the respective empty state message appears:
  - `org-contacts-empty`: "No contacts yet"
  - `org-addresses-empty`: "No addresses yet"
  - `org-phones-empty`: "No phones yet"
- In current mock mode, these are NOT visible because all orgs have at least 1 of each entity

**Mock Limitation**: Cannot clear all entities and verify empty state because QueryService reload restores static data. This test case validates the code path exists; actual empty state testing requires a real backend or modified mock.

---

### TS-11: Danger Zone Toggle (4 cases)

---

#### TC-11-01: super_admin sees Danger Zone card (collapsed by default)
**Profile**: super_admin
**Precondition**: ABC Healthcare selected (active org)

**Steps**:
1. Scroll down past entity sections
2. Locate Danger Zone -- `[data-testid="danger-zone"]`
3. Check toggle button state -- `[data-testid="danger-zone-toggle-btn"]`
4. Check that content is NOT visible -- `[data-testid="danger-zone-content"]` should not exist

**Expected**:
- `danger-zone` section is visible
- `danger-zone-toggle-btn` has `aria-expanded="false"`
- `danger-zone-content` does NOT exist in DOM (collapsed)
- Card has red-themed border and header

---

#### TC-11-02: Click toggle expands Danger Zone
**Profile**: super_admin
**Precondition**: Danger Zone is collapsed (from TC-11-01)

**Steps**:
1. Click toggle button -- `[data-testid="danger-zone-toggle-btn"]`
2. Check toggle state
3. Check for content region -- `[data-testid="danger-zone-content"]`
4. Check for deactivate section -- `[data-testid="danger-zone-deactivate-section"]`
5. Check for delete section -- `[data-testid="danger-zone-delete-section"]`

**Expected**:
- `danger-zone-toggle-btn` now has `aria-expanded="true"`
- `danger-zone-content` is visible with `role="region"`
- Deactivate section visible (org is active)
- Delete section visible with active constraint warning -- `[data-testid="danger-zone-active-constraint"]` shows "Must be deactivated before deletion."
- Reactivate section NOT visible (org is active)

---

#### TC-11-03: Click toggle again collapses Danger Zone
**Profile**: super_admin
**Precondition**: Danger Zone is expanded (from TC-11-02)

**Steps**:
1. Click toggle button -- `[data-testid="danger-zone-toggle-btn"]`
2. Check toggle state
3. Check content visibility

**Expected**:
- `danger-zone-toggle-btn` has `aria-expanded="false"`
- `danger-zone-content` is removed from DOM

---

#### TC-11-04: provider_admin does NOT see Danger Zone
**Profile**: provider_admin
**Precondition**: On manage page

**Steps**:
1. Navigate to `/organizations/manage`
2. Check for Danger Zone -- `[data-testid="danger-zone"]`

**Expected**:
- `danger-zone` does NOT exist in the DOM
- DangerZone is rendered only for platform owner (`isPlatformOwner`)

**Mock Limitation**: provider_admin cannot load any org in mock mode, so the edit panel never renders. However, even if it did, the code checks `isPlatformOwner` before rendering DangerZone.

---

### TS-12: Deactivate Flow (4 cases)

---

#### TC-12-01: Deactivate button opens confirm dialog
**Profile**: super_admin
**Precondition**: ABC Healthcare selected (active org), Danger Zone expanded

**Steps**:
1. Expand Danger Zone if collapsed -- click `[data-testid="danger-zone-toggle-btn"]`
2. Click Deactivate button -- `[data-testid="danger-zone-deactivate-btn"]`
3. Wait for confirm dialog -- `[data-testid="confirm-dialog"]`

**Expected**:
- `confirm-dialog` appears with `role="alertdialog"` and `aria-modal="true"`
- Title is "Deactivate Organization" -- `[data-testid="confirm-dialog-title"]`
- Confirm button label is "Deactivate" -- `[data-testid="confirm-dialog-confirm-btn"]`
- Cancel button label is "Cancel" -- `[data-testid="confirm-dialog-cancel-btn"]`

---

#### TC-12-02: Confirm dialog shows org name in message
**Profile**: super_admin
**Precondition**: Deactivate confirm dialog is open (from TC-12-01)

**Steps**:
1. Read the dialog message -- `[data-testid="confirm-dialog-message"]`

**Expected**:
- Message contains "ABC Healthcare" (the org display_name)
- Message mentions blocking users from accessing the system

---

#### TC-12-03: Confirm deactivation succeeds
**Profile**: super_admin
**Precondition**: Deactivate confirm dialog is open

**Steps**:
1. Click Deactivate -- `[data-testid="confirm-dialog-confirm-btn"]`
2. Wait for dialog to close
3. Check for error banner

**Expected**:
- Dialog closes
- No error banner appears
- Mock command service returns `{success: true}`

**Mock Limitation**: Lifecycle ops return success but query service re-fetches static data. UI will NOT reflect the status change -- the org will still show as "Active" in the list and form.

---

#### TC-12-04: Cancel in deactivate dialog takes no action
**Profile**: super_admin
**Precondition**: Deactivate confirm dialog is open

**Steps**:
1. Click Cancel -- `[data-testid="confirm-dialog-cancel-btn"]`
2. Verify dialog closes
3. Check org is still showing as active

**Expected**:
- Dialog closes
- No action taken
- Org details unchanged

---

### TS-13: Reactivate Flow (4 cases)

---

#### TC-13-01: Inactive org shows Reactivate section (not Deactivate)
**Profile**: super_admin
**Precondition**: Select Summit Health (inactive org)

**Steps**:
1. Click Summit Health -- `[data-testid="org-list-item-provider-summit-health-id"]`
2. Wait for details to load
3. Expand Danger Zone -- click `[data-testid="danger-zone-toggle-btn"]`
4. Check for reactivate section -- `[data-testid="danger-zone-reactivate-section"]`
5. Check that deactivate section is absent -- `[data-testid="danger-zone-deactivate-section"]`

**Expected**:
- `danger-zone-reactivate-section` is visible with "Reactivate Organization" button
- `danger-zone-deactivate-section` does NOT exist in DOM (org is inactive)
- Delete section visible WITHOUT active constraint warning (`danger-zone-active-constraint` not present since org is already inactive)

---

#### TC-13-02: Click Reactivate opens success-variant confirm dialog
**Profile**: super_admin
**Precondition**: Summit Health selected, Danger Zone expanded

**Steps**:
1. Click Reactivate button -- `[data-testid="danger-zone-reactivate-btn"]`
2. Wait for confirm dialog -- `[data-testid="confirm-dialog"]`
3. Note the dialog styling

**Expected**:
- Dialog appears with green-themed styling (success variant)
- Icon is a CheckCircle (green) instead of AlertTriangle
- Title is "Reactivate Organization" -- `[data-testid="confirm-dialog-title"]`
- Confirm button is green ("Reactivate")
- Message contains "Summit Health"

---

#### TC-13-03: Confirm reactivation succeeds
**Profile**: super_admin
**Precondition**: Reactivate confirm dialog is open

**Steps**:
1. Click Reactivate -- `[data-testid="confirm-dialog-confirm-btn"]`
2. Wait for dialog to close
3. Check for error banner

**Expected**:
- Dialog closes
- No error banner appears

**Mock Limitation**: UI will NOT reflect status change. Summit Health will still appear inactive because QueryService returns static data.

---

#### TC-13-04: Inline reactivate button in inactive banner triggers flow
**Profile**: super_admin
**Precondition**: Summit Health selected (inactive), form loaded

**Steps**:
1. Locate the inactive banner -- `[data-testid="org-inactive-banner"]`
2. Click the Reactivate button inside the banner -- `[data-testid="org-inactive-banner-reactivate-btn"]`
3. Wait for confirm dialog -- `[data-testid="confirm-dialog"]`

**Expected**:
- Reactivate confirm dialog appears (same as TC-13-02)
- This is an alternative trigger for the same reactivation flow
- Dialog has success variant (green) styling

---

### TS-14: Delete Flow (7 cases)

---

#### TC-14-01: Delete active org shows "Cannot Delete Active" warning
**Profile**: super_admin
**Precondition**: ABC Healthcare selected (active org), Danger Zone expanded

**Steps**:
1. Click Delete button -- `[data-testid="danger-zone-delete-btn"]`
2. Wait for dialog -- `[data-testid="confirm-dialog"]`
3. Check dialog title -- `[data-testid="confirm-dialog-title"]`

**Expected**:
- Dialog title is "Cannot Delete Active Organization"
- Message mentions "must be deactivated before it can be deleted"
- Message contains "ABC Healthcare"
- Confirm button label is "Deactivate First"
- This is a warning-variant dialog (orange styling)

---

#### TC-14-02: Warning dialog offers "Deactivate First" button
**Profile**: super_admin
**Precondition**: "Cannot Delete Active" dialog is open (from TC-14-01)

**Steps**:
1. Verify confirm button text -- `[data-testid="confirm-dialog-confirm-btn"]`
2. Verify cancel button text -- `[data-testid="confirm-dialog-cancel-btn"]`

**Expected**:
- Confirm button label is "Deactivate First"
- Cancel button label is "Cancel"

---

#### TC-14-03: Click "Deactivate First" switches to deactivate dialog
**Profile**: super_admin
**Precondition**: "Cannot Delete Active" dialog is open

**Steps**:
1. Click "Deactivate First" -- `[data-testid="confirm-dialog-confirm-btn"]`
2. Wait for dialog content to change
3. Check new dialog title -- `[data-testid="confirm-dialog-title"]`

**Expected**:
- Dialog transitions to "Deactivate Organization" confirmation
- Title changes to "Deactivate Organization"
- Confirm button label changes to "Deactivate"
- This is the standard deactivate flow (same as TS-12)

---

#### TC-14-04: Delete inactive org shows DELETE text input confirmation
**Profile**: super_admin
**Precondition**: Summit Health selected (inactive org), Danger Zone expanded

**Steps**:
1. Click Delete button -- `[data-testid="danger-zone-delete-btn"]`
2. Wait for dialog -- `[data-testid="confirm-dialog"]`
3. Check dialog title -- `[data-testid="confirm-dialog-title"]`
4. Check for confirm text input -- `[data-testid="confirm-dialog-confirm-text-input"]`

**Expected**:
- Title is "Delete Organization"
- Message mentions "deletion workflow" and "revokes invitations, removes DNS"
- Message contains "Summit Health"
- Text input present with label 'Type **DELETE** to confirm'
- Confirm button is disabled (no text entered yet)
- This is a danger-variant dialog (red styling)

---

#### TC-14-05: Type "delete" (wrong case) enables confirm button
**Profile**: super_admin
**Precondition**: Delete confirm dialog is open with text input (from TC-14-04)

**Steps**:
1. Type "delete" (lowercase) in `[data-testid="confirm-dialog-confirm-text-input"]`
2. Check confirm button state -- `[data-testid="confirm-dialog-confirm-btn"]`

**Expected**:
- Confirm button is now ENABLED (comparison is case-insensitive: "delete".toUpperCase() === "DELETE")
- Button text is "Delete"

---

#### TC-14-06: Type "DELETE" and confirm deletes org
**Profile**: super_admin
**Precondition**: Delete confirm dialog with "delete" typed (from TC-14-05)

**Steps**:
1. Clear input and type "DELETE" in `[data-testid="confirm-dialog-confirm-text-input"]`
2. Click Confirm -- `[data-testid="confirm-dialog-confirm-btn"]`
3. Wait for dialog to close
4. Check for error banner

**Expected**:
- Dialog closes
- Mock command service returns `{success: true}`
- Panel resets to empty state -- `[data-testid="org-form-empty-state"]` appears
- No error banner

**Mock Limitation**: The delete operation returns success and the ViewModel removes the org from its local array. However, the org may reappear if the list is refreshed (QueryService returns static data).

---

#### TC-14-07: Cancel in delete dialog takes no action
**Profile**: super_admin
**Precondition**: Delete confirm dialog is open

**Steps**:
1. Click Cancel -- `[data-testid="confirm-dialog-cancel-btn"]`
2. Verify dialog closes
3. Check org is still showing

**Expected**:
- Dialog closes
- No action taken
- Org details remain visible and unchanged

---

### TS-15: Error Banner (1 case)

---

#### TC-15-01: Error banner not visible initially
**Profile**: super_admin
**Precondition**: On manage page, page loaded successfully

**Steps**:
1. Check for error banner -- `[data-testid="org-manage-error-banner"]`

**Expected**:
- `org-manage-error-banner` does NOT exist in DOM
- No errors on initial load in mock mode

**Known Limitation**: Error simulation is not possible in mock mode -- all mock operations return `{success: true}`. The error banner HTML structure with `org-manage-error-banner` and `org-manage-error-dismiss-btn` exists in the template but cannot be triggered through normal mock interactions.

---

### TS-16: Keyboard Navigation & Accessibility (7 cases)

---

#### TC-16-01: Tab order flows through page elements logically
**Profile**: super_admin
**Precondition**: On manage page, no org selected

**Steps**:
1. Press Tab from the top of the page
2. Observe focus order through interactive elements
3. Verify focus visits: Back button -> Search input -> Filter buttons (All, Active, Inactive) -> Org list items -> Right panel elements

**Expected**:
- First Tab stop hits `[data-testid="org-manage-back-btn"]`
- Subsequent tabs reach `[data-testid="org-list-search-input"]`
- Then filter buttons: `org-list-filter-all-btn`, `org-list-filter-active-btn`, `org-list-filter-inactive-btn`
- Then org list items (each `role="option"` button)
- All elements have visible focus indicators (ring style)

---

#### TC-16-02: Org list items have correct ARIA roles
**Profile**: super_admin
**Precondition**: List loaded with orgs

**Steps**:
1. Inspect `[data-testid="org-list"]` for `role` attribute
2. Inspect individual org items for `role` attribute

**Expected**:
- List container has `role="listbox"` and `aria-label="Organization list"`
- Each org item button has `role="option"`

---

#### TC-16-03: Selected org has aria-selected="true"
**Profile**: super_admin
**Precondition**: ABC Healthcare selected

**Steps**:
1. Inspect `[data-testid="org-list-item-provider-abc-healthcare-id"]` for `aria-selected`
2. Inspect another unselected item (e.g., XYZ Medical) for `aria-selected`

**Expected**:
- ABC Healthcare item has `aria-selected="true"`
- XYZ Medical item has `aria-selected="false"`

---

#### TC-16-04: Confirm dialog has correct ARIA attributes
**Profile**: super_admin
**Precondition**: Any confirm dialog is open (trigger via deactivate flow)

**Steps**:
1. Open a confirm dialog (e.g., click Deactivate in Danger Zone)
2. Inspect `[data-testid="confirm-dialog"]` for ARIA attributes

**Expected**:
- Has `role="alertdialog"`
- Has `aria-modal="true"`
- Has `aria-labelledby="confirm-dialog-title"`
- Has `aria-describedby="confirm-dialog-description"`

---

#### TC-16-05: Entity form dialog has correct ARIA attributes
**Profile**: super_admin
**Precondition**: Any entity dialog is open (e.g., Add Contact)

**Steps**:
1. Click Add on contacts -- `[data-testid="org-contacts-add-btn"]`
2. Inspect `[data-testid="contact-dialog"]` for ARIA attributes

**Expected**:
- Has `role="dialog"`
- Has `aria-modal="true"`
- Has `aria-labelledby="entity-dialog-title"`

---

#### TC-16-06: Danger Zone toggle has aria-expanded attribute
**Profile**: super_admin
**Precondition**: ABC Healthcare selected

**Steps**:
1. Inspect `[data-testid="danger-zone-toggle-btn"]` for `aria-expanded`
2. Note value when collapsed
3. Click to expand
4. Inspect again

**Expected**:
- Collapsed: `aria-expanded="false"`
- Expanded: `aria-expanded="true"`
- Toggle also has `aria-controls="danger-zone-content"`

---

#### TC-16-07: All form fields have associated labels
**Profile**: super_admin
**Precondition**: ABC Healthcare selected, form loaded

**Steps**:
1. For each form field (`#org-name`, `#org-display-name`, `#org-tax-number`, `#org-phone-number`, `#org-timezone`), verify a `<label>` element with matching `for`/`htmlFor` attribute exists
2. Check that required fields have `aria-required="true"`

**Expected**:
- Each `<input id="org-name">` has a corresponding `<label for="org-name">Organization Name</label>`
- `#org-name`, `#org-display-name`, `#org-timezone` have `aria-required="true"` (required fields)
- `#org-tax-number`, `#org-phone-number` do NOT have `aria-required="true"`
- Fields with errors have `aria-invalid="true"` and `aria-describedby` pointing to error element

---

### TS-17: URL Parameter Handling (2 cases)

---

#### TC-17-01: status=inactive pre-selects Inactive filter
**Profile**: super_admin
**Precondition**: Not on the manage page

**Steps**:
1. Navigate to `http://localhost:5173/organizations/manage?status=inactive`
2. Wait for page and list to load
3. Check which filter button has selected styling
4. Count orgs in list

**Expected**:
- `[data-testid="org-list-filter-inactive-btn"]` has active styling (blue background)
- List shows 1 org: Summit Health Systems (the only inactive org)
- `[data-testid="org-list-item-provider-summit-health-id"]` is visible

---

#### TC-17-02: orgId parameter auto-selects organization
**Profile**: super_admin
**Precondition**: Not on the manage page

**Steps**:
1. Navigate to `http://localhost:5173/organizations/manage?orgId=provider-abc-healthcare-id`
2. Wait for page and list to load
3. Wait for org details to load in right panel
4. Check which org is selected in the list

**Expected**:
- `[data-testid="org-list-item-provider-abc-healthcare-id"]` has `aria-selected="true"`
- Right panel shows ABC Healthcare details -- `[data-testid="org-details-card"]` visible
- `#org-name` value is "ABC Healthcare Partners"
- Empty state `org-form-empty-state` is NOT visible

---

### TS-18: Create Button Visibility & Entry (4 cases)

---

#### TC-18-01: Create button visible for super_admin (platform owner)
**Profile**: super_admin
**Precondition**: On manage page

**Steps**:
1. Navigate to `/organizations`
2. Check for Create button -- `[data-testid="org-list-create-btn"]`

**Expected**:
- `org-list-create-btn` is visible in the left panel header
- Button is next to the Refresh button

---

#### TC-18-02: Create button NOT visible for provider_admin
**Profile**: provider_admin
**Precondition**: On manage page

**Steps**:
1. Switch to provider_admin profile
2. Navigate to `/organizations` (SPA navigation)
3. Check for Create button -- `[data-testid="org-list-create-btn"]`

**Expected**:
- `org-list-create-btn` does NOT exist in DOM
- Left panel is not rendered for provider_admin (no `org-list-panel`)

---

#### TC-18-03: Clicking Create shows the create form in right panel
**Profile**: super_admin
**Precondition**: On manage page, no org selected

**Steps**:
1. Click Create button -- `[data-testid="org-list-create-btn"]`
2. Wait for create form -- `[data-testid="org-create-form"]`

**Expected**:
- `org-create-form` is visible in the right panel
- Empty state (`org-form-empty-state`) is NOT visible

---

#### TC-18-04: Create form replaces edit form when org was selected
**Profile**: super_admin
**Precondition**: ABC Healthcare selected (edit mode)

**Steps**:
1. Click Create button -- `[data-testid="org-list-create-btn"]`
2. Wait for create form -- `[data-testid="org-create-form"]`

**Expected**:
- `org-create-form` is visible
- `org-details-card` (edit form) is NOT visible

**Note**: If the edit form has unsaved changes, a discard dialog appears first.

---

### TS-19: Create Form Structure & Sections (5 cases)

---

#### TC-19-01: General Information section visible by default
**Profile**: super_admin
**Precondition**: Create form open

**Steps**:
1. Enter create mode (click Create button)
2. Check for General section -- `[data-testid="org-create-section-general"]`

**Expected**:
- `org-create-section-general` is visible
- Contains org type, name, display name, timezone, address, phone fields

---

#### TC-19-02: Billing section visible when type is "provider" (default)
**Profile**: super_admin
**Precondition**: Create form open with default type (Provider Organization)

**Steps**:
1. Enter create mode
2. Check for Billing section -- `[data-testid="org-create-section-billing"]`

**Expected**:
- `org-create-section-billing` is visible (default type is Provider Organization)

---

#### TC-19-03: Billing section hidden when type changed to "provider_partner"
**Profile**: super_admin
**Precondition**: Create form open

**Steps**:
1. Enter create mode
2. Change type to "Provider Partner" via `[data-testid="org-create-type-select"]`
3. Check for Billing section

**Expected**:
- `org-create-section-billing` does NOT exist in DOM
- Provider Partner type does not require billing info

**Selector note**: Use `evaluate(el => el.click())` on the select trigger, then `getByRole('option', { name: 'Provider Partner' })` for the option.

---

#### TC-19-04: Provider Admin section always visible
**Profile**: super_admin
**Precondition**: Create form open

**Steps**:
1. Enter create mode
2. Check for Provider Admin section -- `[data-testid="org-create-section-provider-admin"]`

**Expected**:
- `org-create-section-provider-admin` is visible for all org types

---

#### TC-19-05: Section collapse/expand toggles work
**Profile**: super_admin
**Precondition**: Create form open

**Steps**:
1. Enter create mode
2. Click the "General Information" section header text
3. Check that section content collapses
4. Click again
5. Check that section content re-expands

**Expected**:
- Section content toggles visibility on header click
- All three sections are independently collapsible

---

### TS-20: Create Form Fields & Type Switching (5 cases)

---

#### TC-20-01: Default form has org type "Provider Organization", timezone "America/New_York"
**Profile**: super_admin
**Precondition**: Create form open

**Steps**:
1. Enter create mode
2. Check type select value -- `[data-testid="org-create-type-select"]`
3. Check timezone select value -- `[data-testid="org-create-timezone-select"]`

**Expected**:
- Type shows "Provider Organization"
- Timezone shows "America/New_York"

---

#### TC-20-02: Switching to "Provider Partner" hides Billing section and Referring Partner
**Profile**: super_admin
**Precondition**: Create form open

**Steps**:
1. Enter create mode
2. Change type to "Provider Partner"
3. Check for Billing section -- `[data-testid="org-create-section-billing"]`
4. Check for Referring Partner dropdown -- `[data-testid="org-create-referring-partner-dropdown"]`

**Expected**:
- `org-create-section-billing` does NOT exist
- `org-create-referring-partner-dropdown` does NOT exist
- Partner Type select is visible -- `[data-testid="org-create-partner-type-select"]`

---

#### TC-20-03: Partner Type select appears only for provider_partner type
**Profile**: super_admin
**Precondition**: Create form open with default "Provider Organization" type

**Steps**:
1. Enter create mode
2. Verify `[data-testid="org-create-partner-type-select"]` does NOT exist
3. Switch to "Provider Partner"
4. Verify `[data-testid="org-create-partner-type-select"]` IS visible

**Expected**:
- Partner Type select only rendered for provider_partner type

---

#### TC-20-04: Subdomain field visible for provider type
**Profile**: super_admin
**Precondition**: Create form open

**Steps**:
1. Enter create mode
2. Check for subdomain input -- `[data-testid="org-create-subdomain-input"]`

**Expected**:
- `org-create-subdomain-input` is visible for provider type

**Selector note**: SubdomainInput does not accept `data-testid` on the inner `<input>`. Use `[data-testid="org-create-subdomain-input"] input` or `#subdomain`.

---

#### TC-20-05: Referring Partner dropdown visible only for provider type
**Profile**: super_admin
**Precondition**: Create form open

**Steps**:
1. Enter create mode (default: Provider Organization)
2. Check for Referring Partner -- `[data-testid="org-create-referring-partner-dropdown"]`
3. Switch to Provider Partner
4. Check again

**Expected**:
- Visible for Provider Organization type
- NOT visible for Provider Partner type

---

### TS-21: Create Form Validation (6 cases)

---

#### TC-21-01: Submit with empty form shows validation errors summary
**Profile**: super_admin
**Precondition**: Create form open, no fields filled

**Steps**:
1. Enter create mode
2. Fill one field to make form dirty (required for submit to be enabled)
3. Click Submit -- `[data-testid="org-create-submit-btn"]`
4. Check for validation errors -- `[data-testid="org-create-validation-errors"]`

**Expected**:
- Validation errors summary appears listing required fields
- Form is NOT submitted

---

#### TC-21-02: Organization Name required error shown
**Profile**: super_admin
**Precondition**: Create form with Organization Name empty

**Steps**:
1. Enter create mode
2. Fill Display Name (makes form dirty) but leave Name empty
3. Click Submit
4. Check validation errors for "Organization Name"

**Expected**:
- Validation errors mention "Organization Name" as required

---

#### TC-21-03: Display Name required error shown
**Profile**: super_admin
**Precondition**: Create form with Display Name empty

**Steps**:
1. Enter create mode
2. Fill Organization Name but leave Display Name empty
3. Click Submit
4. Check validation errors for "Display Name"

**Expected**:
- Validation errors mention "Display Name" as required

---

#### TC-21-04: Headquarters address fields required
**Profile**: super_admin
**Precondition**: Create form with address fields empty

**Steps**:
1. Enter create mode
2. Fill name fields but leave address empty
3. Click Submit
4. Check validation errors for address fields

**Expected**:
- Validation errors mention street address, city, state, and zip as required

---

#### TC-21-05: Provider Admin contact required
**Profile**: super_admin
**Precondition**: Create form with admin fields empty

**Steps**:
1. Enter create mode
2. Fill name and address fields but leave admin contact empty
3. Click Submit
4. Check validation errors for admin fields

**Expected**:
- Validation errors mention admin first name, last name, and email as required

---

#### TC-21-06: Submit button disabled when form untouched
**Profile**: super_admin
**Precondition**: Create form just opened (no fields touched)

**Steps**:
1. Enter create mode
2. Check submit button state -- `[data-testid="org-create-submit-btn"]`

**Expected**:
- Submit button is disabled (`canSubmit = isDirty && !isSubmitting`, isDirty is false when untouched)

---

### TS-22: "Use General" Checkboxes (4 cases)

---

#### TC-22-01: Billing Address "Use General" checkbox disables billing address inputs
**Profile**: super_admin
**Precondition**: Create form open (provider type, billing section visible)

**Steps**:
1. Enter create mode
2. Click "Use General" for billing address -- `[data-testid="org-create-use-billing-general-address"]`
3. Check billing address inputs within `[data-testid="org-create-billing-address"]`

**Expected**:
- Billing address inputs are disabled after checking "Use General"

---

#### TC-22-02: Billing Phone "Use General" checkbox disables billing phone inputs
**Profile**: super_admin
**Precondition**: Create form open (provider type, billing section visible)

**Steps**:
1. Enter create mode
2. Click "Use General" for billing phone -- `[data-testid="org-create-use-billing-general-phone"]`
3. Check billing phone inputs within `[data-testid="org-create-billing-phone"]`

**Expected**:
- Billing phone inputs are disabled after checking "Use General"

---

#### TC-22-03: Admin Address "Use General" checkbox disables admin address inputs
**Profile**: super_admin
**Precondition**: Create form open

**Steps**:
1. Enter create mode
2. Click "Use General" for admin address -- `[data-testid="org-create-use-admin-general-address"]`
3. Check admin address inputs within `[data-testid="org-create-admin-address"]`

**Expected**:
- Admin address inputs are disabled after checking "Use General"

---

#### TC-22-04: Admin Phone "Use General" checkbox disables admin phone inputs
**Profile**: super_admin
**Precondition**: Create form open

**Steps**:
1. Enter create mode
2. Click "Use General" for admin phone -- `[data-testid="org-create-use-admin-general-phone"]`
3. Check admin phone inputs within `[data-testid="org-create-admin-phone"]`

**Expected**:
- Admin phone inputs are disabled after checking "Use General"

---

### TS-23: Create Form Actions (4 cases)

---

#### TC-23-01: Cancel button returns to empty state
**Profile**: super_admin
**Precondition**: Create form open

**Steps**:
1. Enter create mode
2. Click Cancel -- `[data-testid="org-create-cancel-btn"]`
3. Check for empty state -- `[data-testid="org-form-empty-state"]`

**Expected**:
- Create form is removed from DOM
- Empty state is visible (panelMode → 'empty')

---

#### TC-23-02: Save Draft button triggers save (last-saved timestamp appears)
**Profile**: super_admin
**Precondition**: Create form open with at least one field filled

**Steps**:
1. Enter create mode
2. Fill Organization Name
3. Click Save Draft -- `[data-testid="org-create-save-draft-btn"]`
4. Check for last-saved timestamp -- `[data-testid="org-create-last-saved"]`

**Expected**:
- Last-saved timestamp appears (e.g., "Last saved: 3:45 PM")
- Form remains in create mode

---

#### TC-23-03: Submit with valid data navigates to bootstrap page
**Profile**: super_admin
**Precondition**: Create form with all required fields filled

**Steps**:
1. Enter create mode
2. Fill all required fields using `fillMinimalProviderForm()`
3. Click Submit -- `[data-testid="org-create-submit-btn"]`
4. Wait for navigation

**Expected**:
- URL changes to `/organizations/{id}/bootstrap` pattern
- Mock service creates org and returns a new ID

---

#### TC-23-04: Enter key in text inputs does NOT submit form
**Profile**: super_admin
**Precondition**: Create form open

**Steps**:
1. Enter create mode
2. Click into Organization Name input
3. Type a value
4. Press Enter key
5. Check that form is still visible

**Expected**:
- Create form remains visible (not submitted)
- `handleFormKeyDown` intercepts Enter on input[type="text"] and prevents submission

---

### TS-24: Create Mode Unsaved Changes Guard (3 cases)

---

#### TC-24-01: Clicking org in list while in create mode shows discard dialog
**Profile**: super_admin
**Precondition**: In create mode

**Steps**:
1. Enter create mode
2. Click an org in the list (e.g., ABC Healthcare)
3. Wait for dialog

**Expected**:
- Discard changes dialog appears -- `[data-testid="confirm-dialog"]`
- Title is "Unsaved Changes" -- `[data-testid="confirm-dialog-title"]`
- Confirm button says "Discard Changes"
- Cancel button says "Stay Here"

**Note**: Dialog appears even if no fields were filled (conservative guard — parent can't check create form's isDirty).

---

#### TC-24-02: Confirming discard loads selected org (exits create mode)
**Profile**: super_admin
**Precondition**: Discard dialog visible (from TC-24-01)

**Steps**:
1. Click "Discard Changes" -- `[data-testid="confirm-dialog-confirm-btn"]`
2. Wait for org details to load

**Expected**:
- Create form is removed from DOM
- Selected org's edit form appears -- `[data-testid="org-details-card"]`
- Dialog closes

---

#### TC-24-03: Canceling discard stays in create mode
**Profile**: super_admin
**Precondition**: Discard dialog visible (from TC-24-01)

**Steps**:
1. Click "Stay Here" -- `[data-testid="confirm-dialog-cancel-btn"]`
2. Check form state

**Expected**:
- Dialog closes
- Create form remains visible -- `[data-testid="org-create-form"]`
- No org is selected in the list

---

## Summary

| Suite | Cases | Description |
|-------|-------|-------------|
| TS-01 | 5 | Navigation & Page Load |
| TS-02 | 9 | Organization List |
| TS-03 | 6 | Form Field Editability |
| TS-04 | 7 | Form Validation |
| TS-05 | 3 | Save, Dirty State, Reset |
| TS-06 | 4 | Unsaved Changes Guard |
| TS-07 | 7 | Contact CRUD |
| TS-08 | 5 | Address CRUD |
| TS-09 | 5 | Phone CRUD |
| TS-10 | 1 | Empty Entity Sections |
| TS-11 | 4 | Danger Zone Toggle |
| TS-12 | 4 | Deactivate Flow |
| TS-13 | 4 | Reactivate Flow |
| TS-14 | 7 | Delete Flow |
| TS-15 | 1 | Error Banner |
| TS-16 | 7 | Keyboard Nav & Accessibility |
| TS-17 | 2 | URL Parameter Handling |
| TS-18 | 4 | Create Button Visibility & Entry |
| TS-19 | 5 | Create Form Structure & Sections |
| TS-20 | 5 | Create Form Fields & Type Switching |
| TS-21 | 6 | Create Form Validation |
| TS-22 | 4 | Use General Checkboxes |
| TS-23 | 4 | Create Form Actions |
| TS-24 | 3 | Create Mode Unsaved Changes Guard |
| **Total** | **112** | |

### Playwright Automation Notes (TS-18 through TS-24)

1. **0-width inputs**: The create form's 3-column grid layout makes inputs render at 0px width. Playwright's `fill()` fails. Use `reactFill()` helper (native `HTMLInputElement.prototype.value` setter + `input`/`change` events).
2. **Radix Select interaction**: Glassmorphism card overlap intercepts pointer events. Use `evaluate(el => el.click())` on the trigger, then `getByRole('option', { name: '...', exact: true })` for options.
3. **Exact option labels**: Use "Provider Organization" (not "Provider") — the shorter text matches both options via `:has-text()`.
4. **SubdomainInput**: Does not accept `data-testid` on inner `<input>`. Target via `[data-testid="org-create-subdomain-input"] input` or `#subdomain`.
5. **Section collapse/expand**: Click section title text (e.g., `locator('text=General Information')`), not a class-based selector.

### Known Mock Limitations Summary

1. **Lifecycle ops do not persist**: Deactivate/reactivate/delete return success but QueryService re-fetches static data -- UI will not reflect status changes.
2. **Entity service is global singleton**: Contacts/addresses/phones are shared across all orgs in session.
3. **Entity CRUD does not persist through reload**: After create/update/delete, `reload()` calls QueryService which returns original static data.
4. **No error simulation**: All mock operations return `{success: true}`.
5. **provider_admin/partner_admin org_id mismatch**: Their mock org_ids do not exist in MockOrganizationQueryService data, so auto-select fails silently.
6. **Page refresh resets mock state**: EntityService re-initializes with default data.
