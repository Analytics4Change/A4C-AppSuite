/**
 * Assignment List ViewModel
 *
 * Manages state for the assignment overview pages: loading, filtering,
 * assigning, and unassigning clients.
 */

import { makeAutoObservable, runInAction } from 'mobx';
import type { UserClientAssignment } from '@/types/client-assignment.types';
import type { IAssignmentService } from '@/services/assignment/IAssignmentService';
import type { IDirectCareSettingsService } from '@/services/direct-care/IDirectCareSettingsService';
import { getAssignmentService } from '@/services/assignment/AssignmentServiceFactory';
import { getDirectCareSettingsService } from '@/services/direct-care/DirectCareSettingsServiceFactory';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('viewmodel');

export class AssignmentListViewModel {
  assignments: UserClientAssignment[] = [];
  isLoading = false;
  error: string | null = null;

  /** Whether enable_staff_client_mapping is on for this org */
  featureEnabled: boolean | null = null;
  featureCheckLoading = false;

  filterUserId: string | null = null;
  filterClientId: string | null = null;
  showInactive = false;

  constructor(
    private service: IAssignmentService = getAssignmentService(),
    private settingsService: IDirectCareSettingsService = getDirectCareSettingsService(),
  ) {
    makeAutoObservable(this);
  }

  /** Check whether the org has enable_staff_client_mapping enabled */
  async checkFeatureFlag(orgId: string): Promise<void> {
    runInAction(() => { this.featureCheckLoading = true; });

    try {
      const settings = await this.settingsService.getSettings(orgId);
      runInAction(() => {
        this.featureEnabled = settings.enable_staff_client_mapping;
        this.featureCheckLoading = false;
      });
      log.debug('Feature flag checked', { enable_staff_client_mapping: this.featureEnabled });
    } catch (error) {
      log.warn('Failed to check feature flag, assuming enabled', { error });
      runInAction(() => {
        this.featureEnabled = true;
        this.featureCheckLoading = false;
      });
    }
  }

  async loadAssignments(): Promise<void> {
    runInAction(() => {
      this.isLoading = true;
      this.error = null;
    });

    try {
      const assignments = await this.service.listAssignments({
        userId: this.filterUserId ?? undefined,
        clientId: this.filterClientId ?? undefined,
        activeOnly: !this.showInactive,
      });

      runInAction(() => {
        this.assignments = assignments;
        this.isLoading = false;
      });

      log.debug('Assignments loaded', { count: assignments.length });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load assignments';
      runInAction(() => {
        this.error = message;
        this.isLoading = false;
      });
      log.error('Failed to load assignments', { error });
    }
  }

  setFilterUserId(userId: string | null): void {
    this.filterUserId = userId;
  }

  setFilterClientId(clientId: string | null): void {
    this.filterClientId = clientId;
  }

  setShowInactive(show: boolean): void {
    this.showInactive = show;
  }

  async assignClient(params: {
    userId: string;
    clientId: string;
    assignedUntil?: string;
    notes?: string;
    reason?: string;
  }): Promise<boolean> {
    try {
      await this.service.assignClient(params);
      await this.loadAssignments();
      return true;
    } catch (error) {
      log.error('Failed to assign client', { error, ...params });
      return false;
    }
  }

  async unassignClient(userId: string, clientId: string, reason: string): Promise<boolean> {
    try {
      await this.service.unassignClient({ userId, clientId, reason });
      await this.loadAssignments();
      return true;
    } catch (error) {
      log.error('Failed to unassign client', { error, userId, clientId });
      return false;
    }
  }
}
