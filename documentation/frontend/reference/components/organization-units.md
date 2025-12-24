---
status: current
last_updated: 2025-12-24
---

# Organization Units Components

React components for rendering and managing organization unit hierarchies with full accessibility support.

**Source Location**: `frontend/src/components/organization-units/`

## Components Overview

| Component | Purpose |
|-----------|---------|
| `OrganizationTree` | Container component for the tree view with keyboard navigation |
| `OrganizationTreeNode` | Recursive node rendering with expand/collapse |
| `OrganizationUnitFormFields` | Shared form fields for create/edit modes |

## OrganizationTree

Container component that renders an accessible tree view of organizational units.

### Features

- **WAI-ARIA Tree Pattern**: Full compliance with [WAI-ARIA APG Tree Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/treeview/)
- **Keyboard Navigation**: Arrow keys, Home, End, Enter/Space
- **Type-Ahead Search**: Focus moves to matching node when typing
- **Focus Management**: Automatic focus on selection changes
- **Empty State**: Graceful handling when no units exist

### Props

```typescript
interface OrganizationTreeProps {
  /** Tree nodes to render (root-level nodes) */
  nodes: OrganizationUnitNode[];

  /** Currently selected node ID */
  selectedId: string | null;

  /** Set of expanded node IDs */
  expandedIds: Set<string>;

  /** Callback when a node is selected */
  onSelect: (nodeId: string) => void;

  /** Callback when a node's expansion is toggled */
  onToggle: (nodeId: string) => void;

  /** Callback when Arrow Down is pressed */
  onMoveDown: () => void;

  /** Callback when Arrow Up is pressed */
  onMoveUp: () => void;

  /** Callback when Arrow Right is pressed */
  onArrowRight: () => void;

  /** Callback when Arrow Left is pressed */
  onArrowLeft: () => void;

  /** Callback when Home key is pressed */
  onSelectFirst: () => void;

  /** Callback when End key is pressed */
  onSelectLast: () => void;

  /** Tree label for accessibility */
  ariaLabel?: string;

  /** Whether tree is in read-only mode */
  readOnly?: boolean;

  /** Additional CSS classes */
  className?: string;

  /** Callback when Enter/Space is pressed on selected node */
  onActivate?: (nodeId: string) => void;
}
```

### Keyboard Navigation

| Key | Action |
|-----|--------|
| `Arrow Down` | Move to next visible node |
| `Arrow Up` | Move to previous visible node |
| `Arrow Right` | Expand node (if collapsed) or move to first child |
| `Arrow Left` | Collapse node (if expanded) or move to parent |
| `Home` | Move to first node |
| `End` | Move to last visible node |
| `Enter` / `Space` | Toggle expansion or trigger onActivate |
| `*` | Expand all siblings (per WAI-ARIA spec) |
| Type characters | Focus moves to next node matching typed prefix |

### Type-Ahead Search

Per WAI-ARIA tree pattern specification:
- Typing a character focuses the next node whose name starts with that character
- Typing multiple characters in rapid succession (<500ms) matches the full prefix
- Search wraps around from end to beginning
- Only visible (expanded) nodes are searched

### Usage Example

```tsx
import { OrganizationTree } from '@/components/organization-units';
import { OrganizationUnitsViewModel } from '@/viewModels/organization/OrganizationUnitsViewModel';

const MyComponent = observer(() => {
  const [viewModel] = useState(() => new OrganizationUnitsViewModel());

  useEffect(() => {
    viewModel.loadUnits();
  }, [viewModel]);

  return (
    <OrganizationTree
      nodes={viewModel.treeNodes}
      selectedId={viewModel.selectedUnitId}
      expandedIds={viewModel.expandedNodeIds}
      onSelect={(id) => viewModel.selectNode(id)}
      onToggle={(id) => viewModel.toggleNode(id)}
      onMoveDown={() => viewModel.moveSelectionDown()}
      onMoveUp={() => viewModel.moveSelectionUp()}
      onArrowRight={() => viewModel.handleArrowRight()}
      onArrowLeft={() => viewModel.handleArrowLeft()}
      onSelectFirst={() => viewModel.selectFirst()}
      onSelectLast={() => viewModel.selectLast()}
      ariaLabel="Organization hierarchy"
      className="border rounded-lg p-4"
    />
  );
});
```

