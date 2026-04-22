/**
 * Custom Fields Tab
 *
 * CRUD interface for org-defined custom field definitions.
 * Add custom field form + table of existing custom fields with deactivate.
 */

import React, { useState, useEffect, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Plus, Trash2, Pencil, RotateCcw, Loader2, AlertCircle, Check, X } from 'lucide-react';
import type { FieldDefinition, FieldCategory } from '@/types/client-field-settings.types';
import { FIELD_TYPE_DISPLAY_LABELS } from '@/types/client-field-settings.types';
import type {
  ClientFieldSettingsViewModel,
  FieldStatusFilter,
} from '@/viewModels/settings/ClientFieldSettingsViewModel';
import { EnumValuesInput } from './EnumValuesInput';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

const glassCardStyle = {
  background: 'rgba(255, 255, 255, 0.7)',
  backdropFilter: 'blur(20px)',
  WebkitBackdropFilter: 'blur(20px)',
  border: '1px solid rgba(255, 255, 255, 0.3)',
  boxShadow: '0 2px 4px rgba(0, 0, 0, 0.05)',
};

const FIELD_TYPES = [
  { value: 'text', label: FIELD_TYPE_DISPLAY_LABELS.text },
  { value: 'number', label: FIELD_TYPE_DISPLAY_LABELS.number },
  { value: 'date', label: FIELD_TYPE_DISPLAY_LABELS.date },
  { value: 'enum', label: FIELD_TYPE_DISPLAY_LABELS.enum },
  { value: 'multi_enum', label: FIELD_TYPE_DISPLAY_LABELS.multi_enum },
  { value: 'boolean', label: FIELD_TYPE_DISPLAY_LABELS.boolean },
];

interface CustomFieldsTabProps {
  viewModel: ClientFieldSettingsViewModel;
  fields: FieldDefinition[];
  categories: FieldCategory[];
  orgId: string;
}

