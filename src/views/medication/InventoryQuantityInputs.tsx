import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { EditableDropdown } from '@/components/ui/EditableDropdown';
import { useEnterAsTab } from '@/hooks/useEnterAsTab';

interface InventoryQuantityInputsProps {
  inventoryQuantity: string;
  inventoryUnit: string;
  availableInventoryUnits: string[];
  errors: Map<string, string>;
  onInventoryQuantityChange: (amount: string) => void;
  onInventoryUnitChange: (unit: string) => void;
  onDropdownOpen?: (elementId: string) => void;
}

export const InventoryQuantityInputs: React.FC<InventoryQuantityInputsProps> = ({
  inventoryQuantity,
  inventoryUnit,
  availableInventoryUnits,
  errors,
  onInventoryQuantityChange,
  onInventoryUnitChange,
  onDropdownOpen
}) => {
  // Hook for Enter key navigation in inventory quantity field
  const handleInventoryQuantityEnterKey = useEnterAsTab(17); // Move to Inventory Unit field

  return (
    <div className="grid grid-cols-2 gap-6">
      {/* Inventory Quantity */}
      <div>
        <Label htmlFor="inventory-quantity" className="text-base font-medium">
          Inventory Quantity
        </Label>
        <Input
          id="inventory-quantity"
          data-testid="inventory-quantity-input"
          type="text"
          value={inventoryQuantity}
          onChange={(e) => onInventoryQuantityChange(e.target.value)}
          onKeyDown={handleInventoryQuantityEnterKey}
          placeholder="e.g., 30"
          className={`mt-2 ${inventoryQuantity ? 'border-blue-500 bg-blue-50' : ''} ${errors.get('inventoryQuantity') ? 'border-red-500' : ''}`}
          aria-label="Inventory quantity"
          aria-describedby={errors.get('inventoryQuantity') ? 'inventory-quantity-error' : undefined}
          tabIndex={16}
        />
        {errors.get('inventoryQuantity') && (
          <p id="inventory-quantity-error" className="mt-1 text-sm text-red-600" role="alert">
            {errors.get('inventoryQuantity')}
          </p>
        )}
      </div>

      {/* Inventory Unit - Now using EditableDropdown for consistency */}
      <EditableDropdown
        id="inventory-unit"
        label="Inventory Unit"
        value={inventoryUnit}
        options={availableInventoryUnits}
        placeholder="Select inventory unit..."
        error={errors.get('inventoryUnit')}
        tabIndex={17}
        targetTabIndex={18}
        onChange={onInventoryUnitChange}
        onDropdownOpen={onDropdownOpen}
        filterMode="startsWith"
        testIdPrefix="inventory-unit"
      />
    </div>
  );
};