---

## OrganizationTreeNode

Renders a single node in the organization tree hierarchy with ARIA attributes.

### Features

- **Visual Hierarchy**: Tree connector lines showing parent-child relationships
- **Status Indicators**: Root organization badge, inactive badge, child count
- **Recursive Rendering**: Automatically renders children when expanded
- **ARIA Compliance**: Full treeitem role with proper attributes

### Props

```typescript
interface OrganizationTreeNodeProps {
  /** The node data to render */
  node: OrganizationUnitNode;

  /** Whether this node is currently selected */
  isSelected: boolean;

  /** Whether this node is expanded */
  isExpanded: boolean;

  /** Callback when node is selected */
  onSelect: (nodeId: string) => void;

  /** Callback when node expansion is toggled */
  onToggle: (nodeId: string) => void;

  /** Depth level in tree (used for indentation) */
  depth: number;

  /** Position in current level (1-indexed for aria-posinset) */
  positionInSet: number;

  /** Total items in current level (for aria-setsize) */
  setSize: number;

  /** Ref map for focus management */
  nodeRefs?: React.MutableRefObject<Map<string, HTMLLIElement | null>>;

  /** Whether tree is in read-only mode */
  readOnly?: boolean;

  /** Whether this node is the last child (for tree connector lines) */
  isLastChild?: boolean;
}
```

### Visual Design

```
┌─────────────────────────────────────────────────┐
│ [▼] 🏢 Acme Healthcare                    Root  │  ← Root org (blue icon)
│  │                                              │
│  ├─ [▼] 📍 Northern Region               (3)   │  ← Expanded, 3 children
│  │   │                                          │
│  │   ├─ [▶] 📍 Campus A                  (2)   │  ← Collapsed
│  │   │                                          │
│  │   ├─ [ ] 📍 Campus B           ⚠ Inactive   │  ← No children, inactive
│  │   │                                          │
│  │   └─ [▶] 📍 Campus C                  (1)   │  ← Last child (L-connector)
│  │                                              │
│  └─ [ ] 📍 Southern Region                      │  ← No children
└─────────────────────────────────────────────────┘
```

### ARIA Attributes

| Attribute | Value | Description |
|-----------|-------|-------------|
| `role` | `"treeitem"` | Identifies element as tree item |
| `aria-selected` | `true/false` | Current selection state |
| `aria-expanded` | `true/false/undefined` | Expansion state (only if has children) |
| `aria-level` | `1+` | Depth level (1-indexed) |
| `aria-posinset` | `1+` | Position within sibling set |
| `aria-setsize` | `1+` | Total siblings at this level |
| `aria-label` | Dynamic | Full accessible name with status |
| `tabIndex` | `0/-1` | Focus management (0 for selected) |

---

## OrganizationUnitFormFields

Shared form component for organization unit creation and editing.

### Features

- **Reusable Fields**: Name, display name, and timezone inputs
- **Field Validation**: Integrated with `OrganizationUnitFormViewModel`
- **Error Display**: Field-level error messages with ARIA attributes
- **Auto-populate**: Display name auto-populates from name in create mode

### Props

```typescript
interface OrganizationUnitFormFieldsProps {
  /** The form view model managing field state and validation */
  formViewModel: OrganizationUnitFormViewModel;

  /** Prefix for input IDs to ensure uniqueness (e.g., "create", "edit") */
  idPrefix: string;
}
```

### Usage Example

```tsx
import { OrganizationUnitFormFields } from '@/components/organization-units';
import { OrganizationUnitFormViewModel } from '@/viewModels/organization/OrganizationUnitFormViewModel';

const CreateUnitForm = observer(() => {
  const [formViewModel] = useState(() =>
    new OrganizationUnitFormViewModel(service, 'create')
  );

  return (
    <form onSubmit={handleSubmit}>
      {/* Parent selector and other fields */}

      <OrganizationUnitFormFields
        formViewModel={formViewModel}
        idPrefix="create"
      />

      {/* Submit button */}
    </form>
  );
});
```

