/**
 * Field Definition Tab
 *
 * Generic tab content showing all fields for a single category.
 * Reused for all 11 system category tabs.
 */

import React from 'react';
import { observer } from 'mobx-react-lite';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FieldDefinitionRow } from './FieldDefinitionRow';
import type { FieldDefinition } from '@/types/client-field-settings.types';
import { LOCKED_FIELD_KEYS } from '@/types/client-field-settings.types';

const glassCardStyle = {
  background: 'rgba(255, 255, 255, 0.7)',
  backdropFilter: 'blur(20px)',
  WebkitBackdropFilter: 'blur(20px)',
  border: '1px solid rgba(255, 255, 255, 0.3)',
  boxShadow: '0 2px 4px rgba(0, 0, 0, 0.05)',
};

interface FieldDefinitionTabProps {
  categoryName: string;
  categorySlug: string;
  fields: FieldDefinition[];
  isSaving: boolean;
  onToggleVisible: (fieldId: string) => void;
  onToggleRequired: (fieldId: string) => void;
  onSetLabel: (fieldId: string, label: string) => void;
}

export const FieldDefinitionTab: React.FC<FieldDefinitionTabProps> = observer(
  ({
    categoryName,
    categorySlug,
    fields,
    isSaving,
    onToggleVisible,
    onToggleRequired,
    onSetLabel,
  }) => {
    const configurableCount = fields.filter((f) => !LOCKED_FIELD_KEYS.has(f.field_key)).length;

    return (
      <div
        role="tabpanel"
        aria-labelledby={`tab-${categorySlug}`}
        id={`tabpanel-${categorySlug}`}
        data-testid={`tabpanel-${categorySlug}`}
      >
        <Card style={glassCardStyle}>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>{categoryName}</CardTitle>
              {configurableCount > 0 && (
                <span className="text-xs font-medium text-gray-500 bg-gray-100 px-2 py-1 rounded-full">
                  {configurableCount} configurable
                </span>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {fields.length === 0 ? (
              <p className="text-sm text-gray-500 py-4">No fields in this category.</p>
            ) : (
              <div className="divide-y divide-gray-100">
                {fields.map((field) => (
                  <FieldDefinitionRow
                    key={field.id}
                    field={field}
                    isSaving={isSaving}
                    onToggleVisible={onToggleVisible}
                    onToggleRequired={onToggleRequired}
                    onSetLabel={onSetLabel}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }
);
