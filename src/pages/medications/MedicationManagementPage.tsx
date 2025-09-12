import React, { useState, useEffect, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useViewModel } from '@/hooks/useViewModel';
import { MedicationManagementViewModel } from '@/viewModels/medication/MedicationManagementViewModel';
import { MedicationSearchModal } from '@/components/medication/MedicationSearchModal';
import { DosageFormEditable } from '@/views/medication/DosageFormEditable';
import { InventoryQuantityInputs } from '@/views/medication/InventoryQuantityInputs';
import { PharmacyInformationInputs } from '@/views/medication/PharmacyInformationInputs';
import { DateSelection } from '@/views/medication/DateSelectionSimplified';
import { DosageForm } from '@/types/models/Dosage';
import { useKeyboardNavigation } from '@/hooks/useKeyboardNavigation';
import { Logger } from '@/utils/logger';
import type { Medication } from '@/types/models/Medication';

const log = Logger.getLogger('component');

export const MedicationManagementPage = observer(() => {
  const { clientId } = useParams<{ clientId: string }>();
  const navigate = useNavigate();
  const vm = useViewModel(MedicationManagementViewModel);
  
  // State for modal visibility
  const [showSearchModal, setShowSearchModal] = useState(true);
  
  // Refs for focus management
  const changeMedicationButtonRef = useRef<HTMLButtonElement>(null);
  const formContainerRef = useRef<HTMLDivElement>(null);
  
  // Use keyboard navigation hook for focus trap when medication is selected
  const navResult = useKeyboardNavigation({
    containerRef: formContainerRef,
    enabled: !!vm.selectedMedication && !showSearchModal,
    trapFocus: true,              // Trap focus within form
    wrapAround: true,             // Tab from last element goes to first
    initialFocusRef: changeMedicationButtonRef,  // Focus the Change Medication button initially
    excludeSelectors: ['button[tabindex="-1"]']  // Exclude non-focusable buttons from trap
  });
  
  
  // Initialize on mount
  useEffect(() => {
    log.info('MedicationManagementPage mounted', { clientId });
    // Show search modal if no medication selected
    setShowSearchModal(!vm.selectedMedication);
    
    // If medication is already selected, focus the Change Medication button
    if (vm.selectedMedication && !showSearchModal) {
      requestAnimationFrame(() => {
        if (changeMedicationButtonRef.current) {
          changeMedicationButtonRef.current.focus();
          log.debug('Initial focus set to Change Medication button');
        }
      });
    }
  }, []);

  // Handle medication selection from modal
  const handleMedicationSelect = (medication: Medication) => {
    log.info('Medication selected', { medication: medication.name });
    vm.selectMedication(medication);
    setShowSearchModal(false);
    
    // Focus the Change Medication button after modal closes
    requestAnimationFrame(() => {
      if (changeMedicationButtonRef.current) {
        changeMedicationButtonRef.current.focus();
        log.debug('Focus moved to Change Medication button');
      }
    });
  };

  // Handle modal cancel
  const handleModalCancel = () => {
    log.info('Medication search cancelled, navigating back');
    navigate(`/clients/${clientId}/medications`);
  };

  // Handle back navigation
  const handleBack = () => {
    navigate(`/clients/${clientId}/medications`);
  };

  // Handle save
  const handleSave = async () => {
    if (isFormComplete()) {
      log.info('Saving medication');
      await vm.save();
      navigate(`/clients/${clientId}/medications`);
    }
  };

  // Check if form is complete
  const isFormComplete = () => {
    return vm.selectedMedication &&
           vm.dosageForm &&
           vm.dosageRoute &&
           vm.dosageAmount &&
           vm.dosageUnit &&
           vm.frequency &&
           vm.selectedTimings.length > 0 &&
           vm.startDate;
  };

  // Handle change medication
  const handleChangeMedication = () => {
    log.info('Change medication requested');
    setShowSearchModal(true);
  };

  return (
    <div className="relative min-h-screen">
      {/* Main content - blur when modal is open */}
      <div className={showSearchModal ? "blur-sm pointer-events-none" : ""}>
        {/* Header */}
        <div className="bg-white border-b px-6 py-4">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleBack}
              className="rounded-full"
              aria-label="Go back to medications list"
            >
              <ArrowLeft size={20} />
            </Button>
            <div>
              <h1 className="text-2xl font-bold">Add New Medication</h1>
              <p className="text-sm text-gray-600">Client ID: {clientId}</p>
            </div>
          </div>
        </div>

        {/* Form Content */}
        <div className="max-w-4xl mx-auto p-6">
          {vm.selectedMedication ? (
            <div ref={formContainerRef} className="space-y-6" data-focus-context="form">
              {/* Selected Medication Display */}
              <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-sm font-medium text-blue-900">Selected Medication</p>
                    <p className="text-xl font-semibold text-blue-700">{vm.selectedMedication.name}</p>
                    {vm.selectedMedication.genericName && (
                      <p className="text-sm text-blue-600">Generic: {vm.selectedMedication.genericName}</p>
                    )}
                  </div>
                  <Button
                    ref={changeMedicationButtonRef}
                    variant="outline"
                    size="sm"
                    onClick={handleChangeMedication}
                    tabIndex={1}
                    aria-label="Change selected medication"
                    className="relative overflow-hidden focus:ring-4 focus:ring-white/60 focus:ring-offset-2 focus:ring-offset-blue-200/70 focus:bg-white/95 focus:backdrop-blur-md focus:border-blue-400 focus:shadow-xl focus:shadow-blue-300/40 hover:bg-white/80 hover:backdrop-blur-sm transition-all duration-300 before:absolute before:inset-0 before:bg-gradient-to-r before:from-blue-400/0 before:via-blue-400/10 before:to-blue-400/0 before:opacity-0 focus:before:opacity-100 before:transition-opacity before:duration-500"
                  >
                    Change Medication
                  </Button>
                </div>
                
                {/* Divider */}
                <div className="border-t border-blue-200 my-4" />
                
                {/* Medication Properties */}
                <div className="grid grid-cols-2 gap-6">
                  {/* Controlled */}
                  <div>
                    <Label id="controlled-label" className="text-sm font-medium text-blue-900">Controlled</Label>
                    <div 
                      className="flex items-center space-x-3 mt-2 p-2 -m-2 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                      role="radiogroup"
                      aria-labelledby="controlled-label"
                      tabIndex={2}
                      onKeyDown={(e) => {
                        // Handle arrow key navigation within radio group - toggle between options
                        if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || 
                            e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                          e.preventDefault();
                          // Toggle: null→true, true→false, false→true
                          vm.setControlled(vm.isControlled === true ? false : true);
                        } else if (e.key === ' ') {
                          // Space key also toggles
                          e.preventDefault();
                          vm.setControlled(vm.isControlled === true ? false : true);
                        }
                      }}
                    >
                      <label className="flex items-center space-x-1 cursor-pointer">
                        <input
                          id="controlled-yes"
                          type="radio"
                          name="controlled"
                          value="true"
                          checked={vm.isControlled === true}
                          onChange={() => vm.setControlled(true)}
                          tabIndex={-1}
                          className="w-4 h-4 text-blue-600 focus:outline-none"
                          aria-label="Controlled substance - Yes"
                        />
                        <span className="text-sm text-blue-700">Yes</span>
                      </label>
                      <label className="flex items-center space-x-1 cursor-pointer">
                        <input
                          id="controlled-no"
                          type="radio"
                          name="controlled"
                          value="false"
                          checked={vm.isControlled === false}
                          onChange={() => vm.setControlled(false)}
                          tabIndex={-1}
                          className="w-4 h-4 text-blue-600 focus:outline-none"
                          aria-label="Controlled substance - No"
                        />
                        <span className="text-sm text-blue-700">No</span>
                      </label>
                    </div>
                  </div>
                  
                  {/* Psychotropic */}
                  <div>
                    <Label id="psychotropic-label" className="text-sm font-medium text-blue-900">Psychotropic</Label>
                    <div 
                      className="flex items-center space-x-3 mt-2 p-2 -m-2 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                      role="radiogroup"
                      aria-labelledby="psychotropic-label"
                      tabIndex={3}
                      onKeyDown={(e) => {
                        // Handle arrow key navigation within radio group - toggle between options
                        if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || 
                            e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                          e.preventDefault();
                          // Toggle: null→true, true→false, false→true
                          vm.setPsychotropic(vm.isPsychotropic === true ? false : true);
                        } else if (e.key === ' ') {
                          // Space key also toggles
                          e.preventDefault();
                          vm.setPsychotropic(vm.isPsychotropic === true ? false : true);
                        }
                      }}
                    >
                      <label className="flex items-center space-x-1 cursor-pointer">
                        <input
                          id="psychotropic-yes"
                          type="radio"
                          name="psychotropic"
                          value="true"
                          checked={vm.isPsychotropic === true}
                          onChange={() => vm.setPsychotropic(true)}
                          tabIndex={-1}
                          className="w-4 h-4 text-blue-600 focus:outline-none"
                          aria-label="Psychotropic medication - Yes"
                        />
                        <span className="text-sm text-blue-700">Yes</span>
                      </label>
                      <label className="flex items-center space-x-1 cursor-pointer">
                        <input
                          id="psychotropic-no"
                          type="radio"
                          name="psychotropic"
                          value="false"
                          checked={vm.isPsychotropic === false}
                          onChange={() => vm.setPsychotropic(false)}
                          tabIndex={-1}
                          className="w-4 h-4 text-blue-600 focus:outline-none"
                          aria-label="Psychotropic medication - No"
                        />
                        <span className="text-sm text-blue-700">No</span>
                      </label>
                    </div>
                  </div>
                </div>
              </div>

              {/* Dosage Form Configuration */}
              <div className="bg-white p-6 rounded-lg border">
                <h2 className="text-lg font-semibold mb-4">Dosage Configuration</h2>
                <DosageFormEditable
                  dosageForm={vm.dosageForm}
                  dosageRoute={vm.dosageRoute}
                  dosageAmount={vm.dosageAmount}
                  dosageUnit={vm.dosageUnit}
                  frequency={vm.frequency}
                  selectedTimings={vm.selectedTimings}
                  availableDosageRoutes={vm.availableDosageRoutes}
                  availableDosageUnits={vm.availableDosageUnits}
                  errors={vm.errors}
                  onDosageFormChange={(form) => vm.setDosageForm(form as DosageForm)}
                  onDosageRouteChange={(dosageRoute) => vm.setDosageRoute(dosageRoute)}
                  onDosageAmountChange={(amount) => vm.updateDosageAmount(amount)}
                  onDosageUnitChange={(dosageUnit) => vm.setDosageUnit(dosageUnit)}
                  onFrequencyChange={(freq) => vm.setFrequency(freq)}
                  onTimingsChange={(timings) => vm.setSelectedTimings(timings)}
                  onDropdownOpen={() => {}}
                />
              </div>


              {/* Date Selection */}
              <div className="bg-white p-6 rounded-lg border">
                <h2 className="text-lg font-semibold mb-4">Prescription Dates</h2>
                <DateSelection
                  startDate={vm.startDate ? vm.startDate.toISOString().split('T')[0] : ''}
                  discontinueDate={vm.discontinueDate ? vm.discontinueDate.toISOString().split('T')[0] : ''}
                  onStartDateChange={(date) => vm.setStartDate(date ? new Date(date) : null)}
                  onDiscontinueDateChange={(date) => vm.setDiscontinueDate(date ? new Date(date) : null)}
                  error={vm.errors.get('discontinueDate')}
                />
              </div>

              {/* Pharmacy Information */}
              <div className="bg-white p-6 rounded-lg border">
                <h2 className="text-lg font-semibold mb-4">Pharmacy Information</h2>
                <PharmacyInformationInputs
                  prescriberName={vm.prescriberName}
                  pharmacyName={vm.pharmacyName}
                  pharmacyPhone={vm.pharmacyPhone}
                  rxNumber={vm.rxNumber}
                  errors={vm.errors}
                  onPrescriberNameChange={(value) => vm.setPrescriberName(value)}
                  onPharmacyNameChange={(value) => vm.setPharmacyName(value)}
                  onPharmacyPhoneChange={(value) => vm.setPharmacyPhone(value)}
                  onRxNumberChange={(value) => vm.setRxNumber(value)}
                />
              </div>

              {/* Inventory Management */}
              <div className="bg-white p-6 rounded-lg border">
                <h2 className="text-lg font-semibold mb-4">Inventory Management</h2>
                <InventoryQuantityInputs
                  inventoryQuantity={vm.inventoryQuantity}
                  inventoryUnit={vm.inventoryUnit}
                  availableInventoryUnits={vm.availableDosageUnits}
                  errors={vm.errors}
                  onInventoryQuantityChange={(amount) => vm.updateInventoryQuantity(amount)}
                  onInventoryUnitChange={(unit) => vm.setInventoryUnit(unit)}
                  onDropdownOpen={() => {}}
                />
              </div>

              {/* Action Buttons */}
              <div className="flex justify-end gap-3 pt-4">
                <Button
                  variant="outline"
                  onClick={handleBack}
                  tabIndex={21}
                  aria-label="Cancel and go back"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleSave}
                  disabled={!isFormComplete() || vm.isLoading}
                  tabIndex={22}
                  aria-label="Save medication"
                >
                  {vm.isLoading ? 'Saving...' : 'Save Medication'}
                </Button>
              </div>
            </div>
          ) : (
            /* Empty state while modal is open */
            <div className="flex items-center justify-center h-64">
              <p className="text-gray-500">Select a medication to continue...</p>
            </div>
          )}
        </div>
      </div>

      {/* Medication Search Modal */}
      <MedicationSearchModal
        isOpen={showSearchModal}
        onSelect={handleMedicationSelect}
        onCancel={handleModalCancel}
        searchResults={vm.searchResults}
        isLoading={vm.isLoading}
        onSearch={(query) => vm.searchMedications(query)}
      />
    </div>
  );
});