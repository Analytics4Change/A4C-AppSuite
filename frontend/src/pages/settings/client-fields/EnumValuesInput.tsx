/**
 * Enum Values Input
 *
 * Reusable chip-based input for managing single/multi-select dropdown options.
 * Used in both create and edit forms for custom field definitions.
 */

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { X } from 'lucide-react';

interface EnumValuesInputProps {
  values: string[];
  onChange: (values: string[]) => void;
  testIdPrefix: string;
}

export const EnumValuesInput: React.FC<EnumValuesInputProps> = ({
  values,
  onChange,
  testIdPrefix,
}) => {
  const [input, setInput] = useState('');

  const addValue = () => {
    const trimmed = input.trim();
    if (trimmed.length > 0 && !values.includes(trimmed)) {
      onChange([...values, trimmed]);
    }
    setInput('');
  };

  const removeValue = (val: string) => {
    onChange(values.filter((v) => v !== val));
  };

  return (
    <div>
      <Label>Select Options</Label>
      <div className="mt-1 flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addValue();
            }
          }}
          placeholder="Type a value and press Enter or click Add"
          className="flex-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          aria-label="New select option value"
          data-testid={`${testIdPrefix}-enum-input`}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addValue}
          disabled={input.trim().length === 0}
          data-testid={`${testIdPrefix}-enum-add-btn`}
        >
          Add
        </Button>
      </div>
      {values.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {values.map((val) => (
            <span
              key={val}
              className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-0.5 text-xs text-blue-800"
              data-testid={`${testIdPrefix}-enum-chip-${val}`}
            >
              {val}
              <button
                type="button"
                onClick={() => removeValue(val)}
                className="ml-0.5 hover:text-blue-600"
                aria-label={`Remove ${val}`}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      {values.length === 0 && (
        <p className="mt-1 text-xs text-gray-400">Add at least one option for the dropdown.</p>
      )}
    </div>
  );
};
