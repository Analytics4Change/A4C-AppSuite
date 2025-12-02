import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OrganizationFormViewModel } from '../OrganizationFormViewModel';
import { OrganizationService } from '@/services/organization/OrganizationService';
import type { IWorkflowClient } from '@/services/workflow/IWorkflowClient';
import type { OrganizationFormData } from '@/types/organization.types';

// Mock sonner toast to prevent test failures
vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

describe('OrganizationFormViewModel', () => {
  let viewModel: OrganizationFormViewModel;
  let mockWorkflowClient: IWorkflowClient;
  let mockOrganizationService: OrganizationService;

  beforeEach(() => {
    // Mock workflow client - matches IWorkflowClient interface
    mockWorkflowClient = {
      startBootstrapWorkflow: vi.fn().mockResolvedValue('workflow-123'),
      getWorkflowStatus: vi.fn().mockResolvedValue({
        workflowId: 'workflow-123',
        status: 'running',
        currentStage: 'organization_creation',
        stages: [],
      }),
      cancelWorkflow: vi.fn().mockResolvedValue(true),
    };

    // Mock organization service - matches OrganizationService methods
    mockOrganizationService = {
      saveDraft: vi.fn().mockReturnValue('draft-123'),
      loadDraft: vi.fn().mockReturnValue(null),
      deleteDraft: vi.fn().mockReturnValue(true),
      getDraftSummaries: vi.fn().mockReturnValue([]),
      clearAllDrafts: vi.fn().mockReturnValue(0),
      hasDraft: vi.fn().mockReturnValue(false),
    } as unknown as OrganizationService;

    // Create view model with mocked dependencies
    viewModel = new OrganizationFormViewModel(mockWorkflowClient, mockOrganizationService);
  });

  describe('Initialization', () => {
    it('should initialize with empty form data', () => {
      expect(viewModel.formData.name).toBe('');
      expect(viewModel.formData.displayName).toBe('');
      expect(viewModel.formData.subdomain).toBe('');
    });

    it('should initialize with default organization type', () => {
      expect(viewModel.formData.type).toBe('provider');
    });

    it('should initialize with default timezone', () => {
      expect(viewModel.formData.timeZone).toBe('America/New_York');
    });

    it('should not be submitting initially', () => {
      expect(viewModel.isSubmitting).toBe(false);
    });

    it('should have no validation errors initially', () => {
      expect(viewModel.validationErrors).toEqual([]);
    });

    it('should not have any touched fields initially', () => {
      expect(viewModel.touchedFields.size).toBe(0);
    });
  });

  describe('Field Updates', () => {
    it('should update simple field values', () => {
      viewModel.updateNestedField('name', 'Test Organization');
      expect(viewModel.formData.name).toBe('Test Organization');
    });

    it('should update nested field values', () => {
      viewModel.updateNestedField('providerAdminContact.firstName', 'John');
      expect(viewModel.formData.providerAdminContact.firstName).toBe('John');
    });

    it('should mark field as touched when updated', () => {
      viewModel.updateNestedField('name', 'Test');
      expect(viewModel.touchedFields.has('name')).toBe(true);
    });

    it('should handle deeply nested fields', () => {
      viewModel.updateNestedField('billingAddress.street1', '123 Main St');
      expect(viewModel.formData.billingAddress.street1).toBe('123 Main St');
    });

    it('should update provider admin contact fields', () => {
      viewModel.updateNestedField('providerAdminContact.email', 'admin@example.com');
      expect(viewModel.formData.providerAdminContact.email).toBe('admin@example.com');
    });
  });

  describe('Auto-save Draft', () => {
    it('should save draft to organization service', () => {
      viewModel.updateNestedField('name', 'Test Org');
      viewModel.autoSaveDraft();

      // Verify saveDraft was called with form data that includes our update
      expect(mockOrganizationService.saveDraft).toHaveBeenCalled();
      const callArgs = (mockOrganizationService.saveDraft as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(callArgs[0].name).toBe('Test Org');
    });

    it('should generate draft ID if not present', () => {
      viewModel.autoSaveDraft();
      expect(mockOrganizationService.saveDraft).toHaveBeenCalled();
    });
  });

  describe('Load Draft', () => {
    it('should load draft from organization service', () => {
      // Create a complete mock draft with all required fields
      const mockDraft = {
        ...viewModel.formData, // Start with default structure
        draftId: 'draft-123',
        name: 'Saved Org',
        displayName: 'Saved Org Display',
        type: 'provider' as const,
        subdomain: 'saved-org',
        timeZone: 'America/New_York',
        providerAdminContact: {
          label: 'Provider Admin Contact',
          type: 'a4c_admin' as const,
          firstName: 'Jane',
          lastName: 'Doe',
          email: 'jane@example.com',
          title: '',
          department: '',
        },
        billingAddress: {
          label: 'Billing Address',
          type: 'billing' as const,
          street1: '456 Oak Ave',
          street2: '',
          city: 'Portland',
          state: 'OR',
          zipCode: '97201',
        },
      };

      // Override the mock for this test
      (mockOrganizationService.loadDraft as ReturnType<typeof vi.fn>).mockReturnValue(mockDraft);

      const result = viewModel.loadDraft('draft-123');

      expect(result).toBe(true);
      expect(viewModel.formData.name).toBe('Saved Org');
      expect(viewModel.formData.providerAdminContact.firstName).toBe('Jane');
      expect(viewModel.formData.billingAddress.street1).toBe('456 Oak Ave');
    });

    it('should return false if draft not found', () => {
      (mockOrganizationService.loadDraft as ReturnType<typeof vi.fn>).mockReturnValue(null);
      const result = viewModel.loadDraft('nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('Validation', () => {
    it('should validate required fields', () => {
      const isValid = viewModel.validate();
      expect(isValid).toBe(false);
      // Check that validationErrors contains error for name
      const nameError = viewModel.validationErrors.find(e => e.field === 'name');
      expect(nameError).toBeDefined();
    });

    it('should pass validation with complete data', () => {
      // Set required fields for provider type
      viewModel.updateNestedField('name', 'Test Organization');
      viewModel.updateNestedField('displayName', 'Test Org Display');
      viewModel.updateNestedField('type', 'provider');
      viewModel.updateNestedField('subdomain', 'test-org');
      viewModel.updateNestedField('timeZone', 'America/New_York');

      // General address (headquarters)
      viewModel.updateNestedField('generalAddress.street1', '123 Main St');
      viewModel.updateNestedField('generalAddress.city', 'Portland');
      viewModel.updateNestedField('generalAddress.state', 'OR');
      viewModel.updateNestedField('generalAddress.zipCode', '97201');
      viewModel.updateNestedField('generalPhone.number', '(503) 555-0100');

      // Billing contact (required for providers)
      viewModel.updateNestedField('billingContact.firstName', 'Jane');
      viewModel.updateNestedField('billingContact.lastName', 'Smith');
      viewModel.updateNestedField('billingContact.email', 'billing@example.com');

      // Use general info for billing address/phone
      viewModel.updateNestedField('useBillingGeneralAddress', true);
      viewModel.updateNestedField('useBillingGeneralPhone', true);

      // Provider admin contact
      viewModel.updateNestedField('providerAdminContact.firstName', 'John');
      viewModel.updateNestedField('providerAdminContact.lastName', 'Doe');
      viewModel.updateNestedField('providerAdminContact.email', 'john@example.com');

      // Use general info for provider admin address/phone
      viewModel.updateNestedField('useProviderAdminGeneralAddress', true);
      viewModel.updateNestedField('useProviderAdminGeneralPhone', true);

      const isValid = viewModel.validate();
      expect(isValid).toBe(true);
      expect(viewModel.validationErrors.length).toBe(0);
    });

    it('should validate email format', () => {
      viewModel.updateNestedField('providerAdminContact.email', 'invalid-email');
      viewModel.validate();
      const emailError = viewModel.validationErrors.find(e => e.field === 'providerAdminContact.email');
      expect(emailError).toBeDefined();
    });

    it('should validate phone number format', () => {
      viewModel.updateNestedField('generalPhone.number', 'invalid-phone');
      viewModel.validate();
      const phoneError = viewModel.validationErrors.find(e => e.field === 'generalPhone.number');
      expect(phoneError).toBeDefined();
    });

    it('should validate zip code format', () => {
      viewModel.updateNestedField('generalAddress.zipCode', '123');
      viewModel.validate();
      const zipError = viewModel.validationErrors.find(e => e.field === 'generalAddress.zipCode');
      expect(zipError).toBeDefined();
    });
  });

  describe('Submit', () => {
    beforeEach(() => {
      // Set up valid form data for provider type
      viewModel.updateNestedField('name', 'Test Organization');
      viewModel.updateNestedField('displayName', 'Test Org Display');
      viewModel.updateNestedField('type', 'provider');
      viewModel.updateNestedField('subdomain', 'test-org');
      viewModel.updateNestedField('timeZone', 'America/New_York');

      // General address (headquarters)
      viewModel.updateNestedField('generalAddress.street1', '123 Main St');
      viewModel.updateNestedField('generalAddress.city', 'Portland');
      viewModel.updateNestedField('generalAddress.state', 'OR');
      viewModel.updateNestedField('generalAddress.zipCode', '97201');
      viewModel.updateNestedField('generalPhone.number', '(503) 555-0100');

      // Billing contact (required for providers)
      viewModel.updateNestedField('billingContact.firstName', 'Jane');
      viewModel.updateNestedField('billingContact.lastName', 'Smith');
      viewModel.updateNestedField('billingContact.email', 'billing@example.com');

      // Use general info for billing
      viewModel.updateNestedField('useBillingGeneralAddress', true);
      viewModel.updateNestedField('useBillingGeneralPhone', true);

      // Provider admin contact
      viewModel.updateNestedField('providerAdminContact.firstName', 'John');
      viewModel.updateNestedField('providerAdminContact.lastName', 'Doe');
      viewModel.updateNestedField('providerAdminContact.email', 'john@example.com');

      // Use general info for provider admin
      viewModel.updateNestedField('useProviderAdminGeneralAddress', true);
      viewModel.updateNestedField('useProviderAdminGeneralPhone', true);
    });

    it('should submit valid form data', async () => {
      const workflowId = await viewModel.submit();
      expect(workflowId).toBe('workflow-123');
      // Verify workflow was called with correct params structure
      expect(mockWorkflowClient.startBootstrapWorkflow).toHaveBeenCalled();
      const callArgs = (mockWorkflowClient.startBootstrapWorkflow as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(callArgs.subdomain).toBe('test-org');
      expect(callArgs.orgData.name).toBe('Test Organization');
    });

    it('should set isSubmitting to true during submit', async () => {
      const submitPromise = viewModel.submit();
      expect(viewModel.isSubmitting).toBe(true);
      await submitPromise;
      expect(viewModel.isSubmitting).toBe(false);
    });

    it('should not submit invalid form data', async () => {
      viewModel.updateNestedField('name', '');
      const workflowId = await viewModel.submit();
      expect(workflowId).toBeNull();
      expect(mockWorkflowClient.startBootstrapWorkflow).not.toHaveBeenCalled();
    });

    it('should handle submit errors gracefully', async () => {
      // Override the mock to reject
      (mockWorkflowClient.startBootstrapWorkflow as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Network error'));
      const workflowId = await viewModel.submit();
      expect(workflowId).toBeNull();
      expect(viewModel.isSubmitting).toBe(false);
    });

    it('should delete draft after successful submit', async () => {
      // Set draft ID using the currentDraftId property (not formData.draftId)
      viewModel.currentDraftId = 'draft-123';
      await viewModel.submit();
      expect(mockOrganizationService.deleteDraft).toHaveBeenCalledWith('draft-123');
    });
  });

  describe('Field Error Tracking', () => {
    it('should show error only for touched fields', () => {
      const hasError = viewModel.hasFieldError('name');
      expect(hasError).toBe(false);

      viewModel.updateNestedField('name', '');
      viewModel.validate();
      expect(viewModel.hasFieldError('name')).toBe(true);
    });

    it('should get error message for field', () => {
      viewModel.updateNestedField('name', '');
      viewModel.validate();
      const errorMsg = viewModel.getFieldError('name');
      expect(errorMsg).toBeDefined();
      expect(errorMsg).toContain('required');
    });
  });

  describe('Submission Error Management', () => {
    it('should clear submission error', () => {
      // Set an error
      viewModel.submissionError = 'Test error';
      expect(viewModel.submissionError).toBe('Test error');

      // Clear it
      viewModel.clearSubmissionError();
      expect(viewModel.submissionError).toBeNull();
    });
  });
});
