import { makeAutoObservable, runInAction } from 'mobx';
import {
  CreateProviderRequest,
  UpdateProviderRequest,
  ProviderType,
  SubscriptionTier,
  SubProvider
} from '@/types/provider.types';
import { providerService } from '@/services/providers/provider.service';
import { zitadelProviderService } from '@/services/providers/zitadel-provider.service';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('viewmodel');

/**
 * ViewModel for Provider Create/Edit Forms
 * Manages form state and validation for provider management
 */
export class ProviderFormViewModel {
  // Form mode
  isEditMode = false;
  providerId: string | null = null;

  // Form fields
  name = '';
  type = '';
  primaryContactName = '';
  primaryContactEmail = '';
  primaryContactPhone = '';
  primaryAddress = '';
  billingContactName = '';
  billingContactEmail = '';
  billingContactPhone = '';
  billingAddress = '';
  taxId = '';
  subscriptionTierId = '';
  serviceStartDate: Date | null = null;
  adminEmail = '';
  status: 'pending' | 'active' | 'suspended' | 'inactive' = 'pending';

  // Reference data
  providerTypes: ProviderType[] = [];
  subscriptionTiers: SubscriptionTier[] = [];
  subProviders: SubProvider[] = [];

  // UI state
  isLoading = false;
  isSaving = false;
  error: string | null = null;
  validationErrors: Record<string, string> = {};

  constructor() {
    makeAutoObservable(this);
    this.loadReferenceData();
  }

  /**
   * Load reference data for dropdowns
   */
  async loadReferenceData(): Promise<void> {
    try {
      const [types, tiers] = await Promise.all([
        providerService.getProviderTypes(),
        providerService.getSubscriptionTiers()
      ]);

      runInAction(() => {
        this.providerTypes = types;
        this.subscriptionTiers = tiers;
      });
    } catch (error) {
      log.error('Failed to load reference data', error);
    }
  }

  /**
   * Initialize for creating a new provider
   */
  initializeForCreate(): void {
    runInAction(() => {
      this.isEditMode = false;
      this.providerId = null;
      this.resetForm();
    });
  }

  /**
   * Initialize for editing an existing provider
   */
  async initializeForEdit(providerId: string): Promise<void> {
    try {
      runInAction(() => {
        this.isLoading = true;
        this.error = null;
        this.isEditMode = true;
        this.providerId = providerId;
      });

      const [provider, subProviders] = await Promise.all([
        providerService.getProvider(providerId),
        providerService.getSubProviders(providerId)
      ]);

      if (!provider) {
        throw new Error('Provider not found');
      }

      runInAction(() => {
        this.name = provider.name;
        this.type = provider.type;
        this.status = provider.status;
        this.primaryContactName = provider.primaryContactName || '';
        this.primaryContactEmail = provider.primaryContactEmail || '';
        this.primaryContactPhone = provider.primaryContactPhone || '';
        this.primaryAddress = provider.primaryAddress || '';
        this.billingContactName = provider.billingContactName || '';
        this.billingContactEmail = provider.billingContactEmail || '';
        this.billingContactPhone = provider.billingContactPhone || '';
        this.billingAddress = provider.billingAddress || '';
        this.taxId = provider.taxId || '';
        this.subscriptionTierId = provider.subscriptionTierId || '';
        this.serviceStartDate = provider.serviceStartDate ? new Date(provider.serviceStartDate) : null;
        this.subProviders = subProviders;
        this.isLoading = false;
      });
    } catch (error) {
      runInAction(() => {
        this.error = error instanceof Error ? error.message : 'Failed to load provider';
        this.isLoading = false;
      });
      log.error('Failed to load provider for editing', error);
    }
  }

  /**
   * Validate form fields
   */
  validate(): boolean {
    const errors: Record<string, string> = {};

    if (!this.name.trim()) {
      errors.name = 'Provider name is required';
    }

    if (!this.type) {
      errors.type = 'Provider type is required';
    }

    if (!this.primaryContactName.trim()) {
      errors.primaryContactName = 'Primary contact name is required';
    }

    if (!this.primaryContactEmail.trim()) {
      errors.primaryContactEmail = 'Primary contact email is required';
    } else if (!this.isValidEmail(this.primaryContactEmail)) {
      errors.primaryContactEmail = 'Invalid email format';
    }

    if (!this.isEditMode) {
      if (!this.adminEmail.trim()) {
        errors.adminEmail = 'Administrator email is required';
      } else if (!this.isValidEmail(this.adminEmail)) {
        errors.adminEmail = 'Invalid email format';
      }
    }

    if (this.billingContactEmail && !this.isValidEmail(this.billingContactEmail)) {
      errors.billingContactEmail = 'Invalid email format';
    }

    runInAction(() => {
      this.validationErrors = errors;
    });

    return Object.keys(errors).length === 0;
  }