### Form Fields Included

| Field | Required | Description |
|-------|----------|-------------|
| Unit Name | Yes | Human-readable internal name |
| Display Name | Yes | User-facing display name |
| Time Zone | Yes | IANA timezone for the unit |

### Accessibility Features

- `aria-required="true"` on required fields
- `aria-invalid="true"` on fields with errors
- `aria-describedby` linking to error messages
- `role="alert"` on error messages for announcements

---

## Integration with ViewModel

All three components are designed to work with `OrganizationUnitsViewModel` for tree state management and `OrganizationUnitFormViewModel` for form state:

```typescript
// Tree state management
class OrganizationUnitsViewModel {
  @observable treeNodes: OrganizationUnitNode[] = [];
  @observable selectedUnitId: string | null = null;
  @observable expandedNodeIds: Set<string> = new Set();

  @action selectNode(nodeId: string): void { /* ... */ }
  @action toggleNode(nodeId: string): void { /* ... */ }
  @action moveSelectionDown(): void { /* ... */ }
  @action moveSelectionUp(): void { /* ... */ }
  // ... more methods
}

// Form state management
class OrganizationUnitFormViewModel {
  @observable formData: OrganizationUnitFormData;
  @observable errors: Map<string, string> = new Map();
  @observable isSubmitting = false;

  @action updateName(value: string): void { /* ... */ }
  @action touchField(field: string): void { /* ... */ }
  @action submit(): Promise<SubmitResult> { /* ... */ }
}
```

---

## Testing

### Unit Tests

```typescript
import { render, screen, fireEvent } from '@testing-library/react';
import { OrganizationTree } from './OrganizationTree';

describe('OrganizationTree', () => {
  it('renders tree with nodes', () => {
    render(<OrganizationTree nodes={mockNodes} {...defaultProps} />);
    expect(screen.getByRole('tree')).toBeInTheDocument();
  });

  it('handles keyboard navigation', () => {
    render(<OrganizationTree nodes={mockNodes} {...defaultProps} />);
    const tree = screen.getByRole('tree');

    fireEvent.keyDown(tree, { key: 'ArrowDown' });
    expect(onMoveDown).toHaveBeenCalled();
  });

  it('supports type-ahead search', () => {
    render(<OrganizationTree nodes={mockNodes} {...defaultProps} />);
    const tree = screen.getByRole('tree');

    fireEvent.keyDown(tree, { key: 'n' }); // Type 'n'
    expect(onSelect).toHaveBeenCalledWith('northern-region-id');
  });
});
```

### Accessibility Testing

```typescript
import { axe } from 'jest-axe';

it('has no accessibility violations', async () => {
  const { container } = render(
    <OrganizationTree nodes={mockNodes} {...defaultProps} />
  );
  const results = await axe(container);
  expect(results).toHaveNoViolations();
});
```

---

## Related Files

- **ViewModel**: `frontend/src/viewModels/organization/OrganizationUnitsViewModel.ts`
- **Form ViewModel**: `frontend/src/viewModels/organization/OrganizationUnitFormViewModel.ts`
- **Types**: `frontend/src/types/organization-unit.types.ts`
- **Service**: `frontend/src/services/organization/IOrganizationUnitService.ts`
- **Page**: `frontend/src/pages/organization-units/OrganizationUnitsManagePage.tsx`
- **Database Table**: [organization_units_projection](../../../infrastructure/reference/database/tables/organization_units_projection.md)

---

## Related Documentation

- [Multi-Tenancy Architecture](../../../architecture/data/multi-tenancy-architecture.md)
- [RBAC Architecture](../../../architecture/authorization/rbac-architecture.md)
- [AsyncAPI Organization Unit Events](../../../../infrastructure/supabase/contracts/asyncapi/domains/organization-unit.yaml)

---

**WCAG 2.1 Level AA Compliance**: All components meet accessibility standards including keyboard navigation, focus management, ARIA attributes, and screen reader support.
