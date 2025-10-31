import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OrganizationFormViewModel } from '../OrganizationFormViewModel';
import { OrganizationService } from '@/services/organization/OrganizationService';
import type { IWorkflowClient } from '@/services/workflow/IWorkflowClient';
import type { OrganizationFormData } from '@/types/organization.types';

describe('OrganizationFormViewModel', () => {
  let viewModel: OrganizationFormViewModel;
  let mockWorkflowClient: IWorkflowClient;
  let mockOrganizationService: OrganizationService;

  beforeEach(() => {
    // Mock workflow client
    mockWorkflowClient = {
      startBootstrap: vi.fn().mockResolvedValue('workflow-123'),
      getBootstrapStatus: vi.fn().mockResolvedValue({
        workflowId: 'workflow-123',
        status: 'running',
        currentStage: 'organization_creation',
        stages: [],
      }),
    };

    // Mock organization service
    mockOrganizationService = {
      saveDraft: vi.fn(),
      getDraft: vi.fn().mockReturnValue(null),
      deleteDraft: vi.fn(),
      getDraftSummaries: vi.fn().mockReturnValue([]),
      clearAllDrafts: vi.fn(),
    } as any;

    // Create view model with mocked dependencies
    viewModel = new OrganizationFormViewModel(mockWorkflowClient, mockOrganizationService);
  });

  describe('Initialization', () => {
    it('should initialize with empty form data', () => {
      expect(viewModel.formData.organizationName).toBe('');
      expect(viewModel.formData.organizationSlug).toBe('');
      expect(viewModel.formData.subdomain).toBe('');
    });

    it('should not be submitting initially', () => {
      expect(viewModel.isSubmitting).toBe(false);
    });

    it('should have no errors initially', () => {
      expect(viewModel.errors).toEqual({});
    });

    it('should not have any touched fields initially', () => {
      expect(viewModel.touchedFields.size).toBe(0);
    });
  });

  describe('Field Updates', () => {
    it('should update simple field values', () => {
      viewModel.updateNestedField('organizationName', 'Test Organization');
      expect(viewModel.formData.organizationName).toBe('Test Organization');
    });

    it('should update nested field values', () => {
      viewModel.updateNestedField('adminContact.firstName', 'John');
      expect(viewModel.formData.adminContact.firstName).toBe('John');
    });

    it('should mark field as touched when updated', () => {
      viewModel.updateNestedField('organizationName', 'Test');
      expect(viewModel.touchedFields.has('organizationName')).toBe(true);
    });

    it('should handle deeply nested fields', () => {
      viewModel.updateNestedField('billingAddress.street1', '123 Main St');
      expect(viewModel.formData.billingAddress.street1).toBe('123 Main St');
    });
  });

  describe('Auto-save Draft', () => {
    it('should save draft to organization service', () => {
      viewModel.updateNestedField('organizationName', 'Test Org');
      viewModel.autoSaveDraft();

      expect(mockOrganizationService.saveDraft).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationName: 'Test Org',
        })
      );
    });

    it('should generate draft ID if not present', () => {
      viewModel.autoSaveDraft();
      expect(mockOrganizationService.saveDraft).toHaveBeenCalled();
    });
  });

  describe('Load Draft', () => {
    it('should load draft from organization service', () => {
      const mockDraft: OrganizationFormData = {
        draftId: 'draft-123',
        organizationName: 'Saved Org',
        organizationSlug: 'saved-org',
        organizationType: 'provider',
        subdomain: 'saved-org',
        timezone: 'America/New_York',
        adminContact: {
          firstName: 'Jane',
          lastName: 'Doe',
          email: 'jane@example.com',
        },
        billingAddress: {
          street1: '456 Oak Ave',
          city: 'Portland',
          state: 'OR',
          zipCode: '97201',
        },
        billingPhone: {
          number: '(503) 555-0100',
        },
        program: {
          name: 'Residential Program',
          type: 'residential',
        },
      };

      mockOrganizationService.getDraft = vi.fn().mockReturnValue(mockDraft);

      viewModel.loadDraft('draft-123');

      expect(viewModel.formData.organizationName).toBe('Saved Org');
      expect(viewModel.formData.adminContact.firstName).toBe('Jane');
      expect(viewModel.formData.billingAddress.street1).toBe('456 Oak Ave');
    });

    it('should return false if draft not found', () => {
      mockOrganizationService.getDraft = vi.fn().mockReturnValue(null);
      const result = viewModel.loadDraft('nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('Validation', () => {
    it('should validate required fields', () => {
      const isValid = viewModel.validate();
      expect(isValid).toBe(false);
      expect(viewModel.errors.organizationName).toBeDefined();
    });

    it('should pass validation with complete data', () => {
      viewModel.updateNestedField('organizationName', 'Test Organization');
      viewModel.updateNestedField('organizationSlug', 'test-organization');
      viewModel.updateNestedField('organizationType', 'provider');
      viewModel.updateNestedField('subdomain', 'test-org');
      viewModel.updateNestedField('timezone', 'America/New_York');
      viewModel.updateNestedField('adminContact.firstName', 'John');
      viewModel.updateNestedField('adminContact.lastName', 'Doe');
      viewModel.updateNestedField('adminContact.email', 'john@example.com');
      viewModel.updateNestedField('billingAddress.street1', '123 Main St');
      viewModel.updateNestedField('billingAddress.city', 'Portland');
      viewModel.updateNestedField('billingAddress.state', 'OR');
      viewModel.updateNestedField('billingAddress.zipCode', '97201');
      viewModel.updateNestedField('billingPhone.number', '(503) 555-0100');
      viewModel.updateNestedField('program.name', 'Residential Program');
      viewModel.updateNestedField('program.type', 'residential');

      const isValid = viewModel.validate();
      expect(isValid).toBe(true);
      expect(Object.keys(viewModel.errors).length).toBe(0);
    });

    it('should validate email format', () => {
      viewModel.updateNestedField('adminContact.email', 'invalid-email');
      viewModel.validate();
      expect(viewModel.errors['adminContact.email']).toBeDefined();
    });

    it('should validate phone number format', () => {
      viewModel.updateNestedField('billingPhone.number', 'invalid-phone');
      viewModel.validate();
      expect(viewModel.errors['billingPhone.number']).toBeDefined();
    });

    it('should validate zip code format', () => {
      viewModel.updateNestedField('billingAddress.zipCode', '123');
      viewModel.validate();
      expect(viewModel.errors['billingAddress.zipCode']).toBeDefined();
    });
  });

  describe('Submit', () => {
    beforeEach(() => {
      // Set up valid form data
      viewModel.updateNestedField('organizationName', 'Test Organization');
      viewModel.updateNestedField('organizationSlug', 'test-organization');
      viewModel.updateNestedField('organizationType', 'provider');
      viewModel.updateNestedField('subdomain', 'test-org');
      viewModel.updateNestedField('timezone', 'America/New_York');
      viewModel.updateNestedField('adminContact.firstName', 'John');
      viewModel.updateNestedField('adminContact.lastName', 'Doe');
      viewModel.updateNestedField('adminContact.email', 'john@example.com');
      viewModel.updateNestedField('billingAddress.street1', '123 Main St');
      viewModel.updateNestedField('billingAddress.city', 'Portland');
      viewModel.updateNestedField('billingAddress.state', 'OR');
      viewModel.updateNestedField('billingAddress.zipCode', '97201');
      viewModel.updateNestedField('billingPhone.number', '(503) 555-0100');
      viewModel.updateNestedField('program.name', 'Residential Program');
      viewModel.updateNestedField('program.type', 'residential');
    });

    it('should submit valid form data', async () => {
      const workflowId = await viewModel.submit();
      expect(workflowId).toBe('workflow-123');
      expect(mockWorkflowClient.startBootstrap).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationName: 'Test Organization',
          subdomain: 'test-org',
        })
      );
    });

    it('should set isSubmitting to true during submit', async () => {
      const submitPromise = viewModel.submit();
      expect(viewModel.isSubmitting).toBe(true);
      await submitPromise;
      expect(viewModel.isSubmitting).toBe(false);
    });

    it('should not submit invalid form data', async () => {
      viewModel.updateNestedField('organizationName', '');
      const workflowId = await viewModel.submit();
      expect(workflowId).toBeNull();
      expect(mockWorkflowClient.startBootstrap).not.toHaveBeenCalled();
    });

    it('should handle submit errors gracefully', async () => {
      mockWorkflowClient.startBootstrap = vi.fn().mockRejectedValue(new Error('Network error'));
      const workflowId = await viewModel.submit();
      expect(workflowId).toBeNull();
      expect(viewModel.isSubmitting).toBe(false);
    });

    it('should delete draft after successful submit', async () => {
      viewModel.formData.draftId = 'draft-123';
      await viewModel.submit();
      expect(mockOrganizationService.deleteDraft).toHaveBeenCalledWith('draft-123');
    });
  });

  describe('Field Error Tracking', () => {
    it('should show error only for touched fields', () => {
      const hasError = viewModel.hasFieldError('organizationName');
      expect(hasError).toBe(false);

      viewModel.updateNestedField('organizationName', '');
      viewModel.validate();
      expect(viewModel.hasFieldError('organizationName')).toBe(true);
    });

    it('should get error message for field', () => {
      viewModel.updateNestedField('organizationName', '');
      viewModel.validate();
      const errorMsg = viewModel.getFieldError('organizationName');
      expect(errorMsg).toBeDefined();
      expect(errorMsg).toContain('required');
    });
  });

  describe('Reset', () => {
    it('should reset form to initial state', () => {
      viewModel.updateNestedField('organizationName', 'Test');
      viewModel.updateNestedField('adminContact.email', 'test@example.com');
      viewModel.reset();

      expect(viewModel.formData.organizationName).toBe('');
      expect(viewModel.formData.adminContact.email).toBe('');
      expect(viewModel.errors).toEqual({});
      expect(viewModel.touchedFields.size).toBe(0);
    });
  });
});
