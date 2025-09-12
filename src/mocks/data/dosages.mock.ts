import { DosageForm, DosageRoute, DosageUnit, DosageFrequency, DosageFormUnits } from '@/types/models';
import { 
  dosageFormHierarchy, 
  dosageFormMap,
  getAllCategories,
  getAllDosageForms,
  getRoutesByDosageForm,
  getDosageFormsByCategory,
  getUnitsForDosageForm
} from './dosageFormHierarchy.mock';

// Export all dosage forms (categories like Solid, Liquid, etc.)
export const dosageForms: DosageForm[] = getAllCategories();

// Export all dosage routes (specific forms like Tablet, Capsule, etc.)
export const dosageRoutes: DosageRoute[] = getAllDosageForms() as DosageRoute[];

// Export the hierarchical structure
export { dosageFormHierarchy, dosageFormMap } from './dosageFormHierarchy.mock';

// Export helper functions
export { 
  getDosageFormsByCategory,
  getUnitsForDosageForm,
  getCategoryForDosageForm,
  getAllCategories,
  getAllDosageForms,
  getAllUnits
} from './dosageFormHierarchy.mock';

// Build dosageUnits object for backward compatibility
export const dosageUnits: DosageFormUnits = (() => {
  const units: DosageFormUnits = {};
  for (const hierarchy of dosageFormHierarchy) {
    for (const form of hierarchy.routes) {
      units[form.name] = form.units;
    }
  }
  return units;
})();

export const dosageFrequencies: DosageFrequency[] = [
  'Once daily',
  'Twice daily',
  'Three times daily',
  'Four times daily',
  'Every 4 hours',
  'Every 6 hours',
  'Every 8 hours',
  'Every 12 hours',
  'As needed'
];