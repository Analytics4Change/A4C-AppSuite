/**
 * Component regression — client-field pre-flight count-read FAILURE surfaced in
 * the delete/deactivate confirm dialogs (card O1).
 *
 * The bug this fences: when `getFieldUsageCount` / `getCategoryFieldCount` FAIL,
 * the VM returns `{ success: false }` (not a `0`-sentinel). The dialogs must then
 * render an honest "Couldn't verify" state — DELETE blocked (confirm disabled +
 * service NOT invoked), DEACTIVATE still available (reversible, honest copy) —
 * never the reassuring "0 clients — safe to delete".
 *
 * Why this layer (not Playwright): the guarantee is a pure VM-return →
 * local-dialog-state → ConfirmDialog interaction, fully faithful in JSDOM. The
 * server-side re-check remains the load-bearing guard; this fences the frontend
 * surface only.
 *
 * See dev/active/seed-surface-client-field-count-read-failures.md.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ClientFieldSettingsViewModel } from '@/viewModels/settings/ClientFieldSettingsViewModel';
import { CustomFieldsTab } from '../CustomFieldsTab';
import { CategoriesTab } from '../CategoriesTab';
import type { IClientFieldService } from '@/services/client-fields/IClientFieldService';
import type { FieldDefinition, FieldCategory } from '@/types/client-field-settings.types';

// ── Fixtures ──

function makeField(overrides: Partial<FieldDefinition> = {}): FieldDefinition {
  return {
    id: 'field-x',
    category_id: 'cat-x',
    category_name: 'Custom',
    category_slug: 'custom',
    field_key: 'custom_weekend_hours',
    display_name: 'Weekend Hours',
    field_type: 'text',
    is_visible: true,
    is_required: false,
    validation_rules: null,
    is_dimension: false,
    sort_order: 1,
    configurable_label: null,
    conforming_dimension_mapping: null,
    is_active: true,
    ...overrides,
  };
}

const ACTIVE_FIELD = makeField({
  id: 'field-active',
  field_key: 'custom_hobby',
  display_name: 'Hobby',
  is_active: true,
});
const INACTIVE_FIELD = makeField({
  id: 'field-inactive',
  field_key: 'custom_weekend_hours',
  display_name: 'Weekend Hours',
  is_active: false,
});

const ACTIVE_CATEGORY: FieldCategory = {
  id: 'cat-active',
  organization_id: 'org-1',
  name: 'Preferences',
  slug: 'preferences',
  sort_order: 5,
  is_system: false,
  is_active: true,
};
const INACTIVE_CATEGORY: FieldCategory = {
  id: 'cat-inactive',
  organization_id: 'org-1',
  name: 'Legacy',
  slug: 'legacy',
  sort_order: 6,
  is_system: false,
  is_active: false,
};

function createMockService(overrides?: Partial<IClientFieldService>): IClientFieldService {
  return {
    listFieldDefinitions: vi.fn().mockResolvedValue([ACTIVE_FIELD, INACTIVE_FIELD]),
    listFieldCategories: vi.fn().mockResolvedValue([ACTIVE_CATEGORY, INACTIVE_CATEGORY]),
    batchUpdateFieldDefinitions: vi.fn(),
    createFieldDefinition: vi.fn().mockResolvedValue({ success: true, field_id: 'f' }),
    updateFieldDefinition: vi.fn().mockResolvedValue({ success: true, field_id: 'f' }),
    deactivateFieldDefinition: vi.fn().mockResolvedValue({ success: true, field_id: 'f' }),
    reactivateFieldDefinition: vi.fn().mockResolvedValue({ success: true, field_id: 'f' }),
    deleteFieldDefinition: vi.fn().mockResolvedValue({ success: true }),
    createFieldCategory: vi.fn().mockResolvedValue({ success: true, category_id: 'c' }),
    updateFieldCategory: vi.fn().mockResolvedValue({ success: true, category_id: 'c' }),
    deactivateFieldCategory: vi.fn().mockResolvedValue({ success: true, category_id: 'c' }),
    reactivateFieldCategory: vi.fn().mockResolvedValue({ success: true, category_id: 'c' }),
    deleteFieldCategory: vi.fn().mockResolvedValue({ success: true }),
    // Pre-flight counts FAIL — the case under test.
    getFieldUsageCount: vi.fn().mockResolvedValue({ success: false }),
    getCategoryFieldCount: vi.fn().mockResolvedValue({ success: false }),
    ...overrides,
  };
}

async function buildVm(service: IClientFieldService): Promise<ClientFieldSettingsViewModel> {
  const vm = new ClientFieldSettingsViewModel(service);
  await vm.loadData('org-1');
  // Show both active and inactive rows so delete (inactive) + deactivate (active)
  // affordances are both present.
  vm.setFieldStatusFilter('all');
  vm.setCategoryStatusFilter('all');
  return vm;
}

beforeEach(() => {
  vi.clearAllMocks();
  cleanup();
});

// ── CustomFieldsTab ──

describe('CustomFieldsTab — count-read failure confirm state', () => {
  it('DELETE on a failed usage read is BLOCKED with an honest "couldn\'t verify" message', async () => {
    const service = createMockService();
    const vm = await buildVm(service);
    render(
      <CustomFieldsTab
        viewModel={vm}
        fields={vm.fieldDefinitions}
        categories={vm.categories}
        orgId="org-1"
      />
    );

    fireEvent.click(screen.getByTestId('cf-delete-custom_weekend_hours'));

    const message = await screen.findByTestId('confirm-dialog-message');
    expect(message.textContent).toMatch(/couldn't verify/i);

    const confirmBtn = screen.getByTestId('confirm-dialog-confirm-btn') as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(true);

    // Guard (dbc F4): even force-clicking the confirm affordance must NOT delete.
    fireEvent.click(confirmBtn);
    await waitFor(() => expect(service.deleteFieldDefinition).not.toHaveBeenCalled());
  });

  it('DEACTIVATE on a failed usage read stays AVAILABLE with honest copy (reversible)', async () => {
    const service = createMockService();
    const vm = await buildVm(service);
    render(
      <CustomFieldsTab
        viewModel={vm}
        fields={vm.fieldDefinitions}
        categories={vm.categories}
        orgId="org-1"
      />
    );

    fireEvent.click(screen.getByTestId('cf-deactivate-custom_hobby'));

    const message = await screen.findByTestId('confirm-dialog-message');
    expect(message.textContent).toMatch(/couldn't verify/i);
    expect(message.textContent).toMatch(/preserves any existing data/i);

    const confirmBtn = screen.getByTestId('confirm-dialog-confirm-btn') as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(false);
  });

  // Positive controls — lock the rest of the truth table (in-use blocks, empty allows).

  it('DELETE with a definitive in-use count (>0) is BLOCKED with the usage message', async () => {
    const service = createMockService({
      getFieldUsageCount: vi.fn().mockResolvedValue({ success: true, count: 3 }),
    });
    const vm = await buildVm(service);
    render(
      <CustomFieldsTab
        viewModel={vm}
        fields={vm.fieldDefinitions}
        categories={vm.categories}
        orgId="org-1"
      />
    );

    fireEvent.click(screen.getByTestId('cf-delete-custom_weekend_hours'));

    const message = await screen.findByTestId('confirm-dialog-message');
    expect(message.textContent).toMatch(/3 client\(s\) have data/i);
    expect((screen.getByTestId('confirm-dialog-confirm-btn') as HTMLButtonElement).disabled).toBe(
      true
    );
  });

  it('DELETE with a definitive zero count (0) ALLOWS the type-to-confirm delete', async () => {
    const service = createMockService({
      getFieldUsageCount: vi.fn().mockResolvedValue({ success: true, count: 0 }),
    });
    const vm = await buildVm(service);
    render(
      <CustomFieldsTab
        viewModel={vm}
        fields={vm.fieldDefinitions}
        categories={vm.categories}
        orgId="org-1"
      />
    );

    fireEvent.click(screen.getByTestId('cf-delete-custom_weekend_hours'));

    const message = await screen.findByTestId('confirm-dialog-message');
    expect(message.textContent).toMatch(/permanently removes the field/i);

    // Type-to-confirm gates the delete: disabled until the name is typed, then enabled.
    const confirmBtn = screen.getByTestId('confirm-dialog-confirm-btn') as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(true);
    fireEvent.change(screen.getByTestId('confirm-dialog-confirm-text-input'), {
      target: { value: 'Weekend Hours' },
    });
    await waitFor(() => expect(confirmBtn.disabled).toBe(false));
  });
});

// ── CategoriesTab ──

describe('CategoriesTab — count-read failure confirm state', () => {
  it('DELETE on a failed child-count read is BLOCKED with an honest "couldn\'t verify" message', async () => {
    const service = createMockService();
    const vm = await buildVm(service);
    render(<CategoriesTab viewModel={vm} categories={vm.categories} orgId="org-1" />);

    fireEvent.click(screen.getByTestId('cat-delete-legacy'));

    const message = await screen.findByTestId('confirm-dialog-message');
    expect(message.textContent).toMatch(/couldn't verify/i);

    const confirmBtn = screen.getByTestId('confirm-dialog-confirm-btn') as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(true);

    // Guard (dbc F4): force-clicking must NOT delete the category.
    fireEvent.click(confirmBtn);
    await waitFor(() => expect(service.deleteFieldCategory).not.toHaveBeenCalled());
  });

  it('DEACTIVATE on a failed child-count read stays AVAILABLE with honest copy (reversible)', async () => {
    const service = createMockService();
    const vm = await buildVm(service);
    render(<CategoriesTab viewModel={vm} categories={vm.categories} orgId="org-1" />);

    fireEvent.click(screen.getByTestId('cat-deactivate-preferences'));

    const message = await screen.findByTestId('confirm-dialog-message');
    expect(message.textContent).toMatch(/couldn't verify/i);
    expect(message.textContent).toMatch(/reversible/i);

    const confirmBtn = screen.getByTestId('confirm-dialog-confirm-btn') as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(false);
  });

  it('DELETE with a definitive child count (>0) is BLOCKED with the child-count message', async () => {
    const service = createMockService({
      getCategoryFieldCount: vi
        .fn()
        .mockResolvedValue({ success: true, count: 2, fields: ['Age', 'Height'] }),
    });
    const vm = await buildVm(service);
    render(<CategoriesTab viewModel={vm} categories={vm.categories} orgId="org-1" />);

    fireEvent.click(screen.getByTestId('cat-delete-legacy'));

    const message = await screen.findByTestId('confirm-dialog-message');
    expect(message.textContent).toMatch(/still has 2 field\(s\)/i);
    expect((screen.getByTestId('confirm-dialog-confirm-btn') as HTMLButtonElement).disabled).toBe(
      true
    );
  });
});
