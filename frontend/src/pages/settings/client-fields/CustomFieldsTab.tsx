/**
 * Custom Fields Tab
 *
 * CRUD interface for org-defined custom field definitions.
 * Add custom field form + table of existing custom fields with deactivate.
 */

import React, { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Plus, Trash2, Loader2, AlertCircle } from 'lucide-react';
import type { FieldDefinition, FieldCategory } from '@/types/client-field-settings.types';
import { SYSTEM_FIELD_KEYS, FIELD_TYPE_DISPLAY_LABELS } from '@/types/client-field-settings.types';
import type { ClientFieldSettingsViewModel } from '@/viewModels/settings/ClientFieldSettingsViewModel';

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
  { value: 'jsonb', label: FIELD_TYPE_DISPLAY_LABELS.jsonb },
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

    // Custom fields = non-locked, org-created fields (across all categories)
    const customFields = fields.filter((f) => !SYSTEM_FIELD_KEYS.has(f.field_key) && f.is_active);

    const fieldKey = name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, '_');

    const canCreate = name.trim().length > 0 && fieldKey.length > 0 && categoryId.length > 0;

    const handleCreate = async () => {
      if (!canCreate) return;
      const success = await viewModel.createCustomField(
        {
          field_key: `custom_${fieldKey}`,
          display_name: name.trim(),
          category_id: categoryId,
          field_type: fieldType,
          is_required: isRequired,
        },
        orgId
      );

      if (success) {
        setName('');
        setFieldType('text');
        setCategoryId('');
        setIsRequired(false);
        setShowForm(false);
      }
    };

    const handleDeactivate = async (fieldId: string, fieldName: string) => {
      await viewModel.deactivateCustomField(fieldId, `Removed custom field: ${fieldName}`, orgId);
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

                {viewModel.createFieldError && (
                  <div
                    role="alert"
                    className="flex items-center gap-2 p-2 bg-red-50 border border-red-200 rounded text-red-800 text-sm"
                  >
                    <AlertCircle size={14} />
                    {viewModel.createFieldError}
                  </div>
                )}

                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={handleCreate}
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
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setShowForm(false);
                      setName('');
                      setFieldType('text');
                      setCategoryId('');
                      setIsRequired(false);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {/* Custom fields table */}
            {customFields.length === 0 && !showForm ? (
              <p className="text-sm text-gray-500 py-4">
                No custom fields defined. Click &quot;Add Custom Field&quot; to create one.
              </p>
            ) : (
              <div className="divide-y divide-gray-100">
                {customFields.map((field) => (
                  <div
                    key={field.id}
                    className="flex items-center justify-between py-3"
                    data-testid={`custom-field-${field.field_key}`}
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{field.display_name}</span>
                        <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
                          {FIELD_TYPE_DISPLAY_LABELS[field.field_type] ?? field.field_type}
                        </span>
                        {field.is_required && (
                          <span className="text-xs text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">
                            Required
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {field.field_key} &middot; {field.category_name}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeactivate(field.id, field.display_name)}
                      className="text-red-500 hover:text-red-700 hover:bg-red-50"
                      aria-label={`Remove ${field.display_name}`}
                      data-testid={`cf-remove-${field.field_key}`}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }
);
