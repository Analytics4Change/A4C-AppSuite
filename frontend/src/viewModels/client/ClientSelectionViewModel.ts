import { makeAutoObservable, runInAction } from 'mobx';
import { IClientApi } from '@/services/api/interfaces/IClientApi';
import { Client } from '@/types/models';

export class ClientSelectionViewModel {
  clients: Client[] = [];
  selectedClient: Client | null = null;
  searchQuery = '';
  isLoading = false;
  error: string | null = null;

  constructor(private clientApi: IClientApi) {
    makeAutoObservable(this);
    this.loadClients();
  }

  async loadClients() {
    runInAction(() => {
      this.isLoading = true;
      this.error = null;
    });
    
    try {
      const clients = await this.clientApi.getClients();
      runInAction(() => {
        this.clients = clients;
      });
    } catch (error) {
      this.handleError('Failed to load clients', error);
    } finally {
      runInAction(() => {
        this.isLoading = false;
      });
    }
  }

  async searchClients(query: string) {
    runInAction(() => {
      this.searchQuery = query;
    });
    
    if (!query) {
      await this.loadClients();
      return;
    }

    runInAction(() => {
      this.isLoading = true;
      this.error = null;
    });
    
    try {
      const clients = await this.clientApi.searchClients(query);
      runInAction(() => {
        this.clients = clients;
      });
    } catch (error) {
      this.handleError('Failed to search clients', error);
    } finally {
      runInAction(() => {
        this.isLoading = false;
      });
    }
  }

  selectClient(client: Client) {
    runInAction(() => {
      this.selectedClient = client;
    });
  }

  clearSelection() {
    runInAction(() => {
      this.selectedClient = null;
    });
  }

  getClientFullName(client: Client): string {
    return `${client.firstName} ${client.lastName}`;
  }

  getClientAge(client: Client): number {
    const today = new Date();
    const birthDate = new Date(client.dateOfBirth);
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    
    return age;
  }

  private handleError(message: string, error: any) {
    console.error(message, error);
    runInAction(() => {
      this.error = message;
    });
  }
}