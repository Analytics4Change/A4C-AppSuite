---
status: current
last_updated: 2026-04-22
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: Component selection guide for `src/components/ui/` — when to use each dropdown, checkbox group, basic UI primitive, and the unified dropdown highlighting system.

**When to read**:
- Choosing a dropdown component (searchable vs editable vs multi-select)
- Building a form that needs grouped checkboxes with focus trapping
- Implementing a component that should match the unified highlighting behavior
- Adding a new UI primitive to this directory

**Prerequisites**: WCAG 2.1 AA basics, MobX observer pattern (see parent CLAUDE.md)

**Key topics**: `dropdowns`, `multi-select`, `checkbox-group`, `highlighting`, `accessibility`, `focus-trap`

**Estimated read time**: 10 minutes
<!-- TL;DR-END -->

# UI Components Guidelines

This file governs code under `frontend/src/components/ui/`. All components here must meet WCAG 2.1 Level AA and integrate with the unified dropdown highlighting system.

## Component Selection Decision Tree

```
Need dropdown selection?
├── Multiple items? → MultiSelectDropdown
├── Hierarchical data? → TreeSelectDropdown
├── Large dataset (100+)? → SearchableDropdown
├── Need to edit after selection? → EditableDropdown
├── Need autocomplete? → EnhancedAutocompleteDropdown
└── Simple list? → Native <select> with styling

Need checkboxes?
├── Group with complex logic? → EnhancedFocusTrappedCheckboxGroup
└── Simple toggle? → Checkbox

Need text input?
├── With dropdown? → See dropdown selection above
└── Plain text? → Input
```

## When to Use Each Dropdown

### SearchableDropdown (`searchable-dropdown.tsx`)

**Use when**: Searchable selection from a large dataset (100+ items)

- Real-time search with debouncing
- Async data loading support
- Highlighted search matches with unified behavior
- Clear selection capability

**Example use cases**: Medication search, client search, diagnosis lookup

```typescript
<SearchableDropdown
  value={searchValue}
  searchResults={results}
  onSearch={handleSearch}
  onSelect={handleSelect}
  renderItem={(item) => <div>{item.name}</div>}
/>
```

### EditableDropdown (`EditableDropdown.tsx`)

**Use when**: Dropdown that can be edited after selection

- Small to medium option sets (< 100 items)
- Edit mode for changing selections
- Uses `EnhancedAutocompleteDropdown` internally for unified highlighting

**Example use cases**: Dosage form, route, unit, frequency selection

```typescript
<EditableDropdown
  id="dosage-form"
  label="Dosage Form"
  value={selectedForm}
  options={formOptions}
  onChange={setSelectedForm}
  tabIndex={5}
/>
```

### EnhancedAutocompleteDropdown (`EnhancedAutocompleteDropdown.tsx`)

**Use when**: Autocomplete with unified highlighting behavior

- Type-ahead functionality
- Distinct typing vs navigation modes
- Custom value support optional

**Example use cases**: Form fields with predefined options that allow custom input

```typescript
<EnhancedAutocompleteDropdown
  options={options}
  value={value}
  onChange={handleChange}
  onSelect={handleSelect}
  allowCustomValue={true}
/>
```

### MultiSelectDropdown (`MultiSelectDropdown.tsx`)

**Use when**: Users need to select multiple items from a list

- Checkbox-based multi-selection
- Selected items summary display
- Full keyboard navigation support

**Example use cases**: Category selection, tag assignment, permission settings

```typescript
<MultiSelectDropdown
  id="categories"
  label="Categories"
  options={['Option 1', 'Option 2']}
  selected={observableSelectedArray}  // Pass observable directly!
  onChange={(newSelection) => vm.setSelection(newSelection)}
/>
```

### EnhancedFocusTrappedCheckboxGroup (`FocusTrappedCheckboxGroup/`)

**Use when**: Group of checkboxes with complex interactions

- Focus trapping within the group
- Dynamic additional inputs based on selection
- Validation rules and metadata support
- Strategy pattern for extensible input types

**Example use cases**: Dosage timings, multi-condition selections

#### Focus Region Tracking

The component uses a focus region state system to handle keyboard events:

- **Focus Regions**: `'header' | 'checkbox' | 'input' | 'button'`
- **Keyboard handling by region**:
  - `'checkbox'`: Arrow keys navigate, Space toggles selection
  - `'input'`: All keyboard events handled natively by input
  - `'button'`: Standard button keyboard behavior
  - `'header'`: Arrow keys can enter checkbox group
- **Benefits**:
  - Works with any custom component via strategy pattern
  - No fragile DOM inspection or event target checking
  - Clear separation of keyboard handling concerns
  - Easier debugging with explicit focus region state

```typescript
<EnhancedFocusTrappedCheckboxGroup
  id="dosage-timings"
  title="Dosage Timings"
  checkboxes={timingOptions}
  onSelectionChange={handleTimingChange}
  onAdditionalDataChange={handleDataChange}
  onContinue={handleContinue}
  onCancel={handleCancel}
/>
```

## Basic UI Primitives

| Component | File | Purpose |
|-----------|------|---------|
| Button | `button.tsx` | Standard button with variants (primary, secondary, ghost) |
| Input | `input.tsx` | Basic text input with error states |
| Label | `label.tsx` | Form labels with proper accessibility |
| Card | `card.tsx` | Content containers with header/body structure |
| Checkbox | `checkbox.tsx` | Individual checkbox for simple toggles |
| Switch | `switch.tsx` | Toggle switch primitive |
| ConfirmDialog | `ConfirmDialog.tsx` | Modal confirmation with optional `details` enumeration |
| DangerZone | `DangerZone.tsx` | Destructive-action UI with render slots |
| ReasonInput | `ReasonInput.tsx` | Text input for reason/justification capture |
| StatusFilterTabs | `StatusFilterTabs.tsx` | Tab-based filter for active/inactive lists |

## Dropdown Highlighting Behavior

All dropdown components use the unified highlighting system:

- **Typing Mode**: Multiple blue highlights for items starting with typed text
- **Navigation Mode**: Single box-shadow highlight for arrow-selected item
- **Combined Mode**: Both highlights when navigating to a typed match

The highlighting is powered by:

- `useDropdownHighlighting` hook for state management
- `/styles/dropdown-highlighting.css` for consistent styling
- `HighlightType` enum for clear state representation

## Key Implementation Notes

- Always pass MobX observables directly (never spread arrays — see parent CLAUDE.md "State Management with MobX")
- Use proper tabIndex sequencing for keyboard navigation (prefer natural DOM order)
- Include all required ARIA attributes for accessibility (`aria-label`, `aria-expanded`, `aria-selected`, `aria-disabled`)
- Follow the unified highlighting pattern for consistency
- Use centralized timing configuration (`/src/config/timings.ts`) for delays
- Modals MUST trap focus while open and restore focus on close
- All interactive elements MUST meet WCAG 2.1 Level AA (4.5:1 contrast for text, 3:1 for large text)

## Related Documentation

- [Frontend CLAUDE.md](../../../CLAUDE.md) — Tech stack, MobX rules, accessibility standards (parent)
- [Assignment sub-components](./assignment/) — Shared UI for role/schedule assignment dialogs
- [Frontend component reference](../../../documentation/frontend/) — Generated component docs
