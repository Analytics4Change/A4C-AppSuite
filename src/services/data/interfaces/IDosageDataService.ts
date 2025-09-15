import { 
  DosageForm, 
  DosageRoute, 
  DosageUnit, 
  DosageFrequency, 
  DosageFormUnits 
} from '@/types/models';

export interface DosageFormHierarchy {
  type: string;
  routes: Array<{
    name: string;
    units: DosageUnit[];
  }>;
}

export interface IDosageDataService {
  // Core data retrieval
  getDosageForms(): Promise<DosageForm[]>;
  getDosageRoutes(): Promise<DosageRoute[]>;
  getDosageUnits(): Promise<DosageFormUnits>;
  getDosageFrequencies(): Promise<DosageFrequency[]>;
  
  // Helper functions
  getDosageFormsByCategory(category: string): Promise<DosageForm[]>;
  getUnitsForDosageForm(form: string): Promise<DosageUnit[]>;
  getCategoryForDosageForm(form: string): Promise<string>;
  getRoutesByDosageForm(form: string): Promise<DosageRoute[]>;
  getAllCategories(): Promise<DosageForm[]>;
  getAllDosageForms(): Promise<string[]>;
  getAllUnits(): Promise<DosageUnit[]>;
  
  // Hierarchy access
  getDosageFormHierarchy(): Promise<DosageFormHierarchy[]>;
  getDosageFormMap(): Promise<Record<string, DosageForm>>;
}