import { makeAutoObservable, runInAction } from 'mobx';
import { IMedicationApi } from '@/services/api/interfaces/IMedicationApi';
import { 
  Medication, 
  DosageInfo, 
  DosageForm,  // Now refers to broad categories (Solid, Liquid, etc.)
  DosageRoute, // Specific routes (Tablet, Capsule, etc.)
  DosageUnit 
} from '@/types/models';
import { DosageValidator } from '@/services/validation/DosageValidator';
import { 
  getDosageFormsByCategory, 
  getUnitsForDosageForm,
  getCategoryForDosageForm 
} from '@/mocks/data/dosageFormHierarchy.mock';
import { MedicationManagementValidation } from './MedicationManagementValidation';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('viewmodel');

export class MedicationManagementViewModel {
  medicationName = '';
  selectedMedication: Medication | null = null;
  dosageForm: DosageForm | '' = '';  // Broad category (Solid, Liquid, etc.)
  dosageRoute = '';  // Specific route (Tablet, Capsule, etc.)
  dosageAmount = '';
  dosageUnit = '';
  inventoryQuantity = '';
  inventoryUnit = '';
  frequency = '';
  selectedTimings: string[] = [];  // Changed from single condition to multiple timings
  startDate: Date | null = null;
  discontinueDate: Date | null = null;
  prescribingDoctor = '';
  notes = '';
  
  // Pharmacy information
  prescriberName = '';
  pharmacyName = '';
  pharmacyPhone = '';
  rxNumber = '';
  
  isLoading = false;
  showMedicationDropdown = false;
  showDosageFormDropdown = false;
  showDosageRouteDropdown = false;
  showFormDropdown = false;
  showDosageUnitDropdown = false;
  showFrequencyDropdown = false;
  
  errors: Map<string, string> = new Map();
  
  searchResults: Medication[] = [];
  selectedTherapeuticClasses: string[] = [];
  
  // Auxiliary medication information
  isControlled: boolean | null = null;
  isPsychotropic: boolean | null = null;
  
  private validation: MedicationManagementValidation;

  constructor(
    private medicationApi: IMedicationApi,
    private validator: DosageValidator
  ) {
    makeAutoObservable(this);
    this.validation = new MedicationManagementValidation(this);
    this.validation.setupReactions();
  }

  get isValidAmount(): boolean {
    return this.validator.isValidDosageAmount(this.dosageAmount);
  }

  get availableDosageRoutes(): string[] {
    if (!this.dosageForm) return [];
    const dosageRoutes = getDosageFormsByCategory(this.dosageForm);
    return dosageRoutes.map(dr => dr.name);
  }

  get availableDosageUnits(): DosageUnit[] {
    // Units depend on the specific dosage route, not the category
    if (!this.dosageRoute) return [];
    // Use the helper function to get units for the selected dosage route
    return getUnitsForDosageForm(this.dosageRoute) as DosageUnit[];
  }

  get canSave(): boolean {
    return !!(
      this.selectedMedication &&
      this.dosageForm &&
      this.dosageRoute &&
      this.isValidAmount &&
      this.dosageUnit &&
      this.inventoryQuantity &&
      this.inventoryUnit &&
      this.frequency &&
      this.selectedTimings.length > 0 &&
      this.errors.size === 0
    );
  }

  async searchMedications(query: string) {
    runInAction(() => {
      this.medicationName = query;
      // If query is empty, immediately close dropdown
      if (!query) {
        this.searchResults = [];
        this.showMedicationDropdown = false;
        this.isLoading = false;
        log.debug('Empty query - closing dropdown');
        return;
      }
      this.isLoading = true;
    });
    
    // Don't make API call if query is empty
    if (!query) return;
    
    try {
      // Pass the actual query to get filtered results
      const results = await this.medicationApi.searchMedications(query);
      log.debug(`Search for "${query}" returned ${results.length} results`);
      runInAction(() => {
        this.searchResults = results;
        this.showMedicationDropdown = this.searchResults.length > 0;
        log.debug(`showMedicationDropdown = ${this.showMedicationDropdown}`);
      });
    } catch (error) {
      this.validation.handleError('Failed to search medications', error);
    } finally {
      runInAction(() => {
        this.isLoading = false;
      });
    }
  }

