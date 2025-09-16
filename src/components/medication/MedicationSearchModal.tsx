import React, { useState, useRef, useEffect, RefObject } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MedicationSearch } from '@/views/medication/MedicationSearchWithSearchableDropdown';
import { useKeyboardNavigation } from '@/hooks/useKeyboardNavigation';
import { Logger } from '@/utils/logger';
import type { Medication } from '@/types/models/Medication';

const log = Logger.getLogger('component');

interface MedicationSearchModalProps {
  isOpen: boolean;
  onSelect: (medication: Medication) => void;
  onCancel: () => void;
  searchResults: Medication[];
  isLoading: boolean;
  onSearch: (query: string) => void;
}

export const MedicationSearchModal: React.FC<MedicationSearchModalProps> = ({
  isOpen,
  onSelect,
  onCancel,
  searchResults,
  isLoading,
  onSearch
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMedication, setSelectedMedication] = useState<Medication | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const modalRef = useRef<HTMLDivElement | null>(null);

  // Use keyboard navigation hook for focus trap
  useKeyboardNavigation({
    containerRef: modalRef as RefObject<HTMLElement>,
    enabled: isOpen,
    trapFocus: true,              // Trap focus within modal
    restoreFocus: true,           // Restore focus when modal closes
    onEscape: onCancel,           // ESC key closes modal
    wrapAround: true              // Tab from last element goes to first
  });

  // Log modal state
  useEffect(() => {
    if (isOpen) {
      log.info('Medication search modal opened');
    }
  }, [isOpen]);

  // Handle medication selection
  const handleSelect = (medication: Medication) => {
    log.debug('Medication selected in modal', { medication: medication.name });
    setSelectedMedication(medication);
    
    // Move focus to Continue button after selection
    requestAnimationFrame(() => {
      const continueBtn = modalRef.current?.querySelector('[tabindex="3"]') as HTMLButtonElement;
      if (continueBtn && !continueBtn.disabled) {
        continueBtn.focus();
        log.debug('Focus moved to Continue button');
      }
    });
  };

  // Handle confirm selection
  const handleConfirm = () => {
    if (selectedMedication) {
      log.info('Confirming medication selection', { medication: selectedMedication.name });
      onSelect(selectedMedication);
    }
  };

  // Handle search
  const handleSearch = (query: string) => {
    setSearchQuery(query);
    if (query.length >= 2) {
      setShowDropdown(true);
      onSearch(query);
    } else {
      setShowDropdown(false);
    }
  };

  // Clear selection
  const handleClear = () => {
    setSelectedMedication(null);
    setSearchQuery('');
    setShowDropdown(false);
    
    // Return focus to search input
    requestAnimationFrame(() => {
      const searchInput = modalRef.current?.querySelector('#medication-search') as HTMLInputElement;
      if (searchInput) {
        searchInput.focus();
        log.debug('Focus returned to search input');
      }
    });
  };

  if (!isOpen) return null;

  return (
    <div 
      ref={modalRef}
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="medication-search-modal-title"
      data-focus-context="modal"
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" />
      
      {/* Modal */}
      <div 
        className="relative bg-white rounded-xl shadow-xl max-w-2xl w-full mx-4 p-6"
      >
        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <h2 id="medication-search-modal-title" className="text-2xl font-semibold">
            Select Medication
          </h2>
          <Button
            variant="ghost"
            size="icon"
            onClick={onCancel}
            className="rounded-full"
            aria-label="Close modal and return to client page"
            tabIndex={4}
          >
            <X size={24} />
          </Button>
        </div>

        {/* Content */}
        <div className="space-y-4">
          <p className="text-gray-600">
            Search for and select the medication to prescribe. You must select a medication before configuring dosage details.
          </p>

          {/* Medication Search Component - includes its own selected display */}
          <MedicationSearch
            value={searchQuery}
            searchResults={searchResults}
            isLoading={isLoading}
            showDropdown={showDropdown}
            selectedMedication={selectedMedication}
            error={undefined}
            onSearch={handleSearch}
            onSelect={handleSelect}
            onClear={handleClear}
            onFieldComplete={() => {}}
            onDropdownOpen={() => {}}
          />
        </div>

        {/* Footer */}
        <div className="mt-6 flex justify-end gap-3">
          <Button
            variant="outline"
            onClick={onCancel}
            tabIndex={2}
            aria-label="Cancel and return to client page"
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!selectedMedication}
            tabIndex={3}
            aria-label="Continue with selected medication"
          >
            Continue with Selection
          </Button>
        </div>
      </div>
    </div>
  );
};