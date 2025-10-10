import { 
  DosageForm, 
  DosageRoute, 
  DosageUnit, 
  DosageFrequency, 
  DosageFormUnits 
} from '@/types/models';
import { IDosageDataService, DosageFormHierarchy } from './interfaces/IDosageDataService';
import { 
  dosageForms,
  dosageRoutes,
  dosageUnits,
  dosageFrequencies,
  dosageFormHierarchy,
  dosageFormMap,
  getDosageFormsByCategory,
  getUnitsForDosageForm,
  getCategoryForDosageForm,
  getAllCategories,
  getAllDosageForms,
  getAllUnits
} from '@/data/static/dosages';

export class StaticDosageDataService implements IDosageDataService {
  // Core data retrieval
  async getDosageForms(): Promise<DosageForm[]> {
    return dosageForms;
  }

  async getDosageRoutes(): Promise<DosageRoute[]> {
    return dosageRoutes;
  }

  async getDosageUnits(): Promise<DosageFormUnits> {
    return dosageUnits;
  }

  async getDosageFrequencies(): Promise<DosageFrequency[]> {
    return dosageFrequencies;
  }

  // Helper functions
  async getDosageFormsByCategory(category: string): Promise<DosageForm[]> {
    const routes = getDosageFormsByCategory(category as DosageForm);
    return routes.map(r => r.name as DosageForm);
  }

  async getUnitsForDosageForm(form: string): Promise<DosageUnit[]> {
    const units = getUnitsForDosageForm(form);
    return units as DosageUnit[];
  }

  async getCategoryForDosageForm(form: string): Promise<string> {
    const category = getCategoryForDosageForm(form);
    return category || '';
  }

  async getRoutesByDosageForm(form: string): Promise<DosageRoute[]> {
    // This function needs to be implemented in the static data
    const hierarchy = dosageFormHierarchy.find(h => h.type === form);
    return hierarchy ? hierarchy.routes.map(r => r.name as DosageRoute) : [];
  }

  async getAllCategories(): Promise<DosageForm[]> {
    return getAllCategories();
  }

  async getAllDosageForms(): Promise<string[]> {
    return getAllDosageForms();
  }

  async getAllUnits(): Promise<DosageUnit[]> {
    const units = getAllUnits();
    return units as DosageUnit[];
  }

  // Hierarchy access
  async getDosageFormHierarchy(): Promise<DosageFormHierarchy[]> {
    return dosageFormHierarchy;
  }

  async getDosageFormMap(): Promise<Record<string, DosageForm>> {
    // Convert the DosageFormMap to the expected format
    const map: Record<string, DosageForm> = {};
    Object.entries(dosageFormMap).forEach(([key, routes]) => {
      // Take the first route's name as the representative DosageForm
      if (routes.length > 0) {
        map[key] = routes[0].name as DosageForm;
      }
    });
    return map;
  }
}