  /**
   * Save provider (create or update)
   */
  async save(): Promise<string | null> {
    if (!this.validate()) {
      return null;
    }

    try {
      runInAction(() => {
        this.isSaving = true;
        this.error = null;
      });

      let providerId: string;

      if (this.isEditMode && this.providerId) {
        // Update existing provider
        const updateRequest: UpdateProviderRequest = {
          name: this.name,
          type: this.type,
          status: this.status,
          primaryContactName: this.primaryContactName,
          primaryContactEmail: this.primaryContactEmail,
          primaryContactPhone: this.primaryContactPhone,
          primaryAddress: this.primaryAddress,
          billingContactName: this.billingContactName,
          billingContactEmail: this.billingContactEmail,
          billingContactPhone: this.billingContactPhone,
          billingAddress: this.billingAddress,
          taxId: this.taxId,
          subscriptionTierId: this.subscriptionTierId
        };

        await providerService.updateProvider(this.providerId, updateRequest);
        providerId = this.providerId;

        log.info('Provider updated successfully', { providerId });
      } else {
        // Create new provider
        const createRequest: CreateProviderRequest = {
          name: this.name,
          type: this.type,
          primaryContactName: this.primaryContactName,
          primaryContactEmail: this.primaryContactEmail,
          primaryContactPhone: this.primaryContactPhone,
          primaryAddress: this.primaryAddress,
          billingContactName: this.billingContactName,
          billingContactEmail: this.billingContactEmail,
          billingContactPhone: this.billingContactPhone,
          billingAddress: this.billingAddress,
          taxId: this.taxId,
          subscriptionTierId: this.subscriptionTierId,
          serviceStartDate: this.serviceStartDate || undefined,
          adminEmail: this.adminEmail
        };

        // First create the Zitadel organization
        const zitadelOrgId = await zitadelProviderService.createOrganization(createRequest);

        // Then create the provider record in our database
        const provider = await providerService.createProvider(createRequest, zitadelOrgId);
        providerId = provider.id;

        log.info('Provider created successfully', { providerId });
      }

      runInAction(() => {
        this.isSaving = false;
      });

      return providerId;
    } catch (error) {
      runInAction(() => {
        this.error = error instanceof Error ? error.message : 'Failed to save provider';
        this.isSaving = false;
      });
      log.error('Failed to save provider', error);
      return null;
    }
  }

  /**
   * Add a sub-provider
   */
  async addSubProvider(name: string, parentId?: string): Promise<void> {
    if (!this.providerId) {
      throw new Error('Provider ID is required to add sub-provider');
    }

    try {
      const subProvider = await providerService.createSubProvider(this.providerId, name, parentId);

      runInAction(() => {
        this.subProviders = [...this.subProviders, subProvider];
      });

      log.info('Sub-provider added', { id: subProvider.id, name });
    } catch (error) {
      log.error('Failed to add sub-provider', error);
      throw error;
    }
  }

  /**
   * Reset form to initial state
   */
  resetForm(): void {
    runInAction(() => {
      this.name = '';
      this.type = '';
      this.primaryContactName = '';
      this.primaryContactEmail = '';
      this.primaryContactPhone = '';
      this.primaryAddress = '';
      this.billingContactName = '';
      this.billingContactEmail = '';
      this.billingContactPhone = '';
      this.billingAddress = '';
      this.taxId = '';
      this.subscriptionTierId = '';
      this.serviceStartDate = null;
      this.adminEmail = '';
      this.status = 'pending';
      this.validationErrors = {};
      this.error = null;
      this.subProviders = [];
    });
  }

  /**
   * Validate email format
   */
  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Set a form field value
   */
  setField<K extends keyof this>(field: K, value: this[K]): void {
    runInAction(() => {
      this[field] = value;
      // Clear validation error for this field
      if (field in this.validationErrors) {
        delete this.validationErrors[field as string];
      }
    });
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
    this.resetForm();
    log.debug('ProviderFormViewModel disposed');
  }
}