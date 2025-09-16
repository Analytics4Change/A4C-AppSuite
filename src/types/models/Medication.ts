import { DosageForm, DosageRoute, DosageUnit, DosageFrequency } from './Dosage';

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
  route?: DosageRoute;  // Specific route (Tablet, Capsule, etc.)
  amount: number;
  unit: DosageUnit;
  frequency: DosageFrequency | DosageFrequency[];  // Can be single or multiple frequencies
  timings?: string[];  // Multiple timing selections
  foodConditions?: string[];  // Food conditions array
  specialRestrictions?: string[];  // Special restrictions array
  startDate?: Date;
  discontinueDate?: Date;
  prescribingDoctor?: string;
  notes?: string;
}