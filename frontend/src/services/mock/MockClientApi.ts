import { IClientApi } from '@/services/api/interfaces/IClientApi';
import { Client } from '@/types/models';
import { mockClients } from '@/mocks/data/clients.mock';

export class MockClientApi implements IClientApi {
  private clients: Client[] = [...mockClients];

  async getClients(): Promise<Client[]> {
    await this.simulateDelay(300);
    return this.clients.filter(c => c.status === 'active');
  }

  async getClient(id: string): Promise<Client> {
    await this.simulateDelay(200);
    
    const client = this.clients.find(c => c.id === id);
    if (!client) {
      throw new Error(`Client with id ${id} not found`);
    }
    
    return client;
  }

  async searchClients(query: string): Promise<Client[]> {
    await this.simulateDelay(300);
    
    const lowerQuery = query.toLowerCase();
    return this.clients.filter(client =>
      client.firstName.toLowerCase().includes(lowerQuery) ||
      client.lastName.toLowerCase().includes(lowerQuery) ||
      `${client.firstName} ${client.lastName}`.toLowerCase().includes(lowerQuery)
    );
  }

  async createClient(clientData: Omit<Client, 'id'>): Promise<Client> {
    await this.simulateDelay(500);
    
    const newClient: Client = {
      ...clientData,
      id: Date.now().toString()
    };
    
    this.clients.push(newClient);
    console.log('Mock: Created client', newClient);
    
    return newClient;
  }

  async updateClient(id: string, clientData: Partial<Client>): Promise<Client> {
    await this.simulateDelay(400);
    
    const clientIndex = this.clients.findIndex(c => c.id === id);
    if (clientIndex === -1) {
      throw new Error(`Client with id ${id} not found`);
    }
    
    this.clients[clientIndex] = {
      ...this.clients[clientIndex],
      ...clientData,
      id // Ensure ID doesn't change
    };
    
    console.log('Mock: Updated client', id, clientData);
    return this.clients[clientIndex];
  }

  async deleteClient(id: string): Promise<void> {
    await this.simulateDelay(300);
    
    const clientIndex = this.clients.findIndex(c => c.id === id);
    if (clientIndex === -1) {
      throw new Error(`Client with id ${id} not found`);
    }
    
    this.clients[clientIndex].status = 'inactive';
    console.log('Mock: Deleted client', id);
  }

  private simulateDelay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}