  selectMedication(medication: Medication) {
    runInAction(() => {
      this.selectedMedication = medication;
      this.medicationName = medication.name;
      this.showMedicationDropdown = false;
      
      if (medication.categories) {
        this.selectedTherapeuticClasses = [medication.categories.broad];
      }
    });
    this.validation.clearError('medication');
  }

  clearMedication() {
    runInAction(() => {
      // Clear medication selection
      this.selectedMedication = null;
      this.medicationName = '';
      this.searchResults = [];
      this.showMedicationDropdown = false;
      
      // Cascade clear ALL form fields (complete reset)
      this.dosageForm = '';
      this.dosageRoute = '';
      this.dosageAmount = '';
      this.dosageUnit = '';
      this.inventoryQuantity = '';
      this.inventoryUnit = '';
      this.frequency = '';
      this.selectedTimings = [];
      this.startDate = null;
      this.discontinueDate = null;
      this.prescribingDoctor = '';
      this.notes = '';
      this.prescriberName = '';
      this.pharmacyName = '';
      this.pharmacyPhone = '';
      this.rxNumber = '';
      this.selectedTherapeuticClasses = [];
      
      // Clear all dropdowns
      this.showDosageFormDropdown = false;
      this.showDosageRouteDropdown = false;
      this.showFormDropdown = false;
      this.showDosageUnitDropdown = false;
      this.showFrequencyDropdown = false;
      
      // Clear errors
      this.errors.clear();
    });
  }

  setDosageForm(form: DosageForm) {
    runInAction(() => {
      this.dosageForm = form;
      this.showDosageFormDropdown = false;
      // Reset dosage route and unit when form changes
      this.dosageRoute = '';
      this.dosageUnit = '';
      this.inventoryUnit = '';
    });
    this.validation.clearError('dosageForm');
  }


  setDosageRoute(dosageRoute: string) {
    runInAction(() => {
      // Set the specific dosage route (Tablet, Capsule, etc.)
      this.dosageRoute = dosageRoute;
      this.showDosageRouteDropdown = false;
      // Reset unit when dosage route changes
      this.dosageUnit = '';
    });
    this.validation.clearError('dosageRoute');
  }

  updateDosageAmount(value: string) {
    runInAction(() => {
      this.dosageAmount = value;
    });
    this.validation.validateDosageAmount();
  }

  setDosageUnit(dosageUnit: string) {
    runInAction(() => {
      this.dosageUnit = dosageUnit;
      this.showDosageUnitDropdown = false;
    });
    this.validation.clearError('dosageUnit');
  }

  updateInventoryQuantity(value: string) {
    runInAction(() => {
      this.inventoryQuantity = value;
    });
    this.validation.validateInventoryQuantity();
  }

  setInventoryUnit(inventoryUnit: string) {
    runInAction(() => {
      this.inventoryUnit = inventoryUnit;
    });
    this.validation.clearError('inventoryUnit');
  }

  setFrequency(freq: string) {
    runInAction(() => {
      this.frequency = freq;
      this.showFrequencyDropdown = false;
    });
    this.validation.clearError('frequency');
  }

  setSelectedTimings(timings: string[]) {
    runInAction(() => {
      this.selectedTimings = timings;
    });
    this.validation.clearError('dosageTimings');
  }

  setStartDate(date: Date | null) {
    runInAction(() => {
      this.startDate = date;
    });
    this.validation.clearError('startDate');
  }

  setDiscontinueDate(date: Date | null) {
    runInAction(() => {
      this.discontinueDate = date;
    });
    this.validation.clearError('discontinueDate');
  }

