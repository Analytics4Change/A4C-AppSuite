import { Client } from '@/types/models';

export interface IClientApi {
  getClients(): Promise<Client[]>;
  getClient(id: string): Promise<Client>;
  searchClients(query: string): Promise<Client[]>;
  createClient(client: Omit<Client, 'id'>): Promise<Client>;
  updateClient(id: string, client: Partial<Client>): Promise<Client>;
  deleteClient(id: string): Promise<void>;
}