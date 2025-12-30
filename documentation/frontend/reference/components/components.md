---
status: current
last_updated: 2025-12-30
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: Component overview index covering core UI components (Button, Input, MultiSelectDropdown), form components, layout components (Modal), and MobX integration patterns.

**When to read**:
- Getting overview of available UI components
- Understanding component architecture guidelines
- Learning MobX observer component patterns
- Finding component file size and accessibility requirements

**Prerequisites**: None

**Key topics**: `components`, `button`, `input`, `modal`, `mobx-observer`, `accessibility`, `wcag`

**Estimated read time**: 6 minutes
<!-- TL;DR-END -->

# Component Documentation

This file documents the component architecture and usage patterns for the A4C-FrontEnd application.

## Core UI Components

### Button Component (`src/components/ui/button.tsx`)

**Props**:
- `variant`: 'primary' | 'secondary' | 'ghost' | 'destructive'
- `size`: 'sm' | 'md' | 'lg'
- `disabled`: boolean
- `className`: string (optional)

**Usage**:
```tsx
<Button variant="primary" size="md" onClick={handleClick}>
  Submit
</Button>
```

**Accessibility**: 
- Full keyboard navigation support
- ARIA attributes for screen readers
- Focus indicators meet WCAG contrast requirements

### Input Component (`src/components/ui/input.tsx`)

**Props**:
- `type`: 'text' | 'email' | 'password' | 'number'
- `placeholder`: string
- `value`: string
- `onChange`: (value: string) => void
- `error`: string (optional)
- `required`: boolean

**Usage**:
```tsx
<Input
  type="text"
  placeholder="Enter medication name"
  value={searchValue}
  onChange={setSearchValue}
  required
/>
```

**Accessibility**:
- Proper label association
- Error message announcements
- Required field indicators

### MultiSelectDropdown Component (`src/components/ui/MultiSelectDropdown.tsx`)

**Props**:
- `id`: string
- `label`: string
- `options`: string[]
- `selected`: string[]
- `onChange`: (selected: string[]) => void
- `placeholder`: string (optional)

**Usage**:
```tsx
<MultiSelectDropdown
  id="categories"
  label="Medication Categories"
  options={categoryOptions}
  selected={selectedCategories}
  onChange={setSelectedCategories}
/>
```

**Accessibility**:
- WCAG 2.1 Level AA compliant
- Full keyboard navigation
- Screen reader announcements
- Focus trapping when open

## Form Components

### SearchableDropdown Component (`src/components/ui/searchable-dropdown.tsx`)

**Props**:
- `value`: string
- `searchResults`: Array<any>
- `onSearch`: (query: string) => void
- `onSelect`: (item: any) => void
- `renderItem`: (item: any) => React.ReactNode
- `placeholder`: string

**Usage**:
```tsx
<SearchableDropdown
  value={medicationSearch}
  searchResults={medications}
  onSearch={handleMedicationSearch}
  onSelect={handleMedicationSelect}
  renderItem={(med) => <div>{med.name}</div>}
  placeholder="Search medications..."
/>
```

**Accessibility**:
- Real-time search announcements
- Keyboard navigation through results
- Clear selection capability

## Layout Components

### Modal Components (`src/components/ui/modal/`)

**Base Modal Props**:
- `isOpen`: boolean
- `onClose`: () => void
- `title`: string
- `children`: React.ReactNode

**Usage**:
```tsx
<Modal isOpen={showModal} onClose={closeModal} title="Add Medication">
  <div>Modal content here</div>
</Modal>
```

**Accessibility**:
- Focus trapping within modal
- ESC key closes modal
- Focus restoration on close
- ARIA modal attributes

## State Management Integration

### MobX Observable Components

Components that integrate with MobX ViewModels:

1. **MedicationEntryView** - Uses MedicationViewModel
2. **ClientSelectionView** - Uses ClientViewModel  
3. **DosageConfigurationView** - Uses DosageViewModel

**Pattern**:
```tsx
import { observer } from 'mobx-react-lite';

const MyComponent = observer(() => {
  const viewModel = useViewModel(MyViewModel);
  
  return (
    <div>
      {/* Component renders reactively to viewModel changes */}
    </div>
  );
});
```

## Testing Coverage

### E2E Test Coverage
- All interactive components have Playwright tests
- Keyboard navigation scenarios tested
- Accessibility compliance verified with @axe-core/playwright

### Manual Testing Requirements
- Screen reader compatibility testing
- Cross-browser keyboard navigation
- Color contrast validation

## Component Architecture Guidelines

### File Size Standards
- Keep components under 300 lines
- Split large forms into subcomponents
- Use composition over complex prop drilling

### Accessibility Requirements
- All components must meet WCAG 2.1 Level AA
- Proper ARIA labeling required
- Keyboard navigation for all interactive elements
- Focus management in complex components

### Performance Considerations
- Use React.memo for expensive renders
- Avoid array spreading with MobX observables
- Debounce user input where appropriate

---

This documentation is automatically validated against the actual component implementations. For detailed API documentation, see the TypeDoc generated docs.