# Tasks: Organizational Unit Management

## Phase 1: Foundation (Types & Services) ⏸️ PENDING

- [ ] Create `frontend/src/types/organization-unit.types.ts`
  - [ ] Define `OrganizationUnit` interface
  - [ ] Define `OrganizationUnitNode` interface (extends with tree state)
  - [ ] Define `CreateOrganizationUnitRequest` interface
  - [ ] Define `UpdateOrganizationUnitRequest` interface
- [ ] Create `frontend/src/services/organization/IOrganizationUnitService.ts`
  - [ ] Define service interface with all methods
  - [ ] Document method signatures with JSDoc
- [ ] Create `frontend/src/services/organization/MockOrganizationUnitService.ts`
  - [ ] Implement localStorage-based storage
  - [ ] Create mock hierarchy data (3 levels)
  - [ ] Implement getUnits() method
  - [ ] Implement getUnitById() method
  - [ ] Implement getDescendants() method
  - [ ] Implement createUnit() method
  - [ ] Implement updateUnit() method
  - [ ] Implement deactivateUnit() method
- [ ] Create `frontend/src/services/organization/OrganizationUnitServiceFactory.ts`
  - [ ] Factory pattern based on app config
  - [ ] Return mock service for dev mode

## Phase 2: State Management (ViewModels) ⏸️ PENDING

- [ ] Create `frontend/src/viewModels/organization/OrganizationUnitsViewModel.ts`
  - [ ] Define observable state (units, selectedUnitId, expandedNodeIds, isLoading, error)
  - [ ] Implement loadUnits() action
  - [ ] Implement createUnit() action
  - [ ] Implement updateUnit() action
  - [ ] Implement deactivateUnit() action
  - [ ] Implement toggleNode() action
  - [ ] Implement selectNode() action
  - [ ] Implement expandAll() / collapseAll() actions
  - [ ] Add computed properties (selectedUnit, flatList, canDelete)
- [ ] Create `frontend/src/viewModels/organization/OrganizationUnitFormViewModel.ts`
  - [ ] Define form state (parentId, name, displayName, timeZone)
  - [ ] Implement updateField() method
  - [ ] Implement validate() method
  - [ ] Implement submit() method
  - [ ] Add computed properties (isValid, canSubmit)

## Phase 3: Tree Component ⏸️ PENDING

- [ ] Create `frontend/src/components/organization-units/OrganizationTree.tsx`
  - [ ] Props interface with nodes, selectedId, onSelect, onToggle, expandedIds, mode
  - [ ] Container with role="tree" and aria-label
  - [ ] Render OrganizationTreeNode for each root node
  - [ ] Keyboard navigation handler (arrow keys)
  - [ ] Focus management
- [ ] Create `frontend/src/components/organization-units/OrganizationTreeNode.tsx`
  - [ ] Props interface with node, isSelected, isExpanded, onSelect, onToggle, depth
  - [ ] role="treeitem" with aria-expanded, aria-level, aria-setsize, aria-posinset
  - [ ] Expand/collapse button with proper icon
  - [ ] Selection styling
  - [ ] Recursive children rendering with role="group"
  - [ ] Visual indicators (active/inactive status, child count)
- [ ] Test keyboard navigation
  - [ ] Arrow Down - move to next visible node
  - [ ] Arrow Up - move to previous visible node
  - [ ] Arrow Right - expand node or move to first child
  - [ ] Arrow Left - collapse node or move to parent
  - [ ] Enter/Space - select node
  - [ ] Home - move to first node
  - [ ] End - move to last visible node

## Phase 4: Page Components ⏸️ PENDING

- [ ] Create `frontend/src/pages/organization-units/OrganizationUnitsListPage.tsx`
  - [ ] Page header with title
  - [ ] OrganizationTree in view mode
  - [ ] "Manage Units" button linking to /organization-units/manage
  - [ ] Loading state
  - [ ] Empty state