export const CustomFieldsTab: React.FC<CustomFieldsTabProps> = observer(
  ({ viewModel, fields, categories, orgId }) => {
    const [showForm, setShowForm] = useState(false);
    const [name, setName] = useState('');
    const [fieldType, setFieldType] = useState('text');
    const [categoryId, setCategoryId] = useState('');
    const [isRequired, setIsRequired] = useState(false);
    const [enumValues, setEnumValues] = useState<string[]>([]);

    // Edit state
    const [editingFieldId, setEditingFieldId] = useState<string | null>(null);
    const [editName, setEditName] = useState('');
    const [editCategoryId, setEditCategoryId] = useState('');
    const [editIsRequired, setEditIsRequired] = useState(false);
    const [editEnumValues, setEditEnumValues] = useState<string[]>([]);

    // Deactivation confirmation state
    const [deactivateTarget, setDeactivateTarget] = useState<{
      id: string;
      name: string;
      fieldKey: string;
      usageCount: number;
    } | null>(null);
    const [isCheckingUsage, setIsCheckingUsage] = useState(false);
    const [isDeactivating, setIsDeactivating] = useState(false);

    // Reactivation + delete confirmation state
    const [reactivateTarget, setReactivateTarget] = useState<{
      id: string;
      name: string;
      /**
       * True when the field's parent category is currently inactive.
       * Decision 101: reactivation does NOT cascade, so the action still
       * succeeds — we just warn the admin the field will remain hidden
       * until the category is also reactivated.
       */
      parentCategoryInactive: boolean;
      parentCategoryName: string | null;
    } | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<{
      id: string;
      name: string;
      fieldKey: string;
      usageCount: number;
    } | null>(null);

    const editNameRef = useRef<HTMLInputElement>(null);

    const isEnumType = fieldType === 'enum' || fieldType === 'multi_enum';

    // Focus the edit name input when edit form opens
    useEffect(() => {
      if (editingFieldId) {
        editNameRef.current?.focus();
      }
    }, [editingFieldId]);

    // Custom fields honoring the status filter (All / Active / Inactive).
    // Sorting + system-field exclusion lives in the ViewModel.
    const customFields = viewModel.visibleCustomFields;
    // Eliminate TS unused-param lint for the now-ViewModel-driven source.
    void fields;
    const statusFilter = viewModel.fieldStatusFilter;

    const handleStatusFilter = (value: FieldStatusFilter) => viewModel.setFieldStatusFilter(value);

    const handleReactivateClick = (field: FieldDefinition) => {
      viewModel.clearFieldLifecycleError();
      const parentCategory = viewModel.categories.find((c) => c.id === field.category_id);
      setReactivateTarget({
        id: field.id,
        name: field.display_name,
        parentCategoryInactive: parentCategory ? !parentCategory.is_active : false,
        parentCategoryName: parentCategory?.name ?? null,
      });
    };

    const confirmReactivate = async () => {
      if (!reactivateTarget) return;
      const ok = await viewModel.reactivateCustomField(
        reactivateTarget.id,
        `Reactivated custom field: ${reactivateTarget.name}`,
        orgId
      );
      if (ok) setReactivateTarget(null);
    };

    const handleDeleteClick = async (field: FieldDefinition) => {
      viewModel.clearFieldLifecycleError();
      setIsCheckingUsage(true);
      const count = await viewModel.getFieldUsageCount(field.field_key);
      setIsCheckingUsage(false);
      setDeleteTarget({
        id: field.id,
        name: field.display_name,
        fieldKey: field.field_key,
        usageCount: count,
      });
    };

    const confirmDelete = async () => {
      if (!deleteTarget || deleteTarget.usageCount > 0) return;
      const result = await viewModel.deleteCustomField(
        deleteTarget.id,
        `Deleted custom field: ${deleteTarget.name}`,
        orgId
      );
      if (result.success) {
        setDeleteTarget(null);
      } else if (typeof result.usageCount === 'number' && result.usageCount > 0) {
        // Server disagreed with client-side pre-check: surface the fresh count.
        setDeleteTarget({ ...deleteTarget, usageCount: result.usageCount });
      }
    };

    const fieldKey = name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, '_');

    const canCreate =
      name.trim().length > 0 &&
      fieldKey.length > 0 &&
      categoryId.length > 0 &&
      (!isEnumType || enumValues.length > 0);

    const resetForm = () => {
      setName('');
      setFieldType('text');
      setCategoryId('');
      setIsRequired(false);
      setEnumValues([]);
    };

    const handleCreate = async (keepOpen = false) => {
      if (!canCreate) return;
      const validationRules =
        isEnumType && enumValues.length > 0 ? { enum_values: enumValues } : undefined;
      const success = await viewModel.createCustomField(
        {
          field_key: `custom_${fieldKey}`,
          display_name: name.trim(),
          category_id: categoryId,
          field_type: fieldType,
          is_required: isRequired,
          validation_rules: validationRules,
        },
        orgId
      );

      if (success) {
        resetForm();
        if (!keepOpen) {
          setShowForm(false);
        }
      }
    };

    const handleDeactivateClick = async (field: FieldDefinition) => {
      setIsCheckingUsage(true);
      const count = await viewModel.getFieldUsageCount(field.field_key);
      setIsCheckingUsage(false);
      setDeactivateTarget({
        id: field.id,
        name: field.display_name,
        fieldKey: field.field_key,
        usageCount: count,
      });
    };

    const confirmDeactivate = async () => {
      if (!deactivateTarget) return;
      setIsDeactivating(true);
      await viewModel.deactivateCustomField(
        deactivateTarget.id,
        `Removed custom field: ${deactivateTarget.name}`,
        orgId
      );
      setIsDeactivating(false);
      setDeactivateTarget(null);
    };

    const startEditing = (field: FieldDefinition) => {
      setEditingFieldId(field.id);
      setEditName(field.display_name);
      setEditCategoryId(field.category_id);
      setEditIsRequired(field.is_required);
      const existingValues = (field.validation_rules as Record<string, unknown> | null)
        ?.enum_values;
      setEditEnumValues(Array.isArray(existingValues) ? (existingValues as string[]) : []);
    };

    const cancelEditing = () => {
      setEditingFieldId(null);
      setEditName('');
      viewModel.clearFieldErrors();
      setEditCategoryId('');
      setEditIsRequired(false);
      setEditEnumValues([]);
    };

    const handleUpdate = async () => {
      if (!editingFieldId || editName.trim().length === 0) return;
      const editedField = customFields.find((f) => f.id === editingFieldId);
      const isEditEnumType =
        editedField?.field_type === 'enum' || editedField?.field_type === 'multi_enum';
      if (isEditEnumType && editEnumValues.length === 0) return;
      const editValidationRules =
        isEditEnumType && editEnumValues.length > 0 ? { enum_values: editEnumValues } : undefined;
      const success = await viewModel.updateCustomField(
        editingFieldId,
        {
          display_name: editName.trim(),
          category_id: editCategoryId,
          is_required: editIsRequired,
          validation_rules: editValidationRules,
          reason: `Updated custom field: ${editName.trim()}`,
        },
        orgId
      );
      if (success) {
        cancelEditing();
      }
    };

    return (
      <div
        role="tabpanel"
        aria-labelledby="tab-custom_fields"
        id="tabpanel-custom_fields"
        data-testid="tabpanel-custom_fields"
      >
        <Card style={glassCardStyle}>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Custom Fields</CardTitle>
              {!showForm && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowForm(true)}
                  data-testid="add-custom-field-btn"
                >
                  <Plus size={16} className="mr-1" />
                  Add Custom Field
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Status filter bar */}
            <div
              className="flex gap-2"
              role="group"
              aria-label="Filter custom fields by status"
              data-testid="cf-status-filter"
            >
              {(['all', 'active', 'inactive'] as const).map((value) => (
                <Button
                  key={value}
                  variant={statusFilter === value ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => handleStatusFilter(value)}
                  aria-pressed={statusFilter === value}
                  className={
                    statusFilter === value
                      ? 'bg-blue-600 text-white hover:bg-blue-700'
                      : 'hover:bg-gray-100'
                  }
                  data-testid={`cf-status-filter-${value}`}
                >
                  {value.charAt(0).toUpperCase() + value.slice(1)}
                </Button>
              ))}
            </div>

            {viewModel.fieldLifecycleError && (
              <div
                role="alert"
                className="flex items-center gap-2 p-2 bg-red-50 border border-red-200 rounded text-red-800 text-sm"
                data-testid="cf-lifecycle-error"
              >
                <AlertCircle size={14} />
                {viewModel.fieldLifecycleError}
              </div>
            )}

            {/* Create form */}
            {showForm && (
              <div className="border border-gray-200 rounded-lg p-4 space-y-3 bg-white/50">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="cf-name">Display Name</Label>
                    <input
                      id="cf-name"
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g., Allergist Name"
                      className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      data-testid="cf-name-input"
                    />
                    {fieldKey && (
                      <p className="mt-1 text-xs text-gray-400">Key: custom_{fieldKey}</p>
                    )}
                  </div>
                  <div>
                    <Label htmlFor="cf-type">Field Type</Label>
                    <select
                      id="cf-type"
                      value={fieldType}
                      onChange={(e) => setFieldType(e.target.value)}
                      className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      data-testid="cf-type-select"
                    >
                      {FIELD_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="cf-category">Category</Label>
                    <select
                      id="cf-category"
                      value={categoryId}
                      onChange={(e) => setCategoryId(e.target.value)}
                      className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      data-testid="cf-category-select"
                    >
                      <option value="">Select category...</option>
                      {categories
                        .filter((c) => c.is_active)
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                    </select>
                  </div>
                  <div className="flex items-end pb-1">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={isRequired}
                        onChange={(e) => setIsRequired(e.target.checked)}
                        className="rounded border-gray-300"
                        data-testid="cf-required-checkbox"
                      />
                      Required when visible
                    </label>
                  </div>
                </div>

                {/* Enum values input — shown when field type is single/multi-select */}
                {isEnumType && (
                  <EnumValuesInput values={enumValues} onChange={setEnumValues} testIdPrefix="cf" />
                )}

                {viewModel.createFieldError && (
                  <div
                    role="alert"
                    className="flex items-center gap-2 p-2 bg-red-50 border border-red-200 rounded text-red-800 text-sm"
                    data-testid="cf-error-alert"
                  >
                    <AlertCircle size={14} />
                    {viewModel.createFieldError}
                  </div>
                )}

                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => handleCreate(false)}
                    disabled={!canCreate || viewModel.isCreatingField}
                    data-testid="cf-save-btn"
                  >
                    {viewModel.isCreatingField ? (
                      <Loader2 size={14} className="mr-1 animate-spin" />
                    ) : (
                      <Plus size={14} className="mr-1" />
                    )}
                    Create Field
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => handleCreate(true)}
                    disabled={!canCreate || viewModel.isCreatingField}
                    data-testid="cf-save-another-btn"
                  >
                    {viewModel.isCreatingField ? (
                      <Loader2 size={14} className="mr-1 animate-spin" />
                    ) : (
                      <Plus size={14} className="mr-1" />
                    )}
                    Create &amp; Add Another
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setShowForm(false);
                      resetForm();
                      viewModel.clearFieldErrors();
                    }}
                    data-testid="cf-cancel-btn"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {/* Custom fields table */}
            {customFields.length === 0 && !showForm ? (
              <p className="text-sm text-gray-500 py-4" data-testid="cf-empty-state">
                {statusFilter === 'inactive'
                  ? 'No deactivated custom fields.'
                  : statusFilter === 'active'
                    ? 'No custom fields defined. Click "Add Custom Field" to create one.'
                    : 'No custom fields exist.'}
              </p>
            ) : (
              <div className="divide-y divide-gray-100">
                {customFields.map((field) =>
                  editingFieldId === field.id ? (
                    <div
                      key={field.id}
                      className="py-3 space-y-3 border border-blue-200 rounded-lg p-4 bg-blue-50/30"
                      data-testid={`custom-field-edit-${field.field_key}`}
                    >
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label htmlFor="cf-edit-name">Display Name</Label>
                          <input
                            id="cf-edit-name"
                            ref={editNameRef}
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                            data-testid="cf-edit-name-input"
                          />
                        </div>
                        <div>
                          <Label htmlFor="cf-edit-category">Category</Label>
                          <select
                            id="cf-edit-category"
                            value={editCategoryId}
                            onChange={(e) => setEditCategoryId(e.target.value)}
                            className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                            data-testid="cf-edit-category-select"
                          >
                            {categories
                              .filter((c) => c.is_active)
                              .map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.name}
                                </option>
                              ))}
                          </select>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={editIsRequired}
                            onChange={(e) => setEditIsRequired(e.target.checked)}
                            className="rounded border-gray-300"
                            data-testid="cf-edit-required-checkbox"
                          />
                          Required when visible
                        </label>
                        <span className="text-xs text-gray-400">
                          Type: {FIELD_TYPE_DISPLAY_LABELS[field.field_type] ?? field.field_type}{' '}
                          (not editable)
                        </span>
                      </div>
                      {/* Enum values editing for single/multi-select fields */}
                      {(field.field_type === 'enum' || field.field_type === 'multi_enum') && (
                        <EnumValuesInput
                          values={editEnumValues}
                          onChange={setEditEnumValues}
                          testIdPrefix="cf-edit"
                        />
                      )}
                      {viewModel.updateFieldError && (
                        <div
                          role="alert"
                          className="flex items-center gap-2 p-2 bg-red-50 border border-red-200 rounded text-red-800 text-sm"
                        >
                          <AlertCircle size={14} />
                          {viewModel.updateFieldError}
                        </div>
                      )}
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={handleUpdate}
                          disabled={editName.trim().length === 0 || viewModel.isUpdatingField}
                          data-testid="cf-edit-save-btn"
                        >
                          {viewModel.isUpdatingField ? (
                            <Loader2 size={14} className="mr-1 animate-spin" />
                          ) : (
                            <Check size={14} className="mr-1" />
                          )}
                          Save
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={cancelEditing}
                          data-testid="cf-edit-cancel-btn"
                        >
                          <X size={14} className="mr-1" />
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div
                      key={field.id}
                      className="flex items-center justify-between py-3"
                      data-testid={`custom-field-${field.field_key}`}
                      data-active={field.is_active ? 'true' : 'false'}
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span
                            className={`text-sm font-medium ${field.is_active ? '' : 'text-gray-500'}`}
                          >
                            {field.display_name}
                          </span>
                          <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
                            {FIELD_TYPE_DISPLAY_LABELS[field.field_type] ?? field.field_type}
                          </span>
                          {field.is_required && field.is_active && (
                            <span className="text-xs text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">
                              Required
                            </span>
                          )}
                          {!field.is_active && (
                            <span
                              className="text-xs text-gray-600 bg-gray-200 px-1.5 py-0.5 rounded"
                              data-testid={`cf-inactive-badge-${field.field_key}`}
                            >
                              Inactive
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {field.field_key} &middot; {field.category_name}
                        </p>
                        {(field.field_type === 'enum' || field.field_type === 'multi_enum') &&
                          (() => {
                            const vals = (field.validation_rules as Record<string, unknown> | null)
                              ?.enum_values;
                            return Array.isArray(vals) && vals.length > 0 ? (
                              <p className="text-xs text-gray-500 mt-0.5">
                                Options: {(vals as string[]).join(', ')}
                              </p>
                            ) : null;
                          })()}
                      </div>
                      <div className="flex items-center gap-1">
                        {field.is_active ? (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => startEditing(field)}
                              className="text-gray-500 hover:text-blue-700 hover:bg-blue-50"
                              aria-label={`Edit ${field.display_name}`}
                              data-testid={`cf-edit-${field.field_key}`}
                            >
                              <Pencil size={14} />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDeactivateClick(field)}
                              disabled={isCheckingUsage}
                              className="text-red-500 hover:text-red-700 hover:bg-red-50"
                              aria-label={`Deactivate ${field.display_name}`}
                              data-testid={`cf-deactivate-${field.field_key}`}
                            >
                              <Trash2 size={14} />
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleReactivateClick(field)}
                              disabled={viewModel.isFieldLifecycleActionInProgress}
                              className="text-green-600 hover:text-green-700 hover:bg-green-50"
                              aria-label={`Reactivate ${field.display_name}`}
                              data-testid={`cf-reactivate-${field.field_key}`}
                            >
                              <RotateCcw size={14} />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDeleteClick(field)}
                              disabled={
                                isCheckingUsage || viewModel.isFieldLifecycleActionInProgress
                              }
                              className="text-red-600 hover:text-red-700 hover:bg-red-50"
                              aria-label={`Delete ${field.display_name}`}
                              data-testid={`cf-delete-${field.field_key}`}
                            >
                              <Trash2 size={14} />
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  )
                )}
              </div>
            )}

            {/* Deactivation confirmation dialog */}
            <ConfirmDialog
              isOpen={deactivateTarget !== null}
              title={`Deactivate "${deactivateTarget?.name}"?`}
              message={
                deactivateTarget && deactivateTarget.usageCount > 0
                  ? `This field has data for ${deactivateTarget.usageCount} registered client(s). Deactivating will hide the field from the intake form but preserve existing data.`
                  : 'This will remove the field from the intake form. No client data is affected.'
              }
              confirmLabel="Deactivate"
              cancelLabel="Cancel"
              variant="warning"
              isLoading={isDeactivating}
              onConfirm={confirmDeactivate}
              onCancel={() => setDeactivateTarget(null)}
            />

            {/* Reactivate confirmation dialog */}
            <ConfirmDialog
              isOpen={reactivateTarget !== null}
              title={`Reactivate "${reactivateTarget?.name}"?`}
              message={
                reactivateTarget?.parentCategoryInactive
                  ? `The parent category "${
                      reactivateTarget.parentCategoryName ?? ''
                    }" is currently inactive, so this field will stay hidden from the intake form until the category is reactivated too. Proceed anyway?`
                  : 'This will return the field to active status. It will re-appear on the intake form under its category.'
              }
              confirmLabel="Reactivate"
              cancelLabel="Cancel"
              variant="success"
              isLoading={viewModel.isFieldLifecycleActionInProgress}
              onConfirm={confirmReactivate}
              onCancel={() => setReactivateTarget(null)}
            />

            {/* Hard-delete confirmation dialog */}
            <ConfirmDialog
              isOpen={deleteTarget !== null}
              title={
                deleteTarget && deleteTarget.usageCount > 0
                  ? `Cannot delete "${deleteTarget.name}"`
                  : `Permanently delete "${deleteTarget?.name}"?`
              }
              message={
                deleteTarget && deleteTarget.usageCount > 0
                  ? `${deleteTarget.usageCount} client(s) have data for this field. Leave it deactivated to preserve the historical data, or clear the data before deleting.`
                  : 'This permanently removes the field definition. This cannot be undone.'
              }
              confirmLabel="Delete permanently"
              cancelLabel={deleteTarget && deleteTarget.usageCount > 0 ? 'Dismiss' : 'Cancel'}
              variant="danger"
              isLoading={viewModel.isFieldLifecycleActionInProgress}
              confirmDisabled={!!(deleteTarget && deleteTarget.usageCount > 0)}
              requireConfirmText={
                deleteTarget && deleteTarget.usageCount === 0 ? deleteTarget.name : undefined
              }
              onConfirm={confirmDelete}
              onCancel={() => setDeleteTarget(null)}
            />
          </CardContent>
        </Card>
      </div>
    );
  }
);
