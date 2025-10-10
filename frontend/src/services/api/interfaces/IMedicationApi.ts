import { Medication, MedicationHistory, DosageInfo } from '@/types/models';

export interface IMedicationApi {
  searchMedications(query: string): Promise<Medication[]>;
  getMedication(id: string): Promise<Medication>;
  saveMedication(dosageInfo: DosageInfo): Promise<void>;
  getMedicationHistory(clientId: string): Promise<MedicationHistory[]>;
  updateMedication(id: string, dosageInfo: Partial<DosageInfo>): Promise<void>;
  deleteMedication(id: string): Promise<void>;
  clearCache(): Promise<void>;
  getHealthStatus(): Promise<any>;
  cancelAllRequests(): void;
}