import { makeAutoObservable, runInAction } from 'mobx';
import type { IClientService } from '@/services/clients';
import type { ClientListItem } from '@/types/client.types';
import { Logger } from '@/utils/logger';
import { generateCorrelationId } from '@/utils/trace-ids';

const log = Logger.getLogger('viewmodel');

export class ClientSelectionViewModel {
  clients: ClientListItem[] = [];
  selectedClient: ClientListItem | null = null;
  searchQuery = '';
  isLoading = false;
  error: string | null = null;

  constructor(private clientService: IClientService) {
    makeAutoObservable(this);
    this.loadClients();
  }

  async loadClients() {
    const correlationId = generateCorrelationId();
    runInAction(() => {
      this.isLoading = true;
      this.error = null;
    });

    try {
      const clients = await this.clientService.listClients(undefined, undefined, correlationId);
      runInAction(() => {
        this.clients = clients;
      });
    } catch (error) {
      this.handleError('Failed to load clients', error, correlationId);
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
      // Empty query = fresh full-list load; loadClients() mints its own id.
      await this.loadClients();
      return;
    }

    const correlationId = generateCorrelationId();
    runInAction(() => {
      this.isLoading = true;
      this.error = null;
    });

    try {
      const clients = await this.clientService.listClients(undefined, query, correlationId);
      runInAction(() => {
        this.clients = clients;
      });
    } catch (error) {
      this.handleError('Failed to search clients', error, correlationId);
    } finally {
      runInAction(() => {
        this.isLoading = false;
      });
    }
  }

  selectClient(client: ClientListItem) {
    runInAction(() => {
      this.selectedClient = client;
    });
  }

  clearSelection() {
    runInAction(() => {
      this.selectedClient = null;
    });
  }

  getClientFullName(client: ClientListItem): string {
    if (client.preferred_name) {
      return `${client.preferred_name} (${client.first_name}) ${client.last_name}`;
    }
    return `${client.first_name} ${client.last_name}`;
  }

  getClientAge(client: ClientListItem): number {
    const today = new Date();
    const birthDate = new Date(client.date_of_birth);
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();

    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }

    return age;
  }

  private handleError(message: string, error: unknown, correlationId?: string) {
    log.error(message, { error, correlationId });
    runInAction(() => {
      this.error = message;
    });
  }
}
