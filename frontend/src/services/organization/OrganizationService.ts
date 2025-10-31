/**
 * Organization Service
 *
 * Handles organization draft management using localStorage.
 * Drafts are saved locally until submitted to workflow.
 *
 * Features:
 * - Auto-save drafts to localStorage
 * - Load saved drafts
 * - List all drafts with summary
 * - Delete drafts
 * - Clear all drafts
 *
 * Storage:
 * - Single key: 'organization_drafts'
 * - Value: Map<draftId, OrganizationFormData>
 *
 * Note: This is NOT event-driven. Drafts are local-only until workflow submission.
 */

import type {
  OrganizationFormData,
  DraftSummary
} from '@/types/organization.types';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('organization');

/**
 * Storage key for organization drafts
 */
const STORAGE_KEY = 'organization_drafts';

/**
 * Organization service for draft management
 *
 * localStorage-based draft persistence.
 * NOT event-driven - drafts are pre-submission state only.
 */
export class OrganizationService {
  /**
   * Save draft to localStorage
   *
   * Creates new draft if draftId not provided.
   * Updates existing draft if draftId exists.
   *
   * @param draft - Organization form data
   * @param draftId - Optional draft identifier
   * @returns Draft identifier
   */
  saveDraft(draft: OrganizationFormData, draftId?: string): string {
    const id = draftId || this.generateDraftId();

    const drafts = this.loadAllDrafts();

    // Update timestamps
    const now = new Date();
    const draftWithMetadata: OrganizationFormData = {
      ...draft,
      createdAt: drafts.get(id)?.createdAt || now,
      updatedAt: now
    };

    drafts.set(id, draftWithMetadata);
    this.saveDrafts(drafts);

    log.debug('Draft saved', {
      draftId: id,
      organizationName: draft.name
    });

    return id;
  }

  /**
   * Load draft by ID
   *
   * @param draftId - Draft identifier
   * @returns Organization form data or null if not found
   */
  loadDraft(draftId: string): OrganizationFormData | null {
    const drafts = this.loadAllDrafts();
    return drafts.get(draftId) || null;
  }

  /**
   * Get all draft summaries for list view
   *
   * @returns Array of draft summaries sorted by last update (newest first)
   */
  getDraftSummaries(): DraftSummary[] {
    const drafts = this.loadAllDrafts();

    const summaries: DraftSummary[] = Array.from(drafts.entries()).map(
      ([id, draft]) => ({
        draftId: id,
        organizationName: draft.name || 'Untitled Organization',
        subdomain: draft.subdomain || '',
        lastSaved: draft.updatedAt || draft.createdAt || new Date()
      })
    );

    // Sort by last saved (newest first)
    return summaries.sort(
      (a, b) => b.lastSaved.getTime() - a.lastSaved.getTime()
    );
  }

  /**
   * Delete draft by ID
   *
   * @param draftId - Draft identifier
   * @returns True if draft was deleted
   */
  deleteDraft(draftId: string): boolean {
    const drafts = this.loadAllDrafts();
    const existed = drafts.has(draftId);

    drafts.delete(draftId);
    this.saveDrafts(drafts);

    if (existed) {
      log.debug('Draft deleted', { draftId });
    }

    return existed;
  }

  /**
   * Clear all drafts
   *
   * @returns Number of drafts deleted
   */
  clearAllDrafts(): number {
    const drafts = this.loadAllDrafts();
    const count = drafts.size;

    localStorage.removeItem(STORAGE_KEY);

    log.debug('All drafts cleared', { count });

    return count;
  }

  /**
   * Check if draft exists
   *
   * @param draftId - Draft identifier
   * @returns True if draft exists
   */
  hasDraft(draftId: string): boolean {
    const drafts = this.loadAllDrafts();
    return drafts.has(draftId);
  }

  /**
   * Generate unique draft ID
   */
  private generateDraftId(): string {
    return `draft-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Load all drafts from localStorage
   */
  private loadAllDrafts(): Map<string, OrganizationFormData> {
    const json = localStorage.getItem(STORAGE_KEY);
    if (!json) {
      return new Map();
    }

    try {
      const data = JSON.parse(json);

      // Convert date strings back to Date objects
      const entries = Object.entries(data).map(([id, draft]: [string, any]): [string, OrganizationFormData] => {
        return [
          id,
          {
            ...draft,
            createdAt: draft.createdAt ? new Date(draft.createdAt) : undefined,
            updatedAt: draft.updatedAt ? new Date(draft.updatedAt) : undefined
          }
        ];
      });

      return new Map(entries);
    } catch (error) {
      log.error('Failed to load drafts from localStorage', error);
      return new Map();
    }
  }

  /**
   * Save all drafts to localStorage
   */
  private saveDrafts(drafts: Map<string, OrganizationFormData>): void {
    try {
      const obj = Object.fromEntries(drafts);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
    } catch (error) {
      log.error('Failed to save drafts to localStorage', error);
      throw new Error('Failed to save draft');
    }
  }
}
