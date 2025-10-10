import { makeAutoObservable, runInAction } from 'mobx';
import { Provider, ProviderFilterOptions, ProviderType, SubscriptionTier } from '@/types/provider.types';
import { providerService } from '@/services/providers/provider.service';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('viewmodel');

/**
 * ViewModel for Provider List Page
 * Manages state and business logic for displaying and filtering providers
 */
export class ProviderListViewModel {
  // Observable state
  providers: Provider[] = [];
  providerTypes: ProviderType[] = [];
  subscriptionTiers: SubscriptionTier[] = [];
  isLoading = false;
  error: string | null = null;
  searchTerm = '';
  selectedStatus: string = 'all';
  selectedType: string = 'all';

  constructor() {
    makeAutoObservable(this);
    this.initialize();
  }

  /**
   * Initialize the view model by loading initial data
   */
  async initialize(): Promise<void> {
    await Promise.all([
      this.loadProviders(),
      this.loadProviderTypes(),
      this.loadSubscriptionTiers()
    ]);
  }

  /**
   * Load all providers with current filters
   */
  async loadProviders(): Promise<void> {
    try {
      runInAction(() => {
        this.isLoading = true;
        this.error = null;
      });

      log.info('Loading providers');

      const filters: ProviderFilterOptions = {};

      if (this.searchTerm) {
        filters.searchTerm = this.searchTerm;
      }

      if (this.selectedStatus !== 'all') {
        filters.status = this.selectedStatus as any;
      }

      if (this.selectedType !== 'all') {
        filters.type = this.selectedType;
      }

      const providers = await providerService.getProviders(filters);

      runInAction(() => {
        this.providers = providers;
        this.isLoading = false;
      });

      log.info(`Loaded ${providers.length} providers`);
    } catch (error) {
      runInAction(() => {
        this.error = error instanceof Error ? error.message : 'Failed to load providers';
        this.isLoading = false;
      });
      log.error('Failed to load providers', error);
    }
  }

  /**
   * Load provider types for filtering
   */
  async loadProviderTypes(): Promise<void> {
    try {
      const types = await providerService.getProviderTypes();
      runInAction(() => {
        this.providerTypes = types;
      });
    } catch (error) {
      log.error('Failed to load provider types', error);
    }
  }

  /**
   * Load subscription tiers
   */
  async loadSubscriptionTiers(): Promise<void> {
    try {
      const tiers = await providerService.getSubscriptionTiers();
      runInAction(() => {
        this.subscriptionTiers = tiers;
      });
    } catch (error) {
      log.error('Failed to load subscription tiers', error);
    }
  }

  /**
   * Set search term and reload providers
   */
  setSearchTerm(term: string): void {
    runInAction(() => {
      this.searchTerm = term;
    });
    this.loadProviders();
  }

  /**
   * Set status filter and reload providers
   */
  setStatusFilter(status: string): void {
    runInAction(() => {
      this.selectedStatus = status;
    });
    this.loadProviders();
  }

  /**
   * Set type filter and reload providers
   */
  setTypeFilter(type: string): void {
    runInAction(() => {
      this.selectedType = type;
    });
    this.loadProviders();
  }

  /**
   * Delete (deactivate) a provider
   */
  async deleteProvider(id: string): Promise<void> {
    try {
      await providerService.deleteProvider(id);
      await this.loadProviders();
      log.info('Provider deleted', { id });
    } catch (error) {
      runInAction(() => {
        this.error = error instanceof Error ? error.message : 'Failed to delete provider';
      });
      log.error('Failed to delete provider', error);
    }
  }

  /**
   * Get filtered providers (computed)
   */
  get filteredProviders(): Provider[] {
    return this.providers;
  }

  /**
   * Get provider count by status
   */
  get providerCountByStatus(): Record<string, number> {
    const counts: Record<string, number> = {
      all: this.providers.length,
      pending: 0,
      active: 0,
      suspended: 0,
      inactive: 0
    };

    this.providers.forEach(provider => {
      counts[provider.status]++;
    });

    return counts;
  }

  /**
   * Clear error message
   */
  clearError(): void {
    runInAction(() => {
      this.error = null;
    });
  }

  /**
   * Cleanup when view model is disposed
   */
  dispose(): void {
    // Cleanup any subscriptions or timers if needed
    log.debug('ProviderListViewModel disposed');
  }
}