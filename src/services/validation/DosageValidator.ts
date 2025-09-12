import { DosageForm, DosageRoute, DosageUnit } from '@/types/models';
import { 
  dosageUnits, 
  dosageForms,
  getAllDosageForms,
  getUnitsForDosageForm 
} from '@/mocks/data/dosages.mock';

export class DosageValidator {
  isValidDosageAmount(amount: string): boolean {
    if (!amount) return false;
    
    const numericRegex = /^\d*\.?\d*$/;
    const isNumericFormat = numericRegex.test(amount);
    const numericValue = parseFloat(amount);
    
    return isNumericFormat && !isNaN(numericValue) && numericValue > 0;
  }

  getUnitsForForm(route: DosageRoute | string): DosageUnit[] {
    // Use the new helper function from the hierarchical mock data
    return getUnitsForDosageForm(route) as DosageUnit[];
  }

  validateDosageForm(form: string): boolean {
    return dosageForms.includes(form as DosageForm);
  }

  validateDosageRoute(route: string): boolean {
    const validRoutes = getAllDosageForms();
    return validRoutes.includes(route);
  }

  validateDosageUnit(unit: string, route: DosageRoute | string): boolean {
    const availableUnits = this.getUnitsForForm(route);
    return availableUnits.includes(unit as DosageUnit);
  }

  validateDosageFrequency(frequency: string): boolean {
    const validFrequencies = [
      'Once daily', 'Twice daily', 'Three times daily', 'Four times daily',
      'Every 4 hours', 'Every 6 hours', 'Every 8 hours', 'Every 12 hours',
      'As needed'
    ];
    return validFrequencies.includes(frequency);
  }

  validateCompleteDosage(
    form: DosageForm | string,
    route: DosageRoute | string,
    amount: string,
    unit: DosageUnit | string,
    frequency: string
  ): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (form && !this.validateDosageForm(form)) {
      errors.push('Invalid dosage form');
    }

    if (!this.validateDosageRoute(route)) {
      errors.push('Invalid dosage route');
    }

    if (!this.isValidDosageAmount(amount)) {
      errors.push('Invalid dosage amount');
    }

    if (!this.validateDosageUnit(unit, route)) {
      errors.push('Invalid dosage unit for selected route');
    }

    if (!this.validateDosageFrequency(frequency)) {
      errors.push('Invalid dosage frequency');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }
}