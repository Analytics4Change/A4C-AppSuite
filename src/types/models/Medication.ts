import { DosageForm, DosageUnit, DosageFrequency, DosageCondition } from './Dosage';

export interface Medication {
  id: string;
  name: string;
  genericName?: string;
  brandNames?: string[];
  categories: MedicationCategory;
  flags: MedicationFlags;
  activeIngredients?: string[];
}

export interface MedicationCategory {
  broad: string;
  specific: string;
  therapeutic?: string;
}

export interface MedicationFlags {
  isPsychotropic: boolean;
  isControlled: boolean;
  isNarcotic: boolean;
  requiresMonitoring: boolean;
}

export interface MedicationHistory {
  id: string;
  medicationId: string;
  medication: Medication;
  startDate: Date;
  discontinueDate?: Date;
  prescribingDoctor?: string;
  dosageInfo: DosageInfo;
  status: 'active' | 'discontinued' | 'on-hold';
}

export interface DosageInfo {
  medicationId: string;
  form: DosageForm;
  amount: number;
  unit: DosageUnit;
  frequency: DosageFrequency;
  condition?: DosageCondition;  // Made optional for backward compatibility
  timings?: string[];  // New field for multiple timing selections
  startDate?: Date;
  discontinueDate?: Date;
  prescribingDoctor?: string;
  notes?: string;
}