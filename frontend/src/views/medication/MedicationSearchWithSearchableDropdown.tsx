import React from 'react';
import { Check } from 'lucide-react';
import { SearchableDropdown } from '@/components/ui/searchable-dropdown';

interface MedicationSearchProps {
  value: string;
  searchResults: any[];
  isLoading: boolean;
  showDropdown: boolean;
  selectedMedication: any;
  error?: string;
  onSearch: (query: string) => void;
  onSelect: (medication: any) => void;
  onClear: () => void;
  onFieldComplete?: () => void;
  onDropdownOpen?: (elementId: string) => void;
}

export const MedicationSearch: React.FC<MedicationSearchProps> = ({
  value,
  searchResults,
  isLoading,
  showDropdown,
  selectedMedication,
  error,
  onSearch,
  onSelect,
  onClear,
  onFieldComplete,
  onDropdownOpen
}) => {
  return (
    <SearchableDropdown
      value={value}
      selectedItem={selectedMedication}
      searchResults={searchResults}
      isLoading={isLoading}
      showDropdown={showDropdown}
      onSearch={onSearch}
      onSelect={(medication, method) => {
        onSelect(medication);
        // Method parameter available if needed for focus advancement
      }}
      onClear={onClear}
      minSearchLength={2}
      placeholder="Type medication name..."
      error={error}
      renderItem={(medication, index, isHighlighted) => (
        <>
          <div className="font-medium text-gray-900">{medication.name}</div>
          {medication.genericName && (
            <div className="text-sm text-gray-600">
              Generic: {medication.genericName}
            </div>
          )}
          {medication.dosageStrength && (
            <div className="text-sm text-gray-500">
              {medication.dosageStrength}
            </div>
          )}
        </>
      )}
      renderSelectedItem={(medication) => (
        <>
          <div className="flex items-center gap-2 mb-2">
            <Check className="text-green-600" size={20} />
            <span className="font-semibold text-gray-900">
              {medication.name}
            </span>
          </div>
          {medication.genericName && (
            <p className="text-sm text-gray-600 mb-1">
              Generic: {medication.genericName}
            </p>
          )}
          {medication.dosageStrength && (
            <p className="text-sm text-gray-600">
              Strength: {medication.dosageStrength}
            </p>
          )}
        </>
      )}
      getItemKey={(medication) => medication.id || medication.name}
      getItemText={(medication) => medication.name}
      onFieldComplete={onFieldComplete}
      onDropdownOpen={onDropdownOpen}
      inputId="medication-search"
      dropdownId="medication-dropdown"
      label="Medication Name"
      required={true}
      tabIndex={1}
      autoFocus={true}
    />
  );
};