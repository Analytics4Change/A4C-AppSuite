/**
 * Organization List ViewModel
 *
 * Manages state and business logic for the organization list page.
 * Supports pagination, filtering, sorting, and search.
 *
 * Features:
 * - Paginated organization listing
 * - Type filter (provider, provider_partner, platform_owner)
 * - Status filter (active, inactive)
 * - Name/subdomain search with debouncing
 * - Sortable columns (name, type, created_at, updated_at)
 * - Loading and error states
 *
 * Usage:
 * ```typescript
 * const viewModel = new OrganizationListViewModel();
 * await viewModel.loadOrganizations();
 * viewModel.setSearchTerm('healthcare');
 * ```
 */

import { makeAutoObservable, runInAction } from 'mobx';
import type { IOrganizationQueryService } from '@/services/organization/IOrganizationQueryService';
import { createOrganizationQueryService } from '@/services/organization/OrganizationQueryServiceFactory';
import type { Organization, OrganizationQueryOptions } from '@/types/organization.types';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('viewmodel');

/**
 * Sort column options
 */
export type SortColumn = 'name' | 'type' | 'created_at' | 'updated_at';

/**
 * Sort direction options
 */
export type SortDirection = 'asc' | 'desc';

/**
 * Type filter options
 */
export type TypeFilter = 'all' | 'provider' | 'provider_partner' | 'platform_owner';

/**
 * Status filter options
 */
export type StatusFilter = 'all' | 'active' | 'inactive';

/**
 * Organization List ViewModel
 */
export class OrganizationListViewModel {
  // Data
  organizations: Organization[] = [];
  totalCount = 0;

  // Pagination
  currentPage = 1;
  pageSize = 20;
  totalPages = 0;

  // Filters
  searchTerm = '';
  typeFilter: TypeFilter = 'all';
  statusFilter: StatusFilter = 'all';

  // Sorting
  sortBy: SortColumn = 'name';
  sortOrder: SortDirection = 'asc';

  // Loading/Error states
  isLoading = false;
  error: string | null = null;

  // Debounce timer for search
  private searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly SEARCH_DEBOUNCE_MS = 300;

  /**
   * Constructor with dependency injection
   */
  constructor(
    private queryService: IOrganizationQueryService = createOrganizationQueryService()
  ) {
    makeAutoObservable(this);
    log.debug('OrganizationListViewModel initialized');
  }

  /**
   * Build query options from current state
   */
  private get queryOptions(): OrganizationQueryOptions {
    return {
      type: this.typeFilter === 'all' ? undefined : this.typeFilter,
      status: this.statusFilter === 'all' ? undefined : this.statusFilter,
      searchTerm: this.searchTerm || undefined,
      page: this.currentPage,
      pageSize: this.pageSize,
      sortBy: this.sortBy,
      sortOrder: this.sortOrder,
    };
  }

  /**
   * Load organizations with current filters and pagination
   */
  async loadOrganizations(): Promise<void> {
    runInAction(() => {
      this.isLoading = true;
      this.error = null;
    });

    try {
      log.debug('Loading organizations', { options: this.queryOptions });

      const result = await this.queryService.getOrganizationsPaginated(this.queryOptions);

      runInAction(() => {
        this.organizations = result.data;
        this.totalCount = result.totalCount;
        this.totalPages = result.totalPages;
        this.isLoading = false;
      });

      log.info(`Loaded ${result.data.length} organizations (page ${this.currentPage}/${result.totalPages})`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load organizations';
      runInAction(() => {
        this.error = message;
        this.isLoading = false;
      });
      log.error('Failed to load organizations', { error });
    }
  }

  /**
   * Go to next page
   */
  async loadNextPage(): Promise<void> {
    if (this.currentPage < this.totalPages) {
      runInAction(() => {
        this.currentPage += 1;
      });
      await this.loadOrganizations();
    }
  }

  /**
   * Go to previous page
   */
  async loadPreviousPage(): Promise<void> {
    if (this.currentPage > 1) {
      runInAction(() => {
        this.currentPage -= 1;
      });
      await this.loadOrganizations();
    }
  }

  /**
   * Go to specific page
   */
  async goToPage(page: number): Promise<void> {
    if (page >= 1 && page <= this.totalPages && page !== this.currentPage) {
      runInAction(() => {
        this.currentPage = page;
      });
      await this.loadOrganizations();
    }
  }

  /**
   * Set search term with debouncing
   */
  setSearchTerm(term: string): void {
    runInAction(() => {
      this.searchTerm = term;
    });

    // Clear existing timer
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
    }

    // Debounce the search
    this.searchDebounceTimer = setTimeout(() => {
      runInAction(() => {
        this.currentPage = 1; // Reset to first page on search
      });
      this.loadOrganizations();
    }, this.SEARCH_DEBOUNCE_MS);
  }

  /**
   * Set type filter and reload
   */
  async setTypeFilter(type: TypeFilter): Promise<void> {
    runInAction(() => {
      this.typeFilter = type;
      this.currentPage = 1; // Reset to first page
    });
    await this.loadOrganizations();
  }

  /**
   * Set status filter and reload
   */
  async setStatusFilter(status: StatusFilter): Promise<void> {
    runInAction(() => {
      this.statusFilter = status;
      this.currentPage = 1; // Reset to first page
    });
    await this.loadOrganizations();
  }

  /**
   * Set sort column
   */
  async setSortBy(column: SortColumn): Promise<void> {
    runInAction(() => {
      // If clicking same column, toggle direction
      if (this.sortBy === column) {
        this.sortOrder = this.sortOrder === 'asc' ? 'desc' : 'asc';
      } else {
        this.sortBy = column;
        this.sortOrder = 'asc';
      }
    });
    await this.loadOrganizations();
  }

  /**
   * Toggle sort direction
   */
  async toggleSortOrder(): Promise<void> {
    runInAction(() => {
      this.sortOrder = this.sortOrder === 'asc' ? 'desc' : 'asc';
    });
    await this.loadOrganizations();
  }

  /**
   * Clear all filters and reload
   */
  async clearFilters(): Promise<void> {
    runInAction(() => {
      this.searchTerm = '';
      this.typeFilter = 'all';
      this.statusFilter = 'all';
      this.sortBy = 'name';
      this.sortOrder = 'asc';
      this.currentPage = 1;
    });
    await this.loadOrganizations();
  }

  /**
   * Check if any filters are active
   */
  get hasActiveFilters(): boolean {
    return (
      this.searchTerm !== '' ||
      this.typeFilter !== 'all' ||
      this.statusFilter !== 'all'
    );
  }

  /**
   * Check if there are more pages
   */
  get hasNextPage(): boolean {
    return this.currentPage < this.totalPages;
  }

  /**
   * Check if there are previous pages
   */
  get hasPreviousPage(): boolean {
    return this.currentPage > 1;
  }

  /**
   * Get display range (e.g., "1-20 of 45")
   */
  get displayRange(): string {
    if (this.totalCount === 0) {
      return '0 results';
    }
    const start = (this.currentPage - 1) * this.pageSize + 1;
    const end = Math.min(this.currentPage * this.pageSize, this.totalCount);
    return `${start}-${end} of ${this.totalCount}`;
  }

  /**
   * Cleanup (clear debounce timer)
   */
  dispose(): void {
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
    }
  }
}
