import { IMedicationApi } from '@/services/api/interfaces/IMedicationApi';
import { Medication, MedicationHistory, DosageInfo } from '@/types/models';
import { mockMedicationDatabase } from '@/mocks/data/medications.mock';

export class MockMedicationApi implements IMedicationApi {
  private medicationHistory: MedicationHistory[] = [];

  async searchMedications(query: string): Promise<Medication[]> {
    await this.simulateDelay(300);
    
    if (!query) return mockMedicationDatabase;
    
    const results = mockMedicationDatabase.filter(med =>
      med.name.toLowerCase().includes(query.toLowerCase()) ||
      med.genericName?.toLowerCase().includes(query.toLowerCase()) ||
      med.brandNames?.some(brand => brand.toLowerCase().includes(query.toLowerCase()))
    );
    
    return results;
  }

  async getMedication(id: string): Promise<Medication> {
    await this.simulateDelay(200);
    
    const medication = mockMedicationDatabase.find(med => med.id === id);
    if (!medication) {
      throw new Error(`Medication with id ${id} not found`);
    }
    
    return medication;
  }

  async saveMedication(dosageInfo: DosageInfo): Promise<void> {
    await this.simulateDelay(500);
    
    const medication = await this.getMedication(dosageInfo.medicationId);
    
    const history: MedicationHistory = {
      id: Date.now().toString(),
      medicationId: dosageInfo.medicationId,
      medication,
      startDate: dosageInfo.startDate || new Date(),
      discontinueDate: dosageInfo.discontinueDate,
      prescribingDoctor: dosageInfo.prescribingDoctor,
      dosageInfo,
      status: 'active'
    };
    
    this.medicationHistory.push(history);
    console.log('Mock: Saved medication', dosageInfo);
  }

  async getMedicationHistory(clientId: string): Promise<MedicationHistory[]> {
    await this.simulateDelay(300);
    return this.medicationHistory.filter(h => h.status === 'active');
  }

  async updateMedication(id: string, dosageInfo: Partial<DosageInfo>): Promise<void> {
    await this.simulateDelay(400);
    
    const historyIndex = this.medicationHistory.findIndex(h => h.id === id);
    if (historyIndex === -1) {
      throw new Error(`Medication history with id ${id} not found`);
    }
    
    this.medicationHistory[historyIndex].dosageInfo = {
      ...this.medicationHistory[historyIndex].dosageInfo,
      ...dosageInfo
    };
    
    console.log('Mock: Updated medication', id, dosageInfo);
  }

  async deleteMedication(id: string): Promise<void> {
    await this.simulateDelay(300);
    
    const historyIndex = this.medicationHistory.findIndex(h => h.id === id);
    if (historyIndex === -1) {
      throw new Error(`Medication history with id ${id} not found`);
    }
    
    this.medicationHistory[historyIndex].status = 'discontinued';
    this.medicationHistory[historyIndex].discontinueDate = new Date();
    
    console.log('Mock: Deleted medication', id);
  }

  async clearCache(): Promise<void> {
    await this.simulateDelay(100);
    // Mock implementation - could clear internal state if needed
    console.log('Mock: Cache cleared');
  }

  async getHealthStatus(): Promise<any> {
    await this.simulateDelay(50);
    return {
      status: 'healthy',
      uptime: Date.now(),
      cacheSize: this.medicationHistory.length,
      requestCount: 100,
      averageResponseTime: 250,
      errorRate: 0.0
    };
  }

  cancelAllRequests(): void {
    // Mock implementation - no actual requests to cancel
    console.log('Mock: All requests cancelled');
  }

  private simulateDelay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}