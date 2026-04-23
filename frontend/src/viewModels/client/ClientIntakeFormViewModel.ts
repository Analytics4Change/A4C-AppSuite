/**
 * Client Intake Form ViewModel
 *
 * MobX ViewModel for multi-section client registration form.
 * Drives validation from org's field definitions, persists drafts
 * to sessionStorage (PII safety), and orchestrates submission
 * with a shared correlation ID across all RPCs (Decision 24).
 */

import { makeAutoObservable, runInAction, computed } from 'mobx';
import type { IClientService } from '@/services/clients/IClientService';
import type { IClientFieldService } from '@/services/client-fields/IClientFieldService';
import type { IOrganizationUnitService } from '@/services/organization/IOrganizationUnitService';
import { getClientService } from '@/services/clients/ClientServiceFactory';
import { getClientFieldService } from '@/services/client-fields/ClientFieldServiceFactory';
import { getOrganizationUnitService } from '@/services/organization/OrganizationUnitServiceFactory';
import type { FieldDefinition } from '@/types/client-field-settings.types';
import type {
  PhoneType,
  EmailType,
  AddressType,
  InsurancePolicyType,
  ContactDesignation,
  ClientRpcEnvelope,
  PlacementArrangement,
} from '@/types/client.types';
import type { OrganizationUnit, OrganizationUnitNode } from '@/types/organization-unit.types';
import { buildOrganizationUnitTree } from '@/types/organization-unit.types';
import { getOUIdByPath, getOUPathById } from '@/utils/organizationUnitPath';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('viewmodel');

const DRAFT_KEY = 'a4c-client-intake-draft';

/** Sections in fixed navigation order (discharge excluded from intake) */
export const INTAKE_SECTIONS = [
  'demographics',
  'contact_info',
  'guardian',
  'referral',
  'admission',
  'insurance',
  'clinical',
  'medical',
  'legal',
  'education',
] as const;

export type IntakeSection = (typeof INTAKE_SECTIONS)[number];

// ---------------------------------------------------------------------------
// Draft sub-entity types (not yet persisted to DB — no id/timestamps)
// ---------------------------------------------------------------------------

export interface DraftPhone {
  phone_number: string;
  phone_type: PhoneType;
  is_primary: boolean;
}

export interface DraftEmail {
  email: string;
  email_type: EmailType;
  is_primary: boolean;
}

export interface DraftAddress {
  address_type: AddressType;
  street1: string;
  street2: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  is_primary: boolean;
}

export interface DraftInsurance {
  policy_type: InsurancePolicyType;
  payer_name: string;
  policy_number: string;
  group_number: string;
  subscriber_name: string;
  subscriber_relation: string;
  coverage_start_date: string;
  coverage_end_date: string;
}

export interface DraftClinicalContact {
  designation: ContactDesignation;
  contact_id?: string;
  new_contact?: {
    first_name: string;
    last_name: string;
    email: string;
    title: string;
  };
}

// ---------------------------------------------------------------------------
// ViewModel
// ---------------------------------------------------------------------------

export class ClientIntakeFormViewModel {
  // Form data — flat key/value map for the JSONB payload
  formData: Record<string, unknown> = {};

  // Sub-entity draft collections
  phones: DraftPhone[] = [];
  emails: DraftEmail[] = [];
  addresses: DraftAddress[] = [];
  insurancePolicies: DraftInsurance[] = [];
  clinicalContacts: DraftClinicalContact[] = [];

  // Field definitions (loaded from ClientFieldService for validation)
  fieldDefinitions: FieldDefinition[] = [];

  // Navigation
  currentSection: IntakeSection = 'demographics';
  visitedSections: Set<IntakeSection> = new Set(['demographics']);

  // Submission state
  isSubmitting = false;
  submitError: string | null = null;
  submitSuccess = false;
  registeredClientId: string | null = null;
  correlationId: string | null = null;
  subEntityErrors: string[] = [];

  // Loading
  isLoadingFieldDefinitions = false;
  loadError: string | null = null;

  // Organizational units (for OU picker in Admission section)
  organizationUnits: OrganizationUnit[] = [];
  organizationUnitsRootPath = '';
  isLoadingOrganizationUnits = false;
  organizationUnitsError: string | null = null;

  // Draft
  private draftDirty = false;

