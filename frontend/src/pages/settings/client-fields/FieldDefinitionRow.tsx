/**
 * Field Definition Row
 *
 * Single field row with show/required toggles and optional label rename input.
 * Locked fields (mandatory) show a lock icon with disabled toggles.
 */

import React from 'react';
import { observer } from 'mobx-react-lite';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Lock, BarChart3 } from 'lucide-react';
import type { FieldDefinition } from '@/types/client-field-settings.types';
import { LOCKED_FIELD_KEYS } from '@/types/client-field-settings.types';

interface FieldDefinitionRowProps {
  field: FieldDefinition;
  isSaving: boolean;
  onToggleVisible: (fieldId: string) => void;
  onToggleRequired: (fieldId: string) => void;
  onSetLabel: (fieldId: string, label: string) => void;
}

export const FieldDefinitionRow: React.FC<FieldDefinitionRowProps> = observer(
  ({ field, isSaving, onToggleVisible, onToggleRequired, onSetLabel }) => {
    const isLocked = LOCKED_FIELD_KEYS.has(field.field_key);
    const switchId = `field-visible-${field.field_key}`;
    const requiredId = `field-required-${field.field_key}`;
    const descId = `field-desc-${field.field_key}`;

    return (
      <div
        className="flex items-start justify-between gap-4 py-3"
        data-testid={`field-row-${field.field_key}`}
      >
        <div className="flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <Label htmlFor={switchId} className="text-base font-medium">
              {field.display_name}
            </Label>
            {isLocked && (
              <span
                className="inline-flex items-center gap-1 text-xs text-amber-600"
                title="Mandatory field — cannot be hidden"
              >
                <Lock size={12} />
                Locked
              </span>
            )}
            {field.is_dimension && (
              <span
                className="inline-flex items-center gap-1 text-xs text-blue-600"
                title="Reporting dimension — used in analytics"
              >
                <BarChart3 size={12} />
              </span>
            )}
          </div>
          <p id={descId} className="text-sm text-gray-500">
            {field.field_type}
            {field.configurable_label ? ` — Label: "${field.configurable_label}"` : ''}
          </p>

          {/* Label rename input for non-locked fields */}
          {!isLocked && field.is_visible && (
            <div className="mt-2">
              <input
                type="text"
                value={field.configurable_label ?? ''}
                onChange={(e) => onSetLabel(field.id, e.target.value)}
                placeholder={`Custom label (default: ${field.display_name})`}
                disabled={isSaving}
                className="w-full max-w-xs rounded-md border border-gray-200 bg-white px-2 py-1 text-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                aria-label={`Custom label for ${field.display_name}`}
                data-testid={`field-label-${field.field_key}`}
              />
            </div>
          )}
        </div>

        <div className="flex items-center gap-4 shrink-0 pt-1">
          {/* Required toggle — only shown when field is visible and not locked */}
          {field.is_visible && !isLocked && (
            <div className="flex items-center gap-2">
              <Label htmlFor={requiredId} className="text-xs text-gray-500">
                Required
              </Label>
              <Switch
                id={requiredId}
                checked={field.is_required}
                onCheckedChange={() => onToggleRequired(field.id)}
                disabled={isSaving}
                aria-describedby={descId}
                data-testid={`field-required-${field.field_key}`}
              />
            </div>
          )}

          {/* Visible toggle */}
          <div className="flex items-center gap-2">
            <Label htmlFor={switchId} className="text-xs text-gray-500">
              Show
            </Label>
            <Switch
              id={switchId}
              checked={field.is_visible}
              onCheckedChange={() => onToggleVisible(field.id)}
              disabled={isSaving || isLocked}
              aria-describedby={descId}
              data-testid={`field-visible-${field.field_key}`}
            />
          </div>
        </div>
      </div>
    );
  }
);