- [ ] Create `frontend/src/pages/organization-units/OrganizationUnitsManagePage.tsx`
  - [ ] Split view layout (tree left, action panel right)
  - [ ] OrganizationTree in select mode
  - [ ] Action buttons (Create, Edit, Deactivate) based on selection
  - [ ] Breadcrumb showing selected unit path
  - [ ] Confirmation dialog for deactivate
- [ ] Create `frontend/src/pages/organization-units/OrganizationUnitCreatePage.tsx`
  - [ ] Parent unit dropdown (from current hierarchy)
  - [ ] Name input with validation
  - [ ] Display name input with validation
  - [ ] Time zone dropdown (defaults to parent's)
  - [ ] Submit and Cancel buttons
  - [ ] Success redirect to manage page
- [ ] Create `frontend/src/pages/organization-units/OrganizationUnitEditPage.tsx`
  - [ ] Load existing unit by ID from URL param
  - [ ] Name input (pre-filled)
  - [ ] Display name input (pre-filled)
  - [ ] Time zone dropdown (pre-filled)
  - [ ] Active/inactive toggle
  - [ ] Submit and Cancel buttons
  - [ ] Not found state

## Phase 5: Route Integration ⏸️ PENDING

- [ ] Update `frontend/src/App.tsx`
  - [ ] Import new page components
  - [ ] Add route group with RequirePermission guard
  - [ ] Add index route for OrganizationUnitsListPage
  - [ ] Add /manage route for OrganizationUnitsManagePage
  - [ ] Add /create route for OrganizationUnitCreatePage
  - [ ] Add /:unitId/edit route for OrganizationUnitEditPage
- [ ] Update `frontend/src/components/layouts/MainLayout.tsx`
  - [ ] Import FolderTree icon from lucide-react
  - [ ] Add nav item to allNavItems array
  - [ ] Set roles: ['provider_admin']
  - [ ] Set permission: 'organization.create_sub'

## Phase 6: Testing & Documentation ⏸️ PENDING

- [ ] Manual testing
  - [ ] Verify routes load correctly
  - [ ] Test permission guard (try accessing without permission)
  - [ ] Test CRUD operations in mock mode
  - [ ] Test keyboard navigation through tree
  - [ ] Test tab order through forms
  - [ ] Test mobile responsiveness
- [ ] Accessibility audit
  - [ ] Verify all ARIA attributes present
  - [ ] Test with screen reader
  - [ ] Verify focus management
- [ ] Documentation
  - [ ] Create component doc for OrganizationTree
  - [ ] Create component doc for OrganizationTreeNode
  - [ ] Create ViewModel doc for OrganizationUnitsViewModel
  - [ ] Create ViewModel doc for OrganizationUnitFormViewModel
  - [ ] Update types documentation
  - [ ] Run `npm run docs:check`

---

## Success Validation Checkpoints

### Immediate Validation (After Phase 1)
- [ ] Types compile without errors
- [ ] Mock service returns hierarchical data
- [ ] Factory returns correct service based on config

### Phase 3 Validation
- [ ] Tree renders with mock data
- [ ] Expand/collapse works
- [ ] Arrow key navigation works
- [ ] Screen reader announces tree items correctly

### Feature Complete Validation (After Phase 5)
- [ ] Navigate to /organization-units shows tree
- [ ] Navigate to /organization-units/manage shows CRUD interface
- [ ] Create new unit works
- [ ] Edit existing unit works
- [ ] Deactivate unit works
- [ ] Sidebar shows nav item for provider_admin only

### Documentation Validation (After Phase 6)
- [ ] `npm run docs:check` passes
- [ ] 100% component coverage
- [ ] No prop/interface mismatches

---

## Current Status

**Phase**: Not started
**Status**: ⏸️ PENDING
**Last Updated**: 2025-12-04
**Next Step**: Start Phase 1 - Create type definitions