  toggleTherapeuticClass(category: string) {
    log.debug('toggleTherapeuticClass called with:', category);
    log.debug('Current selected:', [...this.selectedTherapeuticClasses]);
    runInAction(() => {
      const index = this.selectedTherapeuticClasses.indexOf(category);
      if (index > -1) {
        // Use replace to trigger MobX reactivity
        this.selectedTherapeuticClasses = this.selectedTherapeuticClasses.filter(c => c !== category);
        log.debug('Removed, new selected:', [...this.selectedTherapeuticClasses]);
      } else {
        // Create new array to trigger MobX reactivity
        this.selectedTherapeuticClasses = [...this.selectedTherapeuticClasses, category];
        log.debug('Added, new selected:', [...this.selectedTherapeuticClasses]);
      }
    });
  }


  // Setter methods for multi-select dropdowns
  setTherapeuticClasses(classes: string[]) {
    log.debug('setTherapeuticClasses called with:', classes);
    log.debug('Before update:', this.selectedTherapeuticClasses.slice());
    runInAction(() => {
      this.selectedTherapeuticClasses = classes;
      log.debug('After update:', this.selectedTherapeuticClasses.slice());
    });
  }

  setControlled(value: boolean) {
    runInAction(() => {
      this.isControlled = value;
    });
  }

  setPsychotropic(value: boolean) {
    runInAction(() => {
      this.isPsychotropic = value;
    });
  }

  // Pharmacy information setters
  setPrescriberName(value: string) {
    runInAction(() => {
      this.prescriberName = value;
    });
  }

  setPharmacyName(value: string) {
    runInAction(() => {
      this.pharmacyName = value;
    });
  }

  setPharmacyPhone(value: string) {
    runInAction(() => {
      this.pharmacyPhone = value;
    });
    this.validation.validatePharmacyPhone();
  }

  setRxNumber(value: string) {
    runInAction(() => {
      this.rxNumber = value;
    });
  }


  async save() {
    // Validate all required fields
    if (!this.validation.validateRequiredFields()) {
      return;
    }
    
    if (!this.canSave) return;

    const dosageInfo: DosageInfo = {
      medicationId: this.selectedMedication!.id,
      form: this.dosageRoute as DosageRoute,  // Use the specific route for the API
      amount: parseFloat(this.dosageAmount),
      unit: this.dosageUnit as DosageUnit,
      frequency: this.frequency as any,
      timings: this.selectedTimings,  // Now sending array of timings
      startDate: this.startDate || undefined,
      discontinueDate: this.discontinueDate || undefined,
      prescribingDoctor: this.prescribingDoctor || undefined,
      notes: this.notes || undefined
    };

    runInAction(() => {
      this.isLoading = true;
    });
    
    try {
      await this.medicationApi.saveMedication(dosageInfo);
      this.reset();
    } catch (error) {
      this.validation.handleError('Failed to save medication', error);
    } finally {
      runInAction(() => {
        this.isLoading = false;
      });
    }
  }

  reset() {
    this.medicationName = '';
    this.selectedMedication = null;
    this.dosageForm = '';
    this.dosageRoute = '';
    this.dosageAmount = '';
    this.dosageUnit = '';
    this.inventoryQuantity = '';
    this.inventoryUnit = '';
    this.frequency = '';
    this.selectedTimings = [];
    this.startDate = null;
    this.discontinueDate = null;
    this.prescribingDoctor = '';
    this.notes = '';
    this.prescriberName = '';
    this.pharmacyName = '';
    this.pharmacyPhone = '';
    this.rxNumber = '';
    this.errors.clear();
    this.searchResults = [];
    this.selectedTherapeuticClasses = [];
    this.isControlled = null;
    this.isPsychotropic = null;
    this.showMedicationDropdown = false;
    this.showDosageFormDropdown = false;
    this.showDosageRouteDropdown = false;
    this.showFormDropdown = false;
    this.showDosageUnitDropdown = false;
    this.showFrequencyDropdown = false;
  }
}