  constructor(
    private clientService: IClientService = getClientService(),
    private fieldService: IClientFieldService = getClientFieldService(),
    private organizationUnitService: IOrganizationUnitService = getOrganizationUnitService()
  ) {
    makeAutoObservable(this, {
      requiredFieldKeys: computed,
      visibleFieldKeys: computed,
      sectionValidation: computed,
      canSubmit: computed,
      completionPercentage: computed,
      validationErrors: computed,
      unfilledRequiredFields: computed,
      organizationUnitTree: computed,
      selectedOrganizationUnitPath: computed,
    });
  }

  // -------------------------------------------------------------------------
  // Computed
  // -------------------------------------------------------------------------

  get requiredFieldKeys(): Set<string> {
    const keys = new Set<string>();
    for (const fd of this.fieldDefinitions) {
      if (fd.is_required && fd.is_visible && fd.is_active) {
        keys.add(fd.field_key);
      }
    }
    return keys;
  }

  get visibleFieldKeys(): Set<string> {
    const keys = new Set<string>();
    for (const fd of this.fieldDefinitions) {
      if (fd.is_visible && fd.is_active) {
        keys.add(fd.field_key);
      }
    }
    return keys;
  }

  get sectionValidation(): Map<IntakeSection, 'valid' | 'invalid' | 'incomplete'> {
    const result = new Map<IntakeSection, 'valid' | 'invalid' | 'incomplete'>();

    for (const section of INTAKE_SECTIONS) {
      const sectionFields = this.fieldDefinitions.filter(
        (fd) => fd.category_slug === section && fd.is_visible && fd.is_active
      );

      if (sectionFields.length === 0) {
        result.set(section, this.visitedSections.has(section) ? 'valid' : 'incomplete');
        continue;
      }

      const requiredInSection = sectionFields.filter((fd) => fd.is_required);
      if (requiredInSection.length === 0) {
        result.set(section, this.visitedSections.has(section) ? 'valid' : 'incomplete');
        continue;
      }

      const allFilled = requiredInSection.every((fd) => {
        const value = this.formData[fd.field_key];
        return value !== undefined && value !== null && value !== '';
      });

      if (allFilled) {
        result.set(section, 'valid');
      } else if (this.visitedSections.has(section)) {
        result.set(section, 'invalid');
      } else {
        result.set(section, 'incomplete');
      }
    }

    return result;
  }

  get canSubmit(): boolean {
    if (this.isSubmitting || this.isLoadingFieldDefinitions) return false;

    for (const key of this.requiredFieldKeys) {
      const value = this.formData[key];
      if (value === undefined || value === null || value === '') return false;
    }

    return true;
  }

  get completionPercentage(): number {
    const sections = [...this.sectionValidation.values()];
    if (sections.length === 0) return 0;
    const valid = sections.filter((s) => s === 'valid').length;
    return Math.round((valid / sections.length) * 100);
  }

  get validationErrors(): Map<string, string> {
    const errors = new Map<string, string>();
    for (const fd of this.fieldDefinitions) {
      if (!fd.is_required || !fd.is_visible || !fd.is_active) continue;
      const value = this.formData[fd.field_key];
      if (value === undefined || value === null || value === '') {
        errors.set(fd.field_key, `${fd.display_name} is required`);
      }
    }
    return errors;
  }

  get unfilledRequiredFields(): Array<{
    fieldKey: string;
    displayName: string;
    section: string;
  }> {
    const unfilled: Array<{ fieldKey: string; displayName: string; section: string }> = [];
    for (const fd of this.fieldDefinitions) {
      if (!fd.is_required || !fd.is_visible || !fd.is_active) continue;
      const value = this.formData[fd.field_key];
      if (value === undefined || value === null || value === '') {
        unfilled.push({
          fieldKey: fd.field_key,
          displayName: fd.configurable_label ?? fd.display_name,
          section: fd.category_name,
        });
      }
    }
    return unfilled;
  }

  /**
   * Tree nodes for the OU picker in the Admission section.
   * Rebuilt whenever organizationUnits / rootPath change.
   */
  get organizationUnitTree(): OrganizationUnitNode[] {
    if (this.organizationUnits.length === 0) return [];
    return buildOrganizationUnitTree(this.organizationUnits, this.organizationUnitsRootPath);
  }

