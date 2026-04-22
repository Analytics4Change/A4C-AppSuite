/**
 * Categories Tab
 *
 * Manage field categories: system categories shown read-only,
 * org-defined categories can be created and deactivated.
 */

import React, { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Plus,
  Trash2,
  Pencil,
  Lock,
  RotateCcw,
  Loader2,
  AlertCircle,
  Check,
  X,
} from 'lucide-react';
import type { FieldCategory } from '@/types/client-field-settings.types';
import type {
  ClientFieldSettingsViewModel,
  FieldStatusFilter,
} from '@/viewModels/settings/ClientFieldSettingsViewModel';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

const glassCardStyle = {
  background: 'rgba(255, 255, 255, 0.7)',
  backdropFilter: 'blur(20px)',
  WebkitBackdropFilter: 'blur(20px)',
  border: '1px solid rgba(255, 255, 255, 0.3)',
  boxShadow: '0 2px 4px rgba(0, 0, 0, 0.05)',
};

interface CategoriesTabProps {
  viewModel: ClientFieldSettingsViewModel;
  categories: FieldCategory[];
  orgId: string;
}

export const CategoriesTab: React.FC<CategoriesTabProps> = observer(
  ({ viewModel, categories, orgId }) => {
    const [showForm, setShowForm] = useState(false);
    const [name, setName] = useState('');
    const [slug, setSlug] = useState('');

    // Edit state
    const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
    const [editName, setEditName] = useState('');

    // The ViewModel computed honors the status filter and keeps system categories
    // always visible (they cannot be filtered out).
    const visibleCategories = viewModel.visibleCustomCategories;
    // `categories` prop kept for parent wiring symmetry but no longer used directly.
    void categories;
    const statusFilter = viewModel.categoryStatusFilter;
    const canCreate = name.trim().length > 0 && slug.trim().length > 0;

    const handleStatusFilter = (value: FieldStatusFilter) =>
      viewModel.setCategoryStatusFilter(value);

    // Lifecycle confirmation state
    const [reactivateTarget, setReactivateTarget] = useState<{
      id: string;
      name: string;
      /**
       * Decision 101: reactivation does NOT cascade. We still surface how many
       * child fields remain inactive so the admin can act on them afterward.
       */
      inactiveChildCount: number;
      inactiveChildNames: string[];
    } | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<{
      id: string;
      name: string;
      childCount: number;
      childNames: string[];
    } | null>(null);
    const [isCheckingDeleteChildren, setIsCheckingDeleteChildren] = useState(false);

    const autoSlug = (value: string) => {
      setName(value);
      setSlug(
        value
          .toLowerCase()
          .trim()
          .replace(/[^a-z0-9\s]/g, '')
          .replace(/\s+/g, '_')
      );
    };

    const handleCreate = async () => {
      if (!canCreate) return;
      const success = await viewModel.createCategory(name.trim(), slug.trim(), orgId);
      if (success) {
        setName('');
        setSlug('');
        setShowForm(false);
      }
    };

    const startEditing = (cat: { id: string; name: string }) => {
      setEditingCategoryId(cat.id);
      setEditName(cat.name);
    };

    const cancelEditing = () => {
      setEditingCategoryId(null);
      setEditName('');
      viewModel.clearCategoryErrors();
    };

    const handleUpdate = async () => {
      if (!editingCategoryId || editName.trim().length === 0) return;
      const success = await viewModel.updateCategory(editingCategoryId, editName.trim(), orgId);
      if (success) {
        cancelEditing();
      }
    };

    // Deactivation confirmation state
    const [deactivateTarget, setDeactivateTarget] = useState<{
      id: string;
      name: string;
      fieldCount: number;
      fieldNames: string[];
    } | null>(null);
    const [isCheckingFields, setIsCheckingFields] = useState(false);
    const [isDeactivating, setIsDeactivating] = useState(false);

    const handleDeactivateClick = async (cat: FieldCategory) => {
      setIsCheckingFields(true);
      const result = await viewModel.getCategoryFieldCount(cat.id);
      setIsCheckingFields(false);
      setDeactivateTarget({
        id: cat.id,
        name: cat.name,
        fieldCount: result.count,
        fieldNames: result.fields,
      });
    };

    const confirmDeactivate = async () => {
      if (!deactivateTarget) return;
      setIsDeactivating(true);
      await viewModel.deactivateCategory(
        deactivateTarget.id,
        `Removed category: ${deactivateTarget.name}`,
        orgId
      );
      setIsDeactivating(false);
      setDeactivateTarget(null);
    };

    const handleReactivateClick = (cat: FieldCategory) => {
      viewModel.clearCategoryLifecycleError();
      const inactiveChildren = viewModel.fieldDefinitions
        .filter((f) => f.category_id === cat.id && !f.is_active)
        .map((f) => f.display_name)
        .sort();
      setReactivateTarget({
        id: cat.id,
        name: cat.name,
        inactiveChildCount: inactiveChildren.length,
        inactiveChildNames: inactiveChildren,
      });
    };

    const confirmReactivate = async () => {
      if (!reactivateTarget) return;
      const ok = await viewModel.reactivateCategory(
        reactivateTarget.id,
        `Reactivated category: ${reactivateTarget.name}`,
        orgId
      );
      if (ok) setReactivateTarget(null);
    };

    const handleDeleteClick = async (cat: FieldCategory) => {
      viewModel.clearCategoryLifecycleError();
      setIsCheckingDeleteChildren(true);
      // includeInactive=true to match the server-side delete gate exactly
      const result = await viewModel.getCategoryFieldCount(cat.id, true);
      setIsCheckingDeleteChildren(false);
      setDeleteTarget({
        id: cat.id,
        name: cat.name,
        childCount: result.count,
        childNames: result.fields,
      });
    };

    const confirmDelete = async () => {
      if (!deleteTarget || deleteTarget.childCount > 0) return;
      const result = await viewModel.deleteCategory(
        deleteTarget.id,
        `Deleted category: ${deleteTarget.name}`,
        orgId
      );
      if (result.success) {
        setDeleteTarget(null);
      } else if (typeof result.childCount === 'number' && result.childCount > 0) {
        // Server disagrees — show the fresh child list.
        setDeleteTarget({
          ...deleteTarget,
          childCount: result.childCount,
          childNames: result.childNames ?? [],
        });
      }
    };

    return (
      <div
        role="tabpanel"
        aria-labelledby="tab-categories"
        id="tabpanel-categories"
        data-testid="tabpanel-categories"
      >
        <Card style={glassCardStyle}>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Field Categories</CardTitle>
              {!showForm && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowForm(true)}
                  data-testid="add-category-btn"
                >
                  <Plus size={16} className="mr-1" />
                  Add Category
                </Button>
              )}
            </div>
            <p className="text-sm text-gray-600 mt-1">
              System categories cannot be removed. You can add custom categories for organizing
              additional fields.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Status filter bar (system categories always shown) */}
            <div
              className="flex gap-2"
              role="group"
              aria-label="Filter categories by status"
              data-testid="cat-status-filter"
            >
              {(['all', 'active', 'inactive'] as const).map((value) => (
                <Button
                  key={value}
                  variant={statusFilter === value ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => handleStatusFilter(value)}
                  aria-pressed={statusFilter === value}
                  className={
                    statusFilter === value
                      ? 'bg-blue-600 text-white hover:bg-blue-700'
                      : 'hover:bg-gray-100'
                  }
                  data-testid={`cat-status-filter-${value}`}
                >
                  {value.charAt(0).toUpperCase() + value.slice(1)}
                </Button>
              ))}
            </div>

            {viewModel.categoryLifecycleError && (
              <div
                role="alert"
                className="flex items-center gap-2 p-2 bg-red-50 border border-red-200 rounded text-red-800 text-sm"
                data-testid="cat-lifecycle-error"
              >
                <AlertCircle size={14} />
                {viewModel.categoryLifecycleError}
              </div>
            )}

            {/* Create form */}
            {showForm && (
              <div className="border border-gray-200 rounded-lg p-4 space-y-3 bg-white/50">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="cat-name">Category Name</Label>
                    <input
                      id="cat-name"
                      type="text"
                      value={name}
                      onChange={(e) => autoSlug(e.target.value)}
                      placeholder="e.g., Behavioral"
                      className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      data-testid="cat-name-input"
                    />
                  </div>
                  <div>
                    <Label htmlFor="cat-slug">Slug</Label>
                    <input
                      id="cat-slug"
                      type="text"
                      value={slug}
                      onChange={(e) => setSlug(e.target.value)}
                      placeholder="e.g., behavioral"
                      className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      data-testid="cat-slug-input"
                    />
                  </div>
                </div>

                {viewModel.createCategoryError && (
                  <div
                    role="alert"
                    className="flex items-center gap-2 p-2 bg-red-50 border border-red-200 rounded text-red-800 text-sm"
                    data-testid="cat-error-alert"
                  >
                    <AlertCircle size={14} />
                    {viewModel.createCategoryError}
                  </div>
                )}

                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={handleCreate}
                    disabled={!canCreate || viewModel.isCreatingCategory}
                    data-testid="cat-save-btn"
                  >
                    {viewModel.isCreatingCategory ? (
                      <Loader2 size={14} className="mr-1 animate-spin" />
                    ) : (
                      <Plus size={14} className="mr-1" />
                    )}
                    Create Category
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setShowForm(false);
                      setName('');
                      setSlug('');
                      viewModel.clearCategoryErrors();
                    }}
                    data-testid="cat-cancel-btn"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {/* Categories list */}
            {visibleCategories.length === 0 && (
              <p className="text-sm text-gray-500 py-2" data-testid="cat-empty-state">
                {statusFilter === 'inactive'
                  ? 'No deactivated custom categories.'
                  : 'No categories match the current filter.'}
              </p>
            )}
            <div className="divide-y divide-gray-100">
              {visibleCategories.map((cat) =>
                editingCategoryId === cat.id ? (
                  <div
                    key={cat.id}
                    className="py-3 space-y-3 border border-blue-200 rounded-lg p-4 bg-blue-50/30"
                    data-testid={`category-edit-${cat.slug}`}
                  >
                    <div>
                      <Label htmlFor="cat-edit-name">Category Name</Label>
                      <input
                        id="cat-edit-name"
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="mt-1 w-full max-w-xs rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        data-testid="cat-edit-name-input"
                      />
                      <p className="mt-1 text-xs text-gray-400">Slug: {cat.slug} (not editable)</p>
                    </div>
                    {viewModel.updateCategoryError && (
                      <div
                        role="alert"
                        className="flex items-center gap-2 p-2 bg-red-50 border border-red-200 rounded text-red-800 text-sm"
                      >
                        <AlertCircle size={14} />
                        {viewModel.updateCategoryError}
                      </div>
                    )}
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={handleUpdate}
                        disabled={editName.trim().length === 0 || viewModel.isUpdatingCategory}
                        data-testid="cat-edit-save-btn"
                      >
                        {viewModel.isUpdatingCategory ? (
                          <Loader2 size={14} className="mr-1 animate-spin" />
                        ) : (
                          <Check size={14} className="mr-1" />
                        )}
                        Save
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={cancelEditing}
                        data-testid="cat-edit-cancel-btn"
                      >
                        <X size={14} className="mr-1" />
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div
                    key={cat.id}
                    className="flex items-center justify-between py-3"
                    data-testid={`category-${cat.slug}`}
                    data-active={cat.is_active ? 'true' : 'false'}
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-sm font-medium ${cat.is_active ? '' : 'text-gray-500'}`}
                        >
                          {cat.name}
                        </span>
                        {cat.is_system && (
                          <span className="inline-flex items-center gap-1 text-xs text-gray-400">
                            <Lock size={10} />
                            System
                          </span>
                        )}
                        {!cat.is_active && !cat.is_system && (
                          <span
                            className="text-xs text-gray-600 bg-gray-200 px-1.5 py-0.5 rounded"
                            data-testid={`cat-inactive-badge-${cat.slug}`}
                          >
                            Inactive
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5">{cat.slug}</p>
                    </div>
                    {!cat.is_system && (
                      <div className="flex items-center gap-1">
                        {cat.is_active ? (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => startEditing(cat)}
                              className="text-gray-500 hover:text-blue-700 hover:bg-blue-50"
                              aria-label={`Edit ${cat.name}`}
                              data-testid={`cat-edit-${cat.slug}`}
                            >
                              <Pencil size={14} />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDeactivateClick(cat)}
                              disabled={isCheckingFields}
                              className="text-red-500 hover:text-red-700 hover:bg-red-50"
                              aria-label={`Deactivate ${cat.name}`}
                              data-testid={`cat-deactivate-${cat.slug}`}
                            >
                              <Trash2 size={14} />
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleReactivateClick(cat)}
                              disabled={viewModel.isCategoryLifecycleActionInProgress}
                              className="text-green-600 hover:text-green-700 hover:bg-green-50"
                              aria-label={`Reactivate ${cat.name}`}
                              data-testid={`cat-reactivate-${cat.slug}`}
                            >
                              <RotateCcw size={14} />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDeleteClick(cat)}
                              disabled={
                                isCheckingDeleteChildren ||
                                viewModel.isCategoryLifecycleActionInProgress
                              }
                              className="text-red-600 hover:text-red-700 hover:bg-red-50"
                              aria-label={`Delete ${cat.name}`}
                              data-testid={`cat-delete-${cat.slug}`}
                            >
                              <Trash2 size={14} />
                            </Button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )
              )}
            </div>

            {/* Deactivation confirmation dialog */}
            <ConfirmDialog
              isOpen={deactivateTarget !== null}
              title={`Deactivate "${deactivateTarget?.name}"?`}
              message={
                deactivateTarget && deactivateTarget.fieldCount > 0
                  ? `This category contains ${deactivateTarget.fieldCount} active custom field(s). Deactivating will also deactivate all fields in this category.`
                  : 'This will remove the category. No fields are affected.'
              }
              confirmLabel="Deactivate"
              cancelLabel="Cancel"
              variant="warning"
              isLoading={isDeactivating}
              details={
                deactivateTarget && deactivateTarget.fieldCount > 0
                  ? deactivateTarget.fieldNames
                  : undefined
              }
              onConfirm={confirmDeactivate}
              onCancel={() => setDeactivateTarget(null)}
            />

            {/* Reactivate confirmation dialog */}
            <ConfirmDialog
              isOpen={reactivateTarget !== null}
              title={`Reactivate "${reactivateTarget?.name}"?`}
              message={
                reactivateTarget && reactivateTarget.inactiveChildCount > 0
                  ? `This will return the category to active status. ${reactivateTarget.inactiveChildCount} child field(s) are still inactive and will stay inactive — reactivate them individually afterward.`
                  : 'This will return the category to active status. No inactive child fields to worry about.'
              }
              details={
                reactivateTarget && reactivateTarget.inactiveChildCount > 0
                  ? reactivateTarget.inactiveChildNames
                  : undefined
              }
              confirmLabel="Reactivate"
              cancelLabel="Cancel"
              variant="success"
              isLoading={viewModel.isCategoryLifecycleActionInProgress}
              onConfirm={confirmReactivate}
              onCancel={() => setReactivateTarget(null)}
            />

            {/* Hard-delete confirmation dialog */}
            <ConfirmDialog
              isOpen={deleteTarget !== null}
              title={
                deleteTarget && deleteTarget.childCount > 0
                  ? `Cannot delete "${deleteTarget.name}"`
                  : `Permanently delete "${deleteTarget?.name}"?`
              }
              message={
                deleteTarget && deleteTarget.childCount > 0
                  ? `This category still has ${deleteTarget.childCount} field(s) (active or deactivated). Delete those fields first, then retry.`
                  : 'This permanently removes the category. This cannot be undone.'
              }
              details={
                deleteTarget && deleteTarget.childCount > 0 ? deleteTarget.childNames : undefined
              }
              confirmLabel="Delete permanently"
              cancelLabel={deleteTarget && deleteTarget.childCount > 0 ? 'Dismiss' : 'Cancel'}
              variant="danger"
              isLoading={viewModel.isCategoryLifecycleActionInProgress}
              confirmDisabled={!!(deleteTarget && deleteTarget.childCount > 0)}
              requireConfirmText={
                deleteTarget && deleteTarget.childCount === 0 ? deleteTarget.name : undefined
              }
              onConfirm={confirmDelete}
              onCancel={() => setDeleteTarget(null)}
            />
          </CardContent>
        </Card>
      </div>
    );
  }
);
