import { useMemo } from 'react';
import { IMedicationApi } from '@/services/api/interfaces/IMedicationApi';
import { MockMedicationApi } from '@/services/mock/MockMedicationApi';
import { RXNormMedicationApi } from '@/services/api/RXNormMedicationApi';
import { MockClientApi } from '@/services/mock/MockClientApi';
import { DosageValidator } from '@/services/validation/DosageValidator';
import { MedicationManagementViewModel } from '@/viewModels/medication/MedicationManagementViewModel';
import { ClientSelectionViewModel } from '@/viewModels/client/ClientSelectionViewModel';

// Determine which API to use based on environment
const USE_RXNORM = import.meta.env.VITE_USE_RXNORM_API === 'true' || import.meta.env.PROD;

// Create singleton instances
const medicationApi: IMedicationApi = USE_RXNORM 
  ? new RXNormMedicationApi() 
  : new MockMedicationApi();

const clientApi = new MockClientApi();
const dosageValidator = new DosageValidator();

// Log which API is being used
if (import.meta.env.DEV) {
  console.log('[useViewModel] Using', USE_RXNORM ? 'RXNorm' : 'Mock', 'medication API');
}

// Store view model instances to reuse them
const viewModelInstances = new Map();

export function useViewModel<T>(
  ViewModelClass: new (...args: any[]) => T
): T {
  const viewModel = useMemo(() => {
    // Check if we already have an instance
    const className = ViewModelClass.name;
    if (viewModelInstances.has(className)) {
      return viewModelInstances.get(className) as T;
    }

    let instance: T;
    
    if (ViewModelClass === MedicationManagementViewModel as any) {
      instance = new MedicationManagementViewModel(medicationApi, dosageValidator) as T;
    } else if (ViewModelClass === ClientSelectionViewModel as any) {
      instance = new ClientSelectionViewModel(clientApi) as T;
    } else {
      throw new Error(`Unknown ViewModel class: ${className}`);
    }
    
    // Store the instance for reuse
    viewModelInstances.set(className, instance);
    return instance;
  }, [ViewModelClass]);

  return viewModel;
}