  /**
   * The selected OU's ltree path, mapped from formData.organization_unit_id.
   * Returns null when no OU is selected or when the stored id is unknown
   * (e.g. deactivated unit filtered out of the loaded list).
   */
  get selectedOrganizationUnitPath(): string | null {
    const id = this.formData.organization_unit_id;
    if (typeof id !== 'string') return null;
    return getOUPathById(this.organizationUnits, id);
  }

  // -------------------------------------------------------------------------
  // Actions — Field definitions
  // -------------------------------------------------------------------------

  async loadFieldDefinitions(): Promise<void> {
    runInAction(() => {
      this.isLoadingFieldDefinitions = true;
      this.loadError = null;
    });

    try {
      const definitions = await this.fieldService.listFieldDefinitions();
      runInAction(() => {
        this.fieldDefinitions = definitions;
        this.isLoadingFieldDefinitions = false;
      });
      this.loadDraft();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load field definitions';
      log.error('Failed to load field definitions', { error });
      runInAction(() => {
        this.loadError = message;
        this.isLoadingFieldDefinitions = false;
      });
    }
  }

  // -------------------------------------------------------------------------
  // Actions — Organizational units
  // -------------------------------------------------------------------------

  /**
   * Load active organizational units for the Admission OU picker.
   * No-op if already loaded or currently loading. On failure the picker
   * degrades to empty (OU remains unset); failure is non-fatal for intake.
   */
  async loadOrganizationUnits(): Promise<void> {
    if (this.isLoadingOrganizationUnits) return;
    if (this.organizationUnits.length > 0) return;

    runInAction(() => {
      this.isLoadingOrganizationUnits = true;
      this.organizationUnitsError = null;
    });

    try {
      const units = await this.organizationUnitService.getUnits({ status: 'active' });
      const rootPath =
        units.length > 0
          ? units.reduce<string>(
              (shortest, unit) => (unit.path.length < shortest.length ? unit.path : shortest),
              units[0].path
            )
          : '';
      runInAction(() => {
        this.organizationUnits = units;
        this.organizationUnitsRootPath = rootPath;
        this.isLoadingOrganizationUnits = false;
      });
      log.debug('Organizational units loaded for intake OU picker', { count: units.length });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to load organizational units';
      log.warn('Failed to load organizational units for intake', { error });
      runInAction(() => {
        this.organizationUnitsError = message;
        this.isLoadingOrganizationUnits = false;
      });
    }
  }

  /** Map TreeSelectDropdown's ltree path selection back to an OU id and store it. */
  setOrganizationUnitByPath(path: string | null): void {
    const id = getOUIdByPath(this.organizationUnits, path);
    this.setField('organization_unit_id', id);
  }

  // -------------------------------------------------------------------------
  // Actions — Form data
  // -------------------------------------------------------------------------

  setField(key: string, value: unknown): void {
    runInAction(() => {
      this.formData = { ...this.formData, [key]: value };
      this.submitSuccess = false;
      this.submitError = null;
      this.draftDirty = true;
    });
    this.saveDraft();
  }

  setMultipleFields(fields: Record<string, unknown>): void {
    runInAction(() => {
      this.formData = { ...this.formData, ...fields };
      this.submitSuccess = false;
      this.draftDirty = true;
    });
    this.saveDraft();
  }

  // -------------------------------------------------------------------------
  // Actions — Sub-entity collections
  // -------------------------------------------------------------------------

  addPhone(phone: DraftPhone): void {
    runInAction(() => {
      this.phones = [...this.phones, phone];
      this.draftDirty = true;
    });
    this.saveDraft();
  }

  updatePhone(index: number, phone: Partial<DraftPhone>): void {
    runInAction(() => {
      this.phones = this.phones.map((p, i) => (i === index ? { ...p, ...phone } : p));
      this.draftDirty = true;
    });
    this.saveDraft();
  }

  removePhone(index: number): void {
    runInAction(() => {
      this.phones = this.phones.filter((_, i) => i !== index);
      this.draftDirty = true;
    });
    this.saveDraft();
  }

  addEmail(email: DraftEmail): void {
    runInAction(() => {
      this.emails = [...this.emails, email];
      this.draftDirty = true;
    });
    this.saveDraft();
  }

  updateEmail(index: number, email: Partial<DraftEmail>): void {
    runInAction(() => {
      this.emails = this.emails.map((e, i) => (i === index ? { ...e, ...email } : e));
      this.draftDirty = true;
    });
    this.saveDraft();
  }

