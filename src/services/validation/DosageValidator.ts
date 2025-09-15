import { DosageForm, DosageRoute, DosageUnit } from '@/types/models';
import { IDosageDataService } from '@/services/data/interfaces/IDosageDataService';
import { DataServiceFactory } from '@/services/data/DataServiceFactory';

export class DosageValidator {
  private dosageService: IDosageDataService;

  constructor(dosageService?: IDosageDataService) {
    this.dosageService = dosageService || DataServiceFactory.createDosageDataService();
  }
  isValidDosageAmount(amount: string): boolean {
    if (!amount) return false;
    
    const numericRegex = /^\d*\.?\d*$/;
    const isNumericFormat = numericRegex.test(amount);
    const numericValue = parseFloat(amount);
    
    return isNumericFormat && !isNaN(numericValue) && numericValue > 0;
  }

  async getUnitsForForm(route: DosageRoute | string): Promise<DosageUnit[]> {
    return await this.dosageService.getUnitsForDosageForm(route);
  }

  async validateDosageForm(form: string): Promise<boolean> {
    const dosageForms = await this.dosageService.getDosageForms();
    return dosageForms.includes(form as DosageForm);
  }

  async validateDosageRoute(route: string): Promise<boolean> {
    const validRoutes = await this.dosageService.getAllDosageForms();
    return validRoutes.includes(route);
  }

  async validateDosageUnit(unit: string, route: DosageRoute | string): Promise<boolean> {
    const availableUnits = await this.getUnitsForForm(route);
    return availableUnits.includes(unit as DosageUnit);
  }

  async validateDosageFrequency(frequency: string): Promise<boolean> {
    const validFrequencies = await this.dosageService.getDosageFrequencies();
    return validFrequencies.includes(frequency as any);
  }

  async validateCompleteDosage(
    form: DosageForm | string,
    route: DosageRoute | string,
    amount: string,
    unit: DosageUnit | string,
    frequency: string
  ): Promise<{ isValid: boolean; errors: string[] }> {
    const errors: string[] = [];

    if (form && !(await this.validateDosageForm(form))) {
      errors.push('Invalid dosage form');
    }

    if (!(await this.validateDosageRoute(route))) {
      errors.push('Invalid dosage route');
    }

    if (!this.isValidDosageAmount(amount)) {
      errors.push('Invalid dosage amount');
    }

    if (!(await this.validateDosageUnit(unit, route))) {
      errors.push('Invalid dosage unit for selected route');
    }

    if (!(await this.validateDosageFrequency(frequency))) {
      errors.push('Invalid dosage frequency');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }
}