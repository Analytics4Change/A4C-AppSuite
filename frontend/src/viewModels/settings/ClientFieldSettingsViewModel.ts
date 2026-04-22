/**
 * Client Field Settings ViewModel
 *
 * Manages state for the /settings/client-fields page.
 * Loads field definitions + categories, tracks changes for batch save,
 * and handles custom field/category CRUD.
 */

import { makeAutoObservable, runInAction, computed } from 'mobx';
import type {
  FieldDefinition,
  FieldCategory,
  FieldDefinitionChange,
  CreateFieldDefinitionParams,
  UpdateFieldDefinitionParams,
} from '@/types/client-field-settings.types';
import { LOCKED_FIELD_KEYS, SYSTEM_FIELD_KEYS } from '@/types/client-field-settings.types';
import type { IClientFieldService } from '@/services/client-fields/IClientFieldService';
import { getClientFieldService } from '@/services/client-fields/ClientFieldServiceFactory';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('viewmodel');

export type FieldStatusFilter = 'all' | 'active' | 'inactive';

export class ClientFieldSettingsViewModel {
  fieldDefinitions: FieldDefinition[] = [];
  originalFieldDefinitions: FieldDefinition[] = [];
  categories: FieldCategory[] = [];

  activeTab = 'demographics';

  // Status filters for Custom Fields and Categories tabs (mirrors Roles/OrgUnits/etc UX)
  fieldStatusFilter: FieldStatusFilter = 'active';
  categoryStatusFilter: FieldStatusFilter = 'active';

  isLoading = false;
  isSaving = false;
  loadError: string | null = null;
  saveError: string | null = null;
  saveSuccess = false;

  reason = '';

  // Custom field form state
  isCreatingField = false;
  createFieldError: string | null = null;

  // Custom field edit state
  isUpdatingField = false;
  updateFieldError: string | null = null;

  // Field lifecycle (reactivate / delete) state
  isFieldLifecycleActionInProgress = false;
  fieldLifecycleError: string | null = null;

  // Category form state
  isCreatingCategory = false;
  createCategoryError: string | null = null;

  // Category edit state
  isUpdatingCategory = false;
  updateCategoryError: string | null = null;

  // Category lifecycle (reactivate / delete) state
  isCategoryLifecycleActionInProgress = false;
  categoryLifecycleError: string | null = null;

  // Session-scoped correlation ID: ties all CRUD + batch save into one audit trail
  sessionCorrelationId: string | null = null;

  constructor(private service: IClientFieldService = getClientFieldService()) {
    makeAutoObservable(this, {
      fieldsByCategory: computed,
      tabList: computed,
      hasChanges: computed,
      changedFields: computed,
      canSave: computed,
      isReasonValid: computed,
      configurableFieldCount: computed,
      visibleCustomFields: computed,
      visibleCustomCategories: computed,
    });
    log.debug('ClientFieldSettingsViewModel initialized');
  }

  /** Lazily generate a session correlation ID, shared across all writes until save/reset */
  private getSessionCorrelationId(): string {
    if (!this.sessionCorrelationId) {
      runInAction(() => {
        this.sessionCorrelationId = globalThis.crypto.randomUUID();
      });
    }
    return this.sessionCorrelationId!;
  }