  removeEmail(index: number): void {
    runInAction(() => {
      this.emails = this.emails.filter((_, i) => i !== index);
      this.draftDirty = true;
    });
    this.saveDraft();
  }

  addAddress(address: DraftAddress): void {
    runInAction(() => {
      this.addresses = [...this.addresses, address];
      this.draftDirty = true;
    });
    this.saveDraft();
  }

  updateAddress(index: number, address: Partial<DraftAddress>): void {
    runInAction(() => {
      this.addresses = this.addresses.map((a, i) => (i === index ? { ...a, ...address } : a));
      this.draftDirty = true;
    });
    this.saveDraft();
  }

  removeAddress(index: number): void {
    runInAction(() => {
      this.addresses = this.addresses.filter((_, i) => i !== index);
      this.draftDirty = true;
    });
    this.saveDraft();
  }

  addInsurancePolicy(policy: DraftInsurance): void {
    runInAction(() => {
      this.insurancePolicies = [...this.insurancePolicies, policy];
      this.draftDirty = true;
    });
    this.saveDraft();
  }

  updateInsurancePolicy(index: number, policy: Partial<DraftInsurance>): void {
    runInAction(() => {
      this.insurancePolicies = this.insurancePolicies.map((p, i) =>
        i === index ? { ...p, ...policy } : p
      );
      this.draftDirty = true;
    });
    this.saveDraft();
  }

  removeInsurancePolicy(index: number): void {
    runInAction(() => {
      this.insurancePolicies = this.insurancePolicies.filter((_, i) => i !== index);
      this.draftDirty = true;
    });
    this.saveDraft();
  }

  addClinicalContact(contact: DraftClinicalContact): void {
    runInAction(() => {
      this.clinicalContacts = [...this.clinicalContacts, contact];
      this.draftDirty = true;
    });
    this.saveDraft();
  }

  removeClinicalContact(index: number): void {
    runInAction(() => {
      this.clinicalContacts = this.clinicalContacts.filter((_, i) => i !== index);
      this.draftDirty = true;
    });
    this.saveDraft();
  }

  // -------------------------------------------------------------------------
  // Actions — Navigation
  // -------------------------------------------------------------------------

  setCurrentSection(section: IntakeSection): void {
    runInAction(() => {
      this.currentSection = section;
      this.visitedSections = new Set([...this.visitedSections, section]);
    });
  }

  // -------------------------------------------------------------------------
  // Actions — Draft persistence (sessionStorage, PII safety)
  // -------------------------------------------------------------------------

  saveDraft(): void {
    if (!this.draftDirty) return;
    try {
      const draft = {
        formData: this.formData,
        phones: this.phones,
        emails: this.emails,
        addresses: this.addresses,
        insurancePolicies: this.insurancePolicies,
        clinicalContacts: this.clinicalContacts,
        currentSection: this.currentSection,
        visitedSections: [...this.visitedSections],
      };
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
      this.draftDirty = false;
    } catch (error) {
      log.warn('Failed to save draft to sessionStorage', { error });
    }
  }

