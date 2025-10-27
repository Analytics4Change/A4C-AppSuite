import { makeAutoObservable, runInAction } from 'mobx';
import { IMedicationApi } from '@/services/api/interfaces/IMedicationApi';
import {
  Medication,
  DosageInfo,
  DosageForm,  // Now refers to broad categories (Solid, Liquid, etc.)
  DosageRoute, // Specific routes (Tablet, Capsule, etc.)
  DosageUnit,
  DosageFrequency
} from '@/types/models';
import { DosageValidator } from '@/services/validation/DosageValidator';
import { IDosageDataService } from '@/services/data/interfaces/IDosageDataService';
import { DataServiceFactory } from '@/services/data/DataServiceFactory';
import { MedicationManagementValidation } from './MedicationManagementValidation';
import { Logger } from '@/utils/logger';
import { RXNormAdapter } from '@/services/adapters/RXNormAdapter';
import { IOrganizationService } from '@/services/organization/IOrganizationService';
import { eventEmitter } from '@/lib/events/event-emitter';
import { getAuthProvider } from '@/services/auth/AuthProviderFactory';

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
  selectedFrequencies: string[] = [];
  selectedTimings: string[] = [];  // Changed from single condition to multiple timings
  selectedFoodConditions: string[] = [];  // Food conditions selections
  selectedSpecialRestrictions: string[] = [];  // Special restrictions selections
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
  
  // Auxiliary medication information
  isControlled: boolean | null = null;
  isPsychotropic: boolean | null = null;
  controlledSchedule: string | undefined = undefined;
  psychotropicCategory: string | undefined = undefined;
  
  // Loading states for API calls
  isCheckingControlled = false;
  isCheckingPsychotropic = false;
  controlledCheckFailed = false;
  psychotropicCheckFailed = false;
  
  // Medication purpose fields
  selectedPurpose = '';
  availablePurposes: string[] = [];
  isLoadingPurposes = false;
  purposeLoadFailed = false;
  
  // Observable properties for UI
  availableDosageRoutes: string[] = [];
  availableDosageUnits: DosageUnit[] = [];
  availableDosageForms: DosageForm[] = [];
  
  private validation: MedicationManagementValidation;
  private rxnormAdapter: RXNormAdapter;
  private dosageService: IDosageDataService;

  constructor(
    private medicationApi: IMedicationApi,
    private validator: DosageValidator,
    private organizationService: IOrganizationService,
    dosageService?: IDosageDataService
  ) {
    this.dosageService = dosageService || DataServiceFactory.createDosageDataService();
    makeAutoObservable(this);
    this.validation = new MedicationManagementValidation(this);
    this.validation.setupReactions();
    this.rxnormAdapter = new RXNormAdapter();

    // Initialize dosage forms
    this.initializeDosageForms();
  }

  private async initializeDosageForms(): Promise<void> {
    try {
      const forms = await this.dosageService.getDosageForms();
      runInAction(() => {
        this.availableDosageForms = forms;
      });
    } catch (error) {
      log.error('Failed to initialize dosage forms', error);
    }
  }

  get isValidAmount(): boolean {
    return this.validator.isValidDosageAmount(this.dosageAmount);
  }

  async getAvailableDosageRoutes(): Promise<string[]> {
    if (!this.dosageForm) return [];
    const dosageRoutes = await this.dosageService.getDosageFormsByCategory(this.dosageForm);
    return dosageRoutes as string[];
  }

  async getAvailableDosageUnits(): Promise<DosageUnit[]> {
    // Units depend on the specific dosage route, not the category
    if (!this.dosageRoute) return [];
    // Use the helper function to get units for the selected dosage route
    return await this.dosageService.getUnitsForDosageForm(this.dosageRoute);
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
      this.selectedFrequencies.length > 0 &&
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
      
    });
    this.validation.clearError('medication');
    
    // Fetch controlled and psychotropic status
    // Defer to next tick to avoid setState during render
    Promise.resolve().then(() => {
      this.fetchMedicationClassifications(medication.name);
      this.fetchMedicationPurposes(medication.name);
    });
  }

  clearMedication() {
    runInAction(() => {
      // Clear medication selection
      this.selectedMedication = null;
      this.medicationName = '';
      this.searchResults = [];
      this.showMedicationDropdown = false;
      
      // Clear classification info
      this.isControlled = null;
      this.isPsychotropic = null;
      this.controlledSchedule = undefined;
      this.psychotropicCategory = undefined;
      this.isCheckingControlled = false;
      this.isCheckingPsychotropic = false;
      this.controlledCheckFailed = false;
      this.psychotropicCheckFailed = false;
      
      // Clear medication purpose
      this.selectedPurpose = '';
      this.availablePurposes = [];
      this.isLoadingPurposes = false;
      this.purposeLoadFailed = false;
      
      // Cascade clear ALL form fields (complete reset)
      this.dosageForm = '';
      this.dosageRoute = '';
      this.dosageAmount = '';
      this.dosageUnit = '';
      this.inventoryQuantity = '';
      this.inventoryUnit = '';
      this.selectedFrequencies = [];
      this.selectedTimings = [];
      this.selectedFoodConditions = [];
      this.selectedSpecialRestrictions = [];
      this.startDate = null;
      this.discontinueDate = null;
      this.prescribingDoctor = '';
      this.notes = '';
      this.prescriberName = '';
      this.pharmacyName = '';
      this.pharmacyPhone = '';
      this.rxNumber = '';
      
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
    // Update available dosage routes
    this.updateAvailableDosageRoutes();
  }

  private async updateAvailableDosageRoutes(): Promise<void> {
    try {
      const routes = await this.getAvailableDosageRoutes();
      runInAction(() => {
        this.availableDosageRoutes = routes;
        this.availableDosageUnits = []; // Clear units when routes change
      });
    } catch (error) {
      log.error('Failed to update dosage routes', error);
    }
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
    // Update available dosage units
    this.updateAvailableDosageUnits();
  }

  private async updateAvailableDosageUnits(): Promise<void> {
    try {
      const units = await this.getAvailableDosageUnits();
      runInAction(() => {
        this.availableDosageUnits = units;
      });
    } catch (error) {
      log.error('Failed to update dosage units', error);
    }
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

  setSelectedFrequencies(frequencies: string[]) {
    runInAction(() => {
      this.selectedFrequencies = frequencies;
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

  setSelectedFoodConditions(conditions: string[]) {
    runInAction(() => {
      this.selectedFoodConditions = conditions;
    });
    this.validation.clearError('foodConditions');
  }

  setSelectedSpecialRestrictions(restrictions: string[]) {
    runInAction(() => {
      this.selectedSpecialRestrictions = restrictions;
    });
    this.validation.clearError('specialRestrictions');
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
  
  setSelectedPurpose(purpose: string) {
    runInAction(() => {
      this.selectedPurpose = purpose;
    });
    this.validation.clearError('medicationPurpose');
  }

  /**
   * Fetch controlled and psychotropic classifications from RXNorm API
   * Now using byDrugName endpoint directly (matching A4C-BMS implementation)
   */
  private async fetchMedicationClassifications(medicationName: string) {
    log.info(`Fetching classifications for: ${medicationName}`);
    
    // Check controlled status
    runInAction(() => {
      this.isCheckingControlled = true;
      this.controlledCheckFailed = false;
    });
    
    try {
      const controlledStatus = await this.rxnormAdapter.checkControlledStatus(medicationName);
      runInAction(() => {
        if (controlledStatus.error) {
          this.controlledCheckFailed = true;
          this.isControlled = null;
        } else {
          this.isControlled = controlledStatus.isControlled;
          this.controlledSchedule = controlledStatus.scheduleClass;
          this.controlledCheckFailed = false;
        }
        this.isCheckingControlled = false;
      });
    } catch (error) {
      log.error('Failed to check controlled status', error);
      runInAction(() => {
        this.controlledCheckFailed = true;
        this.isCheckingControlled = false;
        this.isControlled = null;
      });
    }

    // Check psychotropic status
    runInAction(() => {
      this.isCheckingPsychotropic = true;
      this.psychotropicCheckFailed = false;
    });
    
    try {
      const psychotropicStatus = await this.rxnormAdapter.checkPsychotropicStatus(medicationName);
      runInAction(() => {
        if (psychotropicStatus.error) {
          this.psychotropicCheckFailed = true;
          this.isPsychotropic = null;
        } else {
          this.isPsychotropic = psychotropicStatus.isPsychotropic;
          this.psychotropicCategory = psychotropicStatus.category;
          this.psychotropicCheckFailed = false;
        }
        this.isCheckingPsychotropic = false;
      });
    } catch (error) {
      log.error('Failed to check psychotropic status', error);
      runInAction(() => {
        this.psychotropicCheckFailed = true;
        this.isCheckingPsychotropic = false;
        this.isPsychotropic = null;
      });
    }
  }

  /**
   * Fetch medication purposes (diseases/conditions it treats)
   * Using byDrugName endpoint with MEDRT classification
   */
  private async fetchMedicationPurposes(medicationName: string) {
    log.info(`Fetching therapeutic purposes for: ${medicationName}`);
    
    runInAction(() => {
      this.isLoadingPurposes = true;
      this.purposeLoadFailed = false;
      this.availablePurposes = [];
    });
    
    try {
      const purposes = await this.rxnormAdapter.getMedicationPurposes(medicationName);
      
      runInAction(() => {
        // Convert MedicationPurpose objects to strings for dropdown
        this.availablePurposes = purposes.map(p => {
          // Add context about whether it treats or prevents
          const action = p.rela === 'may_prevent' ? ' (Prevention)' : '';
          return p.className + action;
        });
        
        if (this.availablePurposes.length === 0) {
          log.warn(`No therapeutic purposes found for ${medicationName}`);
          this.purposeLoadFailed = true;
        }
        
        this.isLoadingPurposes = false;
      });
    } catch (error) {
      log.error('Failed to fetch medication purposes', error);
      runInAction(() => {
        this.purposeLoadFailed = true;
        this.isLoadingPurposes = false;
        this.availablePurposes = [];
      });
    }
  }

  async save(clientId: string) {
    // Validate all required fields
    if (!this.validation.validateRequiredFields()) {
      return;
    }

    if (!this.canSave) return;

    runInAction(() => {
      this.isLoading = true;
    });

    try {
      // Get organization ID from DI service
      const organizationId = await this.organizationService.getCurrentOrganizationId();

      // Get current user for metadata
      const authProvider = getAuthProvider();
      const user = await authProvider.getUser();
      if (!user) {
        throw new Error('No authenticated user found');
      }

      // Build event data matching MedicationPrescribedEventData interface
      const eventData = {
        organization_id: organizationId,
        client_id: clientId,
        medication_id: this.selectedMedication!.id,
        medication_name: this.selectedMedication!.name,

        // Prescription details
        prescription_date: new Date().toISOString().split('T')[0],
        start_date: this.startDate?.toISOString().split('T')[0] || new Date().toISOString().split('T')[0],
        end_date: this.discontinueDate?.toISOString().split('T')[0],
        prescriber_name: this.prescriberName || undefined,

        // Dosage information
        dosage_amount: parseFloat(this.dosageAmount),
        dosage_unit: this.dosageUnit,
        dosage_form: this.dosageForm as string,
        frequency: this.selectedFrequencies,
        timings: this.selectedTimings,
        food_conditions: this.selectedFoodConditions,
        special_restrictions: this.selectedSpecialRestrictions,
        route: this.dosageRoute,
        instructions: this.notes || undefined,

        // Inventory
        inventory_quantity: this.inventoryQuantity ? parseFloat(this.inventoryQuantity) : undefined,
        inventory_unit: this.inventoryUnit || undefined,

        // Pharmacy
        pharmacy_name: this.pharmacyName || undefined,
        pharmacy_phone: this.pharmacyPhone || undefined,
        rx_number: this.rxNumber || undefined,

        // Notes
        notes: this.notes || undefined,
      };

      // Emit medication.prescribed event
      const streamId = crypto.randomUUID();
      await eventEmitter.emit(
        streamId,
        'medication_history',
        'medication.prescribed',
        eventData,
        'New Medication Added', // Page-driven reason
        {
          controlled_substance: this.isControlled || false,
          therapeutic_purpose: this.selectedPurpose || undefined,
        }
      );

      log.info('Medication prescribed event emitted', { streamId, medication: this.selectedMedication!.name });

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
    this.selectedFrequencies = [];
    this.selectedTimings = [];
    this.selectedFoodConditions = [];
    this.selectedSpecialRestrictions = [];
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
    this.isControlled = null;
    this.isPsychotropic = null;
    this.controlledSchedule = undefined;
    this.psychotropicCategory = undefined;
    this.isCheckingControlled = false;
    this.isCheckingPsychotropic = false;
    this.controlledCheckFailed = false;
    this.psychotropicCheckFailed = false;
    this.selectedPurpose = '';
    this.availablePurposes = [];
    this.isLoadingPurposes = false;
    this.purposeLoadFailed = false;
    this.showMedicationDropdown = false;
    this.showDosageFormDropdown = false;
    this.showDosageRouteDropdown = false;
    this.showFormDropdown = false;
    this.showDosageUnitDropdown = false;
    this.showFrequencyDropdown = false;
  }
}