  async loadData(orgId: string, preserveChanges = false): Promise<void> {
    // Snapshot pending diffs before fetch so we can re-apply after reload
    const pendingChanges = preserveChanges ? this.changedFields : [];
    const pendingReason = preserveChanges ? this.reason : '';

    runInAction(() => {
      this.isLoading = true;
      this.loadError = null;
      this.saveSuccess = false;
    });

    try {
      log.debug('Loading field definitions and categories', { orgId, preserveChanges });
      // Always fetch inactive rows too; the UI filters client-side via status filters
      // so deactivated custom fields and categories can surface under the Inactive tab.
      const [fields, categories] = await Promise.all([
        this.service.listFieldDefinitions(true),
        this.service.listFieldCategories(true),
      ]);

      runInAction(() => {
        this.fieldDefinitions = fields;
        this.originalFieldDefinitions = fields.map((f) => ({ ...f }));
        this.categories = categories;
        this.isLoading = false;

        // Re-apply pending field definition changes if preserving
        if (pendingChanges.length > 0) {
          this.fieldDefinitions = this.fieldDefinitions.map((field) => {
            const pending = pendingChanges.find((c) => c.field_id === field.id);
            if (!pending) return field;
            return {
              ...field,
              ...(pending.is_visible !== undefined && { is_visible: pending.is_visible }),
              ...(pending.is_required !== undefined && { is_required: pending.is_required }),
              ...(pending.configurable_label !== undefined && {
                configurable_label: pending.configurable_label || null,
              }),
            };
          });
          this.reason = pendingReason;
          log.debug('Re-applied pending changes after reload', { count: pendingChanges.length });
        } else {
          this.reason = '';
        }
      });

      log.info('Field settings loaded', {
        fieldCount: fields.length,
        categoryCount: categories.length,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load settings';
      runInAction(() => {
        this.loadError = message;
        this.isLoading = false;
      });
      log.error('Failed to load field settings', { error });
    }
  }

  /**
   * Active fields grouped by category slug, ordered by category sort_order then field sort_order.
   * Excludes deactivated rows — the system category tabs always show only active fields.
   * Inactive rows surface only in the Custom Fields / Categories tabs via visibleCustomFields.
   */
  get fieldsByCategory(): Map<string, FieldDefinition[]> {
    const map = new Map<string, FieldDefinition[]>();
    for (const field of this.fieldDefinitions) {
      if (!field.is_active) continue;
      const group = map.get(field.category_slug) ?? [];
      group.push(field);
      map.set(field.category_slug, group);
    }
    return map;
  }

  /** Tab list: system categories (by sort_order) + custom categories (alphabetical) + fixed tabs */
  get tabList(): Array<{ slug: string; name: string }> {
    const active = this.categories.filter((c) => c.is_active);
    const systemTabs = active
      .filter((c) => c.is_system)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((c) => ({ slug: c.slug, name: c.name }));
    const customTabs = active
      .filter((c) => !c.is_system)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((c) => ({ slug: c.slug, name: c.name }));
    return [
      ...systemTabs,
      ...customTabs,
      { slug: 'custom_fields', name: 'Custom Fields' },
      { slug: 'categories', name: 'Categories' },
    ];
  }

  /** Count of non-locked (configurable) fields in the active tab */
  get configurableFieldCount(): number {
    const fields = this.fieldsByCategory.get(this.activeTab) ?? [];
    return fields.filter((f) => !LOCKED_FIELD_KEYS.has(f.field_key)).length;
  }

  /**
   * Custom (org-created) fields honoring the Custom Fields tab status filter.
   * Replaces inline `f.is_active` filtering in CustomFieldsTab so deactivated
   * rows can remain visible for reactivate / delete actions.
   * Sorted alphabetically by display name (matches existing behavior).
   */
  get visibleCustomFields(): FieldDefinition[] {
    return this.fieldDefinitions
      .filter((f) => !SYSTEM_FIELD_KEYS.has(f.field_key))
      .filter((f) => {
        if (this.fieldStatusFilter === 'all') return true;
        if (this.fieldStatusFilter === 'active') return f.is_active;
        return !f.is_active;
      })
      .sort((a, b) => a.display_name.localeCompare(b.display_name));
  }

  /**
   * Custom (org-created) categories honoring the Categories tab status filter.
   * System categories are always included (they are always active and cannot
   * be filtered out), matching the read-only row visibility from before.
   */
  get visibleCustomCategories(): FieldCategory[] {
    return this.categories.filter((c) => {
      if (c.is_system) return true;
      if (this.categoryStatusFilter === 'all') return true;
      if (this.categoryStatusFilter === 'active') return c.is_active;
      return !c.is_active;
    });
  }

  get hasChanges(): boolean {
    return this.changedFields.length > 0;
  }

  get changedFields(): FieldDefinitionChange[] {
    const changes: FieldDefinitionChange[] = [];
    for (const field of this.fieldDefinitions) {
      const original = this.originalFieldDefinitions.find((f) => f.id === field.id);
      if (!original) continue;
      // Inactive fields can't be batch-edited — they must be reactivated first.
      if (!field.is_active) continue;
      if (LOCKED_FIELD_KEYS.has(field.field_key)) continue;

      const change: FieldDefinitionChange = { field_id: field.id };
      let hasChange = false;

      if (field.is_visible !== original.is_visible) {
        change.is_visible = field.is_visible;
        hasChange = true;
      }
      if (field.is_required !== original.is_required) {
        change.is_required = field.is_required;
        hasChange = true;
      }
      if (field.configurable_label !== original.configurable_label) {
        change.configurable_label = field.configurable_label ?? '';
        hasChange = true;
      }

      if (hasChange) changes.push(change);
    }
    return changes;
  }

  get isReasonValid(): boolean {
    return this.reason.trim().length >= 10;
  }

  get canSave(): boolean {
    return this.hasChanges && this.isReasonValid && !this.isSaving;
  }

  get hasPreviousTab(): boolean {
    const tabs = this.tabList;
    const idx = tabs.findIndex((t) => t.slug === this.activeTab);
    return idx > 0;
  }

  get hasNextTab(): boolean {
    const tabs = this.tabList;
    const idx = tabs.findIndex((t) => t.slug === this.activeTab);
    return idx >= 0 && idx < tabs.length - 1;
  }

  // ── Actions ──

  previousTab(): void {
    const tabs = this.tabList;
    const idx = tabs.findIndex((t) => t.slug === this.activeTab);
    if (idx > 0) {
      this.setActiveTab(tabs[idx - 1].slug);
    }
  }

  nextTab(): void {
    const tabs = this.tabList;
    const idx = tabs.findIndex((t) => t.slug === this.activeTab);
    if (idx >= 0 && idx < tabs.length - 1) {
      this.setActiveTab(tabs[idx + 1].slug);
    }
  }

  setActiveTab(slug: string): void {
    runInAction(() => {
      this.activeTab = slug;
    });
  }

  setFieldStatusFilter(filter: FieldStatusFilter): void {
    runInAction(() => {
      this.fieldStatusFilter = filter;
    });
  }

  setCategoryStatusFilter(filter: FieldStatusFilter): void {
    runInAction(() => {
      this.categoryStatusFilter = filter;
    });
  }

  clearFieldLifecycleError(): void {
    runInAction(() => {
      this.fieldLifecycleError = null;
    });
  }

  clearCategoryLifecycleError(): void {
    runInAction(() => {
      this.categoryLifecycleError = null;
    });
  }

  toggleVisible(fieldId: string): void {
    runInAction(() => {
      this.fieldDefinitions = this.fieldDefinitions.map((f) => {
        if (f.id !== fieldId) return f;
        const newVisible = !f.is_visible;
        return {
          ...f,
          is_visible: newVisible,
          // When hiding a field, also uncheck required
          is_required: newVisible ? f.is_required : false,
        };
      });
      this.saveSuccess = false;
    });
  }

  toggleRequired(fieldId: string): void {
    runInAction(() => {
      this.fieldDefinitions = this.fieldDefinitions.map((f) =>
        f.id === fieldId ? { ...f, is_required: !f.is_required } : f
      );
      this.saveSuccess = false;
    });
  }

  setLabel(fieldId: string, label: string): void {
    runInAction(() => {
      this.fieldDefinitions = this.fieldDefinitions.map((f) =>
        f.id === fieldId ? { ...f, configurable_label: label || null } : f
      );
      this.saveSuccess = false;
    });
  }

  setReason(value: string): void {
    runInAction(() => {
      this.reason = value;
      this.saveSuccess = false;
    });
  }

  async saveChanges(orgId: string): Promise<boolean> {
    if (!this.canSave) return false;

    runInAction(() => {
      this.isSaving = true;
      this.saveError = null;
      this.saveSuccess = false;
    });

    try {
      const changes = this.changedFields;
      log.debug('Saving field configuration', { changeCount: changes.length });

      const correlationId = this.getSessionCorrelationId();
      const result = await this.service.batchUpdateFieldDefinitions(
        changes,
        this.reason.trim(),
        correlationId
      );

      if (!result.success) {
        throw new Error('Batch update failed');
      }

      if (result.failed.length > 0) {
        log.warn('Some fields failed to update', { failed: result.failed });
      }

      // Reload to confirm server state (clean slate — changes already saved)
      await this.loadData(orgId);

      runInAction(() => {
        this.isSaving = false;
        this.saveSuccess = true;
        this.reason = '';
        this.sessionCorrelationId = null; // New session begins
      });

      log.info('Field configuration saved', { updatedCount: result.updated_count });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save';
      runInAction(() => {
        this.saveError = message;
        this.isSaving = false;
      });
      log.error('Failed to save field configuration', { error });
      return false;
    }
  }

  resetChanges(): void {
    runInAction(() => {
      this.fieldDefinitions = this.originalFieldDefinitions.map((f) => ({ ...f }));
      this.reason = '';
      this.saveError = null;
      this.saveSuccess = false;
      this.sessionCorrelationId = null; // New session begins
    });
  }

  clearFieldErrors(): void {
    runInAction(() => {
      this.createFieldError = null;
      this.updateFieldError = null;
    });
  }

  clearCategoryErrors(): void {
    runInAction(() => {
      this.createCategoryError = null;
      this.updateCategoryError = null;
    });
  }

  // ── Custom Field CRUD ──

  async createCustomField(params: CreateFieldDefinitionParams, orgId: string): Promise<boolean> {
    runInAction(() => {
      this.isCreatingField = true;
      this.createFieldError = null;
    });

    try {
      const correlationId = this.getSessionCorrelationId();
      const result = await this.service.createFieldDefinition(params, correlationId);
      if (!result.success) {
        const friendlyError = result.error?.includes('Field key already exists')
          ? `"${params.display_name}" already exists. Choose another name.`
          : (result.error ?? 'Failed to create field');
        runInAction(() => {
          this.createFieldError = friendlyError;
          this.isCreatingField = false;
        });
        return false;
      }

      await this.loadData(orgId, true);
      runInAction(() => {
        this.isCreatingField = false;
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create field';
      runInAction(() => {
        this.createFieldError = message;
        this.isCreatingField = false;
      });
      return false;
    }
  }

  async deactivateCustomField(fieldId: string, reason: string, orgId: string): Promise<boolean> {
    try {
      const correlationId = this.getSessionCorrelationId();
      const result = await this.service.deactivateFieldDefinition(fieldId, reason, correlationId);
      if (!result.success) return false;
      await this.loadData(orgId, true);
      return true;
    } catch {
      return false;
    }
  }

  async reactivateCustomField(fieldId: string, reason: string, orgId: string): Promise<boolean> {
    runInAction(() => {
      this.isFieldLifecycleActionInProgress = true;
      this.fieldLifecycleError = null;
    });
    try {
      const correlationId = this.getSessionCorrelationId();
      const result = await this.service.reactivateFieldDefinition(fieldId, reason, correlationId);
      if (!result.success) {
        runInAction(() => {
          this.fieldLifecycleError = result.error ?? 'Failed to reactivate field';
          this.isFieldLifecycleActionInProgress = false;
        });
        return false;
      }
      await this.loadData(orgId, true);
      runInAction(() => {
        this.isFieldLifecycleActionInProgress = false;
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to reactivate field';
      runInAction(() => {
        this.fieldLifecycleError = message;
        this.isFieldLifecycleActionInProgress = false;
      });
      return false;
    }
  }

  /**
   * Permanently delete a deactivated custom field.
   * Returns {success, result} so callers can surface per-error details
   * (e.g., usage_count) without having to refetch.
   */
  async deleteCustomField(
    fieldId: string,
    reason: string,
    orgId: string
  ): Promise<{ success: boolean; error?: string; usageCount?: number }> {
    runInAction(() => {
      this.isFieldLifecycleActionInProgress = true;
      this.fieldLifecycleError = null;
    });
    try {
      const correlationId = this.getSessionCorrelationId();
      const result = await this.service.deleteFieldDefinition(fieldId, reason, correlationId);
      if (!result.success) {
        runInAction(() => {
          this.fieldLifecycleError = result.error ?? 'Failed to delete field';
          this.isFieldLifecycleActionInProgress = false;
        });
        return { success: false, error: result.error, usageCount: result.usage_count };
      }
      await this.loadData(orgId, true);
      runInAction(() => {
        this.isFieldLifecycleActionInProgress = false;
      });
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete field';
      runInAction(() => {
        this.fieldLifecycleError = message;
        this.isFieldLifecycleActionInProgress = false;
      });
      return { success: false, error: message };
    }
  }

  async updateCustomField(
    fieldId: string,
    params: UpdateFieldDefinitionParams,
    orgId: string
  ): Promise<boolean> {
    runInAction(() => {
      this.isUpdatingField = true;
      this.updateFieldError = null;
    });

    try {
      const correlationId = this.getSessionCorrelationId();
      const result = await this.service.updateFieldDefinition(fieldId, {
        ...params,
        correlation_id: correlationId,
      });
      if (!result.success) {
        runInAction(() => {
          this.updateFieldError = result.error ?? 'Failed to update field';
          this.isUpdatingField = false;
        });
        return false;
      }

      await this.loadData(orgId, true);
      runInAction(() => {
        this.isUpdatingField = false;
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update field';
      runInAction(() => {
        this.updateFieldError = message;
        this.isUpdatingField = false;
      });
      return false;
    }
  }

  // ── Category CRUD ──

  async createCategory(name: string, slug: string, orgId: string): Promise<boolean> {
    runInAction(() => {
      this.isCreatingCategory = true;
      this.createCategoryError = null;
    });

    try {
      const correlationId = this.getSessionCorrelationId();
      const result = await this.service.createFieldCategory(name, slug, undefined, correlationId);
      if (!result.success) {
        runInAction(() => {
          this.createCategoryError = result.error ?? 'Failed to create category';
          this.isCreatingCategory = false;
        });
        return false;
      }

      await this.loadData(orgId, true);
      runInAction(() => {
        this.isCreatingCategory = false;
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create category';
      runInAction(() => {
        this.createCategoryError = message;
        this.isCreatingCategory = false;
      });
      return false;
    }
  }

  async updateCategory(categoryId: string, name: string, orgId: string): Promise<boolean> {
    runInAction(() => {
      this.isUpdatingCategory = true;
      this.updateCategoryError = null;
    });

    try {
      const correlationId = this.getSessionCorrelationId();
      const result = await this.service.updateFieldCategory(
        categoryId,
        name,
        `Renamed category to: ${name}`,
        correlationId
      );
      if (!result.success) {
        runInAction(() => {
          this.updateCategoryError = result.error ?? 'Failed to update category';
          this.isUpdatingCategory = false;
        });
        return false;
      }

      await this.loadData(orgId, true);
      runInAction(() => {
        this.isUpdatingCategory = false;
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update category';
      runInAction(() => {
        this.updateCategoryError = message;
        this.isUpdatingCategory = false;
      });
      return false;
    }
  }

  async deactivateCategory(categoryId: string, reason: string, orgId: string): Promise<boolean> {
    try {
      const correlationId = this.getSessionCorrelationId();
      const result = await this.service.deactivateFieldCategory(categoryId, reason, correlationId);
      if (!result.success) return false;
      await this.loadData(orgId, true);
      return true;
    } catch {
      return false;
    }
  }

  async reactivateCategory(categoryId: string, reason: string, orgId: string): Promise<boolean> {
    runInAction(() => {
      this.isCategoryLifecycleActionInProgress = true;
      this.categoryLifecycleError = null;
    });
    try {
      const correlationId = this.getSessionCorrelationId();
      const result = await this.service.reactivateFieldCategory(categoryId, reason, correlationId);
      if (!result.success) {
        runInAction(() => {
          this.categoryLifecycleError = result.error ?? 'Failed to reactivate category';
          this.isCategoryLifecycleActionInProgress = false;
        });
        return false;
      }
      await this.loadData(orgId, true);
      runInAction(() => {
        this.isCategoryLifecycleActionInProgress = false;
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to reactivate category';
      runInAction(() => {
        this.categoryLifecycleError = message;
        this.isCategoryLifecycleActionInProgress = false;
      });
      return false;
    }
  }

  /**
   * Permanently delete a deactivated, empty custom category.
   * Returns child_count + child_names on precondition failure so callers can
   * enumerate the blocking field names inline (matches Roles/OrgUnits UX).
   */
  async deleteCategory(
    categoryId: string,
    reason: string,
    orgId: string
  ): Promise<{ success: boolean; error?: string; childCount?: number; childNames?: string[] }> {
    runInAction(() => {
      this.isCategoryLifecycleActionInProgress = true;
      this.categoryLifecycleError = null;
    });
    try {
      const correlationId = this.getSessionCorrelationId();
      const result = await this.service.deleteFieldCategory(categoryId, reason, correlationId);
      if (!result.success) {
        runInAction(() => {
          this.categoryLifecycleError = result.error ?? 'Failed to delete category';
          this.isCategoryLifecycleActionInProgress = false;
        });
        return {
          success: false,
          error: result.error,
          childCount: result.child_count,
          childNames: result.child_names,
        };
      }
      await this.loadData(orgId, true);
      runInAction(() => {
        this.isCategoryLifecycleActionInProgress = false;
      });
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete category';
      runInAction(() => {
        this.categoryLifecycleError = message;
        this.isCategoryLifecycleActionInProgress = false;
      });
      return { success: false, error: message };
    }
  }

  async getFieldUsageCount(fieldKey: string): Promise<number> {
    try {
      const result = await this.service.getFieldUsageCount(fieldKey);
      return result.success ? result.count : 0;
    } catch {
      return 0;
    }
  }

  async getCategoryFieldCount(
    categoryId: string,
    includeInactive = false
  ): Promise<{ count: number; fields: string[] }> {
    try {
      const result = await this.service.getCategoryFieldCount(categoryId, includeInactive);
      return result.success
        ? { count: result.count, fields: result.fields }
        : { count: 0, fields: [] };
    } catch {
      return { count: 0, fields: [] };
    }
  }
}