  loadDraft(): void {
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (!raw) return;

      const draft = JSON.parse(raw);
      runInAction(() => {
        this.formData = draft.formData ?? {};
        this.phones = draft.phones ?? [];
        this.emails = draft.emails ?? [];
        this.addresses = draft.addresses ?? [];
        this.insurancePolicies = draft.insurancePolicies ?? [];
        this.clinicalContacts = draft.clinicalContacts ?? [];
        if (draft.currentSection) this.currentSection = draft.currentSection;
        if (draft.visitedSections) this.visitedSections = new Set(draft.visitedSections);
      });
      log.debug('Draft loaded from sessionStorage');
    } catch (error) {
      log.warn('Failed to load draft from sessionStorage', { error });
    }
  }

  clearDraft(): void {
    try {
      sessionStorage.removeItem(DRAFT_KEY);
    } catch {
      // ignore
    }
    runInAction(() => {
      this.formData = {};
      this.phones = [];
      this.emails = [];
      this.addresses = [];
      this.insurancePolicies = [];
      this.clinicalContacts = [];
      this.currentSection = 'demographics';
      this.visitedSections = new Set(['demographics']);
      this.draftDirty = false;
    });
  }

  // -------------------------------------------------------------------------
  // Actions — Submit
  // -------------------------------------------------------------------------

  async submit(orgId: string): Promise<boolean> {
    const correlationId = globalThis.crypto.randomUUID();

    runInAction(() => {
      this.isSubmitting = true;
      this.submitError = null;
      this.submitSuccess = false;
      this.subEntityErrors = [];
      this.correlationId = correlationId;
    });

    try {
      // 1. Register the client
      const clientData = { ...this.formData, organization_id: orgId };
      const result = await this.clientService.registerClient({
        client_data: clientData,
        reason: 'Client registered via intake form',
        correlation_id: correlationId,
      });

      if (!result.success || !result.client_id) {
        runInAction(() => {
          this.submitError = result.error ?? 'Registration failed';
          this.isSubmitting = false;
        });
        return false;
      }

      const clientId = result.client_id;

      // 2. Fire sub-entity + placement RPCs in parallel (partial success acceptable)
      const subEntityPromises: Promise<ClientRpcEnvelope>[] = [];

      // 2a. OU-aware placement history: if both arrangement AND OU are set at
      // intake, emit client.placement.changed so the history row carries OU
      // from the start. handle_client_registered already stamps OU onto
      // clients_projection, so registration alone is sufficient when no
      // placement arrangement is selected.
      const placementArrangement = this.formData.placement_arrangement;
      const organizationUnitId = this.formData.organization_unit_id;
      const admissionDate = this.formData.admission_date;
      if (
        typeof placementArrangement === 'string' &&
        placementArrangement.length > 0 &&
        typeof organizationUnitId === 'string' &&
        organizationUnitId.length > 0 &&
        typeof admissionDate === 'string' &&
        admissionDate.length > 0
      ) {
        subEntityPromises.push(
          this.clientService.changeClientPlacement(clientId, {
            placement_arrangement: placementArrangement as PlacementArrangement,
            start_date: admissionDate,
            organization_unit_id: organizationUnitId,
            reason: 'Initial placement at intake',
            correlation_id: correlationId,
          })
        );
      }

      for (const phone of this.phones) {
        subEntityPromises.push(
          this.clientService.addClientPhone(clientId, {
            ...phone,
            correlation_id: correlationId,
          })
        );
      }
      for (const email of this.emails) {
        subEntityPromises.push(
          this.clientService.addClientEmail(clientId, {
            ...email,
            correlation_id: correlationId,
          })
        );
      }
      for (const address of this.addresses) {
        subEntityPromises.push(
          this.clientService.addClientAddress(clientId, {
            street1: address.street1,
            street2: address.street2 || undefined,
            city: address.city,
            state: address.state,
            zip: address.zip,
            country: address.country || 'US',
            address_type: address.address_type,
            is_primary: address.is_primary,
            correlation_id: correlationId,
          })
        );
      }
      for (const policy of this.insurancePolicies) {
        subEntityPromises.push(
          this.clientService.addClientInsurance(clientId, {
            policy_type: policy.policy_type,
            payer_name: policy.payer_name,
            policy_number: policy.policy_number || undefined,
            group_number: policy.group_number || undefined,
            subscriber_name: policy.subscriber_name || undefined,
            subscriber_relation: policy.subscriber_relation || undefined,
            coverage_start_date: policy.coverage_start_date || undefined,
            coverage_end_date: policy.coverage_end_date || undefined,
            correlation_id: correlationId,
          })
        );
      }
      for (const contact of this.clinicalContacts) {
        if (contact.contact_id) {
          subEntityPromises.push(
            this.clientService.assignClientContact(
              clientId,
              contact.contact_id,
              contact.designation
            )
          );
        }
      }

      if (subEntityPromises.length > 0) {
        const settled = await Promise.allSettled(subEntityPromises);
        const errors: string[] = [];
        for (const s of settled) {
          if (s.status === 'rejected') {
            errors.push(String(s.reason));
          } else if (!s.value.success) {
            errors.push(s.value.error ?? 'Sub-entity operation failed');
          }
        }
        if (errors.length > 0) {
          log.warn('Some sub-entity operations failed', { errors });
        }
        runInAction(() => {
          this.subEntityErrors = errors;
        });
      }

      // 3. Success
      runInAction(() => {
        this.isSubmitting = false;
        this.submitSuccess = true;
        this.registeredClientId = clientId;
      });
      this.clearDraft();
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Registration failed';
      log.error('Client registration failed', { error });
      runInAction(() => {
        this.submitError = message;
        this.isSubmitting = false;
      });
      return false;
    }
  }
}
