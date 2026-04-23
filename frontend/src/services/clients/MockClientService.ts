/**
 * Mock Client Service
 *
 * In-memory implementation for development and testing.
 * Seeded with 3 sample clients in a residential behavioral healthcare context.
 */

import type {
  Client,
  ClientListItem,
  ClientUpdateResult,
  ClientPhoneResult,
  ClientEmailResult,
  ClientAddressResult,
  ClientInsuranceResult,
  ClientFundingResult,
  ClientPlacementResult,
  ClientAssignmentResult,
  ClientVoidResult,
  ClientPhone,
  ClientEmail,
  ClientAddress,
  ClientInsurancePolicy,
  ClientPlacementHistory,
  ClientFundingSource,
  ClientContactAssignment,
  RegisterClientParams,
  UpdateClientParams,
  AdmitClientParams,
  DischargeClientParams,
  AddPhoneParams,
  UpdatePhoneParams,
  AddEmailParams,
  UpdateEmailParams,
  AddAddressParams,
  UpdateAddressParams,
  AddInsuranceParams,
  UpdateInsuranceParams,
  ChangePlacementParams,
  AddFundingSourceParams,
  UpdateFundingSourceParams,
  ClientStatus,
} from '@/types/client.types';
import type { IClientService } from './IClientService';
import { getOrganizationUnitService } from '@/services/organization/OrganizationUnitServiceFactory';

const MOCK_ORG_ID = '00000000-0000-0000-0000-000000000001';

/**
 * Resolve current OU state for a placement row — mirrors the real
 * api.get_client() LEFT JOIN to organization_units_projection. Fields are
 * nullable when the OU is not assigned or not found.
 */
async function resolvePlacementOuState(
  placement: ClientPlacementHistory
): Promise<ClientPlacementHistory> {
  if (!placement.organization_unit_id) {
    return {
      ...placement,
      organization_unit_name: null,
      organization_unit_is_active: null,
      organization_unit_deleted_at: null,
    };
  }
  try {
    const unit = await getOrganizationUnitService().getUnitById(placement.organization_unit_id);
    if (!unit) {
      return {
        ...placement,
        organization_unit_name: null,
        organization_unit_is_active: null,
        organization_unit_deleted_at: null,
      };
    }
    return {
      ...placement,
      organization_unit_name: unit.displayName || unit.name,
      organization_unit_is_active: unit.isActive,
      organization_unit_deleted_at: null,
    };
  } catch {
    return {
      ...placement,
      organization_unit_name: null,
      organization_unit_is_active: null,
      organization_unit_deleted_at: null,
    };
  }
}
const MOCK_USER_ID = '00000000-0000-0000-0000-000000000099';

function delay(): Promise<void> {
  const ms = typeof process !== 'undefined' && process.env?.NODE_ENV === 'test' ? 0 : 300;
  return new Promise((r) => setTimeout(r, ms));
}

function uuid(): string {
  return globalThis.crypto.randomUUID();
}

function now(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Seed data
// ---------------------------------------------------------------------------

function buildSeedClients(): Client[] {
  const ts = '2026-03-15T10:00:00.000Z';
  const base = {
    organization_id: MOCK_ORG_ID,
    organization_unit_id: null,
    data_source: 'manual' as const,
    gender_identity: null,
    pronouns: null,
    secondary_language: null,
    interpreter_needed: null,
    marital_status: null,
    citizenship_status: null,
    photo_url: null,
    mrn: null,
    external_id: null,
    drivers_license: null,
    referral_source_type: null,
    referral_organization: null,
    referral_date: null,
    reason_for_referral: null,
    admission_type: null,
    level_of_care: null,
    expected_length_of_stay: null,
    medicaid_id: null,
    medicare_id: null,
    primary_diagnosis: null,
    secondary_diagnoses: null,
    dsm5_diagnoses: null,
    presenting_problem: null,
    suicide_risk_status: null,
    violence_risk_status: null,
    trauma_history_indicator: null,
    substance_use_history: null,
    developmental_history: null,
    previous_treatment_history: null,
    immunization_status: null,
    dietary_restrictions: null,
    special_medical_needs: null,
    legal_custody_status: null,
    court_ordered_placement: null,
    financial_guarantor_type: null,
    court_case_number: null,
    state_agency: null,
    legal_status: null,
    mandated_reporting_status: null,
    protective_services_involvement: null,
    safety_plan_required: null,
    discharge_date: null,
    discharge_outcome: null,
    discharge_reason: null,
    discharge_diagnosis: null,
    discharge_placement: null,
    education_status: null,
    grade_level: null,
    iep_status: null,
    custom_fields: {},
    created_by: MOCK_USER_ID,
    updated_by: MOCK_USER_ID,
    last_event_id: null,
  };

  return [
    {
      ...base,
      id: 'c0000000-0000-0000-0000-000000000001',
      status: 'active',
      first_name: 'Marcus',
      last_name: 'Johnson',
      middle_name: 'Dwayne',
      preferred_name: null,
      date_of_birth: '2010-06-15',
      gender: 'Male',
      race: ['Black or African American'],
      ethnicity: 'Not Hispanic or Latino',
      primary_language: 'English',
      admission_date: '2026-02-01',
      initial_risk_level: 'moderate',
      placement_arrangement: 'residential_treatment',
      allergies: {
        nka: false,
        items: [{ name: 'Penicillin', allergy_type: 'medication', severity: 'moderate' }],
      },
      medical_conditions: { nkmc: true, items: [] },
      created_at: ts,
      updated_at: ts,
      phones: [],
      emails: [],
      addresses: [],
      insurance_policies: [],
      placement_history: [],
      funding_sources: [],
      contact_assignments: [],
    },
    {
      ...base,
      id: 'c0000000-0000-0000-0000-000000000002',
      status: 'active',
      first_name: 'Sofia',
      last_name: 'Ramirez',
      middle_name: null,
      preferred_name: 'Sofi',
      date_of_birth: '2011-11-22',
      gender: 'Female',
      race: ['White'],
      ethnicity: 'Hispanic or Latino',
      primary_language: 'Spanish',
      admission_date: '2026-01-10',
      initial_risk_level: 'high',
      placement_arrangement: 'therapeutic_foster_care',
      allergies: { nka: true, items: [] },
      medical_conditions: {
        nkmc: false,
        items: [
          { code: 'F90.0', description: 'ADHD, predominantly inattentive', is_chronic: true },
        ],
      },
      legal_custody_status: 'state_child_welfare',
      financial_guarantor_type: 'state_agency',
      state_agency: 'DCFS',
      created_at: ts,
      updated_at: ts,
      phones: [],
      emails: [],
      addresses: [],
      insurance_policies: [],
      placement_history: [],
      funding_sources: [],
      contact_assignments: [],
    },
    {
      ...base,
      id: 'c0000000-0000-0000-0000-000000000003',
      status: 'discharged',
      first_name: 'Jayden',
      last_name: 'Williams',
      middle_name: 'Ray',
      preferred_name: 'Jay',
      date_of_birth: '2009-03-08',
      gender: 'Male',
      race: ['Black or African American', 'White'],
      ethnicity: 'Not Hispanic or Latino',
      primary_language: 'English',
      admission_date: '2025-09-01',
      initial_risk_level: 'low',
      placement_arrangement: null,
      discharge_date: '2026-03-01',
      discharge_outcome: 'successful',
      discharge_reason: 'graduated_program',
      discharge_placement: 'home',
      allergies: { nka: true, items: [] },
      medical_conditions: { nkmc: true, items: [] },
      created_at: '2025-09-01T08:00:00.000Z',
      updated_at: '2026-03-01T16:00:00.000Z',
      phones: [],
      emails: [],
      addresses: [],
      insurance_policies: [],
      placement_history: [],
      funding_sources: [],
      contact_assignments: [],
    },
  ];
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class MockClientService implements IClientService {
  private clients: Client[] = buildSeedClients();
  private phones: ClientPhone[] = [];
  private emails: ClientEmail[] = [];
  private addresses: ClientAddress[] = [];
  private insurance: ClientInsurancePolicy[] = [];
  private placements: ClientPlacementHistory[] = [];
  private funding: ClientFundingSource[] = [];
  private assignments: ClientContactAssignment[] = [];

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  async listClients(status?: string, searchTerm?: string): Promise<ClientListItem[]> {
    await delay();
    let result = this.clients.map((c) => ({ ...c }));

    if (status) {
      result = result.filter((c) => c.status === status);
    }
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter(
        (c) =>
          c.first_name.toLowerCase().includes(term) ||
          c.last_name.toLowerCase().includes(term) ||
          c.mrn?.toLowerCase().includes(term) ||
          c.external_id?.toLowerCase().includes(term)
      );
    }

    return result.map((c) => ({
      id: c.id,
      first_name: c.first_name,
      last_name: c.last_name,
      middle_name: c.middle_name,
      preferred_name: c.preferred_name,
      date_of_birth: c.date_of_birth,
      gender: c.gender,
      status: c.status,
      mrn: c.mrn,
      external_id: c.external_id,
      admission_date: c.admission_date,
      organization_unit_id: c.organization_unit_id,
      placement_arrangement: c.placement_arrangement,
      initial_risk_level: c.initial_risk_level,
      created_at: c.created_at,
    }));
  }

  async getClient(clientId: string): Promise<Client> {
    await delay();
    const client = this.clients.find((c) => c.id === clientId);
    if (!client) throw new Error('Client not found');

    return {
      ...client,
      phones: this.phones
        .filter((p) => p.client_id === clientId && p.is_active)
        .map((p) => ({ ...p })),
      emails: this.emails
        .filter((e) => e.client_id === clientId && e.is_active)
        .map((e) => ({ ...e })),
      addresses: this.addresses
        .filter((a) => a.client_id === clientId && a.is_active)
        .map((a) => ({ ...a })),
      insurance_policies: this.insurance
        .filter((i) => i.client_id === clientId && i.is_active)
        .map((i) => ({ ...i })),
      placement_history: await Promise.all(
        this.placements
          .filter((p) => p.client_id === clientId)
          .map((p) => resolvePlacementOuState({ ...p }))
      ),
      funding_sources: this.funding
        .filter((f) => f.client_id === clientId && f.is_active)
        .map((f) => ({ ...f })),
      contact_assignments: this.assignments
        .filter((a) => a.client_id === clientId && a.is_active)
        .map((a) => ({ ...a })),
    };
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async registerClient(params: RegisterClientParams): Promise<ClientUpdateResult> {
    await delay();
    const d = params.client_data;

    if (!d.first_name || !d.last_name || !d.date_of_birth || !d.gender || !d.admission_date) {
      return { success: false, error: 'Missing required fields' };
    }

    const id = uuid();
    const ts = now();

    const client: Client = {
      id,
      organization_id: (d.organization_id as string) ?? MOCK_ORG_ID,
      organization_unit_id: (d.organization_unit_id as string) ?? null,
      status: 'active',
      data_source: 'manual',
      first_name: d.first_name as string,
      last_name: d.last_name as string,
      middle_name: (d.middle_name as string) ?? null,
      preferred_name: (d.preferred_name as string) ?? null,
      date_of_birth: d.date_of_birth as string,
      gender: d.gender as string,
      gender_identity: (d.gender_identity as string) ?? null,
      pronouns: (d.pronouns as string) ?? null,
      race: (d.race as string[]) ?? null,
      ethnicity: (d.ethnicity as string) ?? null,
      primary_language: (d.primary_language as string) ?? null,
      secondary_language: (d.secondary_language as string) ?? null,
      interpreter_needed: (d.interpreter_needed as boolean) ?? null,
      marital_status: (d.marital_status as string) ?? null,
      citizenship_status: (d.citizenship_status as string) ?? null,
      photo_url: null,
      mrn: (d.mrn as string) ?? null,
      external_id: (d.external_id as string) ?? null,
      drivers_license: (d.drivers_license as string) ?? null,
      referral_source_type: (d.referral_source_type as string) ?? null,
      referral_organization: (d.referral_organization as string) ?? null,
      referral_date: (d.referral_date as string) ?? null,
      reason_for_referral: (d.reason_for_referral as string) ?? null,
      admission_date: d.admission_date as string,
      admission_type: (d.admission_type as string) ?? null,
      level_of_care: (d.level_of_care as string) ?? null,
      expected_length_of_stay: (d.expected_length_of_stay as number) ?? null,
      initial_risk_level: (d.initial_risk_level as string) ?? null,
      placement_arrangement: (d.placement_arrangement as string) ?? null,
      medicaid_id: (d.medicaid_id as string) ?? null,
      medicare_id: (d.medicare_id as string) ?? null,
      primary_diagnosis: (d.primary_diagnosis as Record<string, unknown>) ?? null,
      secondary_diagnoses: (d.secondary_diagnoses as Record<string, unknown>) ?? null,
      dsm5_diagnoses: (d.dsm5_diagnoses as Record<string, unknown>) ?? null,
      presenting_problem: (d.presenting_problem as string) ?? null,
      suicide_risk_status: (d.suicide_risk_status as string) ?? null,
      violence_risk_status: (d.violence_risk_status as string) ?? null,
      trauma_history_indicator: (d.trauma_history_indicator as boolean) ?? null,
      substance_use_history: (d.substance_use_history as string) ?? null,
      developmental_history: (d.developmental_history as string) ?? null,
      previous_treatment_history: (d.previous_treatment_history as string) ?? null,
      allergies: (d.allergies as Record<string, unknown>) ?? { nka: true, items: [] },
      medical_conditions: (d.medical_conditions as Record<string, unknown>) ?? {
        nkmc: true,
        items: [],
      },
      immunization_status: (d.immunization_status as string) ?? null,
      dietary_restrictions: (d.dietary_restrictions as string) ?? null,
      special_medical_needs: (d.special_medical_needs as string) ?? null,
      legal_custody_status: (d.legal_custody_status as string) ?? null,
      court_ordered_placement: (d.court_ordered_placement as boolean) ?? null,
      financial_guarantor_type: (d.financial_guarantor_type as string) ?? null,
      court_case_number: (d.court_case_number as string) ?? null,
      state_agency: (d.state_agency as string) ?? null,
      legal_status: (d.legal_status as string) ?? null,
      mandated_reporting_status: (d.mandated_reporting_status as boolean) ?? null,
      protective_services_involvement: (d.protective_services_involvement as boolean) ?? null,
      safety_plan_required: (d.safety_plan_required as boolean) ?? null,
      discharge_date: null,
      discharge_outcome: null,
      discharge_reason: null,
      discharge_diagnosis: null,
      discharge_placement: null,
      education_status: (d.education_status as string) ?? null,
      grade_level: (d.grade_level as string) ?? null,
      iep_status: (d.iep_status as boolean) ?? null,
      custom_fields: (d.custom_fields as Record<string, unknown>) ?? {},
      created_at: ts,
      updated_at: ts,
      created_by: MOCK_USER_ID,
      updated_by: MOCK_USER_ID,
      last_event_id: null,
      phones: [],
      emails: [],
      addresses: [],
      insurance_policies: [],
      placement_history: [],
      funding_sources: [],
      contact_assignments: [],
    };

    this.clients = [...this.clients, client];
    // Mock parity: return the full projection row (sub-entity arrays are
    // structurally tolerated by ClientProjectionRow's Omit<...> shape but
    // are not part of the contract — consumers must call getClient() for them).
    return {
      success: true,
      client_id: id,
      client,
    };
  }

  async updateClient(clientId: string, params: UpdateClientParams): Promise<ClientUpdateResult> {
    await delay();
    const idx = this.clients.findIndex((c) => c.id === clientId);
    if (idx === -1) return { success: false, error: 'Client not found' };

    this.clients = this.clients.map((c, i) =>
      i === idx ? ({ ...c, ...params.changes, updated_at: now() } as Client) : c
    );
    return { success: true, client_id: clientId };
  }

  async admitClient(clientId: string, _params?: AdmitClientParams): Promise<ClientUpdateResult> {
    await delay();
    const idx = this.clients.findIndex((c) => c.id === clientId);
    if (idx === -1) return { success: false, error: 'Client not found' };

    this.clients = this.clients.map((c, i) =>
      i === idx ? { ...c, status: 'active' as ClientStatus, updated_at: now() } : c
    );
    return { success: true, client_id: clientId };
  }

  async dischargeClient(
    clientId: string,
    params: DischargeClientParams
  ): Promise<ClientUpdateResult> {
    await delay();
    const idx = this.clients.findIndex((c) => c.id === clientId);
    if (idx === -1) return { success: false, error: 'Client not found' };

    this.clients = this.clients.map((c, i) =>
      i === idx
        ? {
            ...c,
            status: 'discharged' as ClientStatus,
            discharge_date: params.discharge_date,
            discharge_outcome: params.discharge_outcome,
            discharge_reason: params.discharge_reason,
            discharge_diagnosis: params.discharge_diagnosis ?? null,
            discharge_placement: params.discharge_placement ?? null,
            updated_at: now(),
          }
        : c
    );
    return { success: true, client_id: clientId };
  }

  // -------------------------------------------------------------------------
  // Phone
  // -------------------------------------------------------------------------

  async addClientPhone(clientId: string, params: AddPhoneParams): Promise<ClientPhoneResult> {
    await delay();
    const id = uuid();
    const phone: ClientPhone = {
      id,
      client_id: clientId,
      organization_id: MOCK_ORG_ID,
      phone_number: params.phone_number,
      phone_type: params.phone_type ?? 'mobile',
      is_primary: params.is_primary ?? false,
      is_active: true,
      created_at: now(),
      updated_at: null,
      last_event_id: null,
    };
    this.phones = [...this.phones, phone];
    return { success: true, phone_id: id };
  }

  async updateClientPhone(
    _clientId: string,
    phoneId: string,
    params: UpdatePhoneParams
  ): Promise<ClientPhoneResult> {
    await delay();
    this.phones = this.phones.map((p) =>
      p.id === phoneId
        ? {
            ...p,
            phone_number: params.phone_number ?? p.phone_number,
            phone_type: params.phone_type ?? p.phone_type,
            is_primary: params.is_primary ?? p.is_primary,
            updated_at: now(),
          }
        : p
    );
    return { success: true, phone_id: phoneId };
  }

  async removeClientPhone(
    _clientId: string,
    phoneId: string,
    _reason?: string
  ): Promise<ClientVoidResult> {
    await delay();
    this.phones = this.phones.map((p) =>
      p.id === phoneId ? { ...p, is_active: false, updated_at: now() } : p
    );
    return { success: true };
  }

  // -------------------------------------------------------------------------
  // Email
  // -------------------------------------------------------------------------

  async addClientEmail(clientId: string, params: AddEmailParams): Promise<ClientEmailResult> {
    await delay();
    const id = uuid();
    const email: ClientEmail = {
      id,
      client_id: clientId,
      organization_id: MOCK_ORG_ID,
      email: params.email,
      email_type: params.email_type ?? 'personal',
      is_primary: params.is_primary ?? false,
      is_active: true,
      created_at: now(),
      updated_at: null,
      last_event_id: null,
    };
    this.emails = [...this.emails, email];
    return { success: true, email_id: id };
  }

  async updateClientEmail(
    _clientId: string,
    emailId: string,
    params: UpdateEmailParams
  ): Promise<ClientEmailResult> {
    await delay();
    this.emails = this.emails.map((e) =>
      e.id === emailId
        ? {
            ...e,
            email: params.email ?? e.email,
            email_type: params.email_type ?? e.email_type,
            is_primary: params.is_primary ?? e.is_primary,
            updated_at: now(),
          }
        : e
    );
    return { success: true, email_id: emailId };
  }

  async removeClientEmail(
    _clientId: string,
    emailId: string,
    _reason?: string
  ): Promise<ClientVoidResult> {
    await delay();
    this.emails = this.emails.map((e) =>
      e.id === emailId ? { ...e, is_active: false, updated_at: now() } : e
    );
    return { success: true };
  }

  // -------------------------------------------------------------------------
  // Address
  // -------------------------------------------------------------------------

  async addClientAddress(clientId: string, params: AddAddressParams): Promise<ClientAddressResult> {
    await delay();
    const id = uuid();
    const addr: ClientAddress = {
      id,
      client_id: clientId,
      organization_id: MOCK_ORG_ID,
      address_type: params.address_type ?? 'home',
      street1: params.street1,
      street2: params.street2 ?? null,
      city: params.city,
      state: params.state,
      zip: params.zip,
      country: params.country ?? 'US',
      is_primary: params.is_primary ?? false,
      is_active: true,
      created_at: now(),
      updated_at: null,
      last_event_id: null,
    };
    this.addresses = [...this.addresses, addr];
    return { success: true, address_id: id };
  }

  async updateClientAddress(
    _clientId: string,
    addressId: string,
    params: UpdateAddressParams
  ): Promise<ClientAddressResult> {
    await delay();
    this.addresses = this.addresses.map((a) =>
      a.id === addressId
        ? {
            ...a,
            address_type: params.address_type ?? a.address_type,
            street1: params.street1 ?? a.street1,
            street2: params.street2 ?? a.street2,
            city: params.city ?? a.city,
            state: params.state ?? a.state,
            zip: params.zip ?? a.zip,
            country: params.country ?? a.country,
            is_primary: params.is_primary ?? a.is_primary,
            updated_at: now(),
          }
        : a
    );
    return { success: true, address_id: addressId };
  }

  async removeClientAddress(
    _clientId: string,
    addressId: string,
    _reason?: string
  ): Promise<ClientVoidResult> {
    await delay();
    this.addresses = this.addresses.map((a) =>
      a.id === addressId ? { ...a, is_active: false, updated_at: now() } : a
    );
    return { success: true };
  }

  // -------------------------------------------------------------------------
  // Insurance
  // -------------------------------------------------------------------------

  async addClientInsurance(
    clientId: string,
    params: AddInsuranceParams
  ): Promise<ClientInsuranceResult> {
    await delay();
    const id = uuid();
    const policy: ClientInsurancePolicy = {
      id,
      client_id: clientId,
      organization_id: MOCK_ORG_ID,
      policy_type: params.policy_type,
      payer_name: params.payer_name,
      policy_number: params.policy_number ?? null,
      group_number: params.group_number ?? null,
      subscriber_name: params.subscriber_name ?? null,
      subscriber_relation: params.subscriber_relation ?? null,
      coverage_start_date: params.coverage_start_date ?? null,
      coverage_end_date: params.coverage_end_date ?? null,
      is_active: true,
      created_at: now(),
      updated_at: null,
      last_event_id: null,
    };
    this.insurance = [...this.insurance, policy];
    return { success: true, policy_id: id };
  }

  async updateClientInsurance(
    _clientId: string,
    policyId: string,
    params: UpdateInsuranceParams
  ): Promise<ClientInsuranceResult> {
    await delay();
    this.insurance = this.insurance.map((i) =>
      i.id === policyId
        ? {
            ...i,
            payer_name: params.payer_name ?? i.payer_name,
            policy_number: params.policy_number ?? i.policy_number,
            group_number: params.group_number ?? i.group_number,
            subscriber_name: params.subscriber_name ?? i.subscriber_name,
            subscriber_relation: params.subscriber_relation ?? i.subscriber_relation,
            coverage_start_date: params.coverage_start_date ?? i.coverage_start_date,
            coverage_end_date: params.coverage_end_date ?? i.coverage_end_date,
            updated_at: now(),
          }
        : i
    );
    return { success: true, policy_id: policyId };
  }

  async removeClientInsurance(
    _clientId: string,
    policyId: string,
    _reason?: string
  ): Promise<ClientVoidResult> {
    await delay();
    this.insurance = this.insurance.map((i) =>
      i.id === policyId ? { ...i, is_active: false, updated_at: now() } : i
    );
    return { success: true };
  }

  // -------------------------------------------------------------------------
  // Placement
  // -------------------------------------------------------------------------

  async changeClientPlacement(
    clientId: string,
    params: ChangePlacementParams
  ): Promise<ClientPlacementResult> {
    await delay();
    // Close previous current placement
    this.placements = this.placements.map((p) =>
      p.client_id === clientId && p.is_current
        ? { ...p, is_current: false, end_date: params.start_date, updated_at: now() }
        : p
    );

    const ouId = params.organization_unit_id ?? null;
    const id = uuid();
    const placement: ClientPlacementHistory = {
      id,
      client_id: clientId,
      organization_id: MOCK_ORG_ID,
      placement_arrangement: params.placement_arrangement,
      start_date: params.start_date,
      end_date: null,
      is_current: true,
      reason: params.reason ?? null,
      created_at: now(),
      updated_at: null,
      last_event_id: null,
      organization_unit_id: ouId,
    };
    this.placements = [...this.placements, placement];

    // Denormalize to client (mirrors handle_client_placement_changed writing
    // both placement_arrangement and organization_unit_id to clients_projection)
    this.clients = this.clients.map((c) =>
      c.id === clientId
        ? {
            ...c,
            placement_arrangement: params.placement_arrangement,
            organization_unit_id: ouId,
            updated_at: now(),
          }
        : c
    );

    return { success: true, placement_id: id };
  }

  async endClientPlacement(
    clientId: string,
    endDate?: string,
    _reasonText?: string
  ): Promise<ClientPlacementResult> {
    await delay();
    this.placements = this.placements.map((p) =>
      p.client_id === clientId && p.is_current
        ? {
            ...p,
            is_current: false,
            end_date: endDate ?? new Date().toISOString().slice(0, 10),
            updated_at: now(),
          }
        : p
    );
    this.clients = this.clients.map((c) =>
      c.id === clientId ? { ...c, placement_arrangement: null, updated_at: now() } : c
    );
    return { success: true };
  }

  // -------------------------------------------------------------------------
  // Funding Source
  // -------------------------------------------------------------------------

  async addClientFundingSource(
    clientId: string,
    params: AddFundingSourceParams
  ): Promise<ClientFundingResult> {
    await delay();
    const id = uuid();
    const source: ClientFundingSource = {
      id,
      client_id: clientId,
      organization_id: MOCK_ORG_ID,
      source_type: params.source_type,
      source_name: params.source_name,
      reference_number: params.reference_number ?? null,
      start_date: params.start_date ?? null,
      end_date: params.end_date ?? null,
      custom_fields: params.custom_fields ?? {},
      is_active: true,
      created_at: now(),
      updated_at: null,
      last_event_id: null,
    };
    this.funding = [...this.funding, source];
    return { success: true, funding_source_id: id };
  }

  async updateClientFundingSource(
    _clientId: string,
    sourceId: string,
    params: UpdateFundingSourceParams
  ): Promise<ClientFundingResult> {
    await delay();
    this.funding = this.funding.map((f) =>
      f.id === sourceId
        ? {
            ...f,
            source_type: params.source_type ?? f.source_type,
            source_name: params.source_name ?? f.source_name,
            reference_number: params.reference_number ?? f.reference_number,
            start_date: params.start_date ?? f.start_date,
            end_date: params.end_date ?? f.end_date,
            custom_fields: params.custom_fields ?? f.custom_fields,
            updated_at: now(),
          }
        : f
    );
    return { success: true, funding_source_id: sourceId };
  }

  async removeClientFundingSource(
    _clientId: string,
    sourceId: string,
    _reason?: string
  ): Promise<ClientVoidResult> {
    await delay();
    this.funding = this.funding.map((f) =>
      f.id === sourceId ? { ...f, is_active: false, updated_at: now() } : f
    );
    return { success: true };
  }

  // -------------------------------------------------------------------------
  // Contact Assignment
  // -------------------------------------------------------------------------

  async assignClientContact(
    clientId: string,
    contactId: string,
    designation: string,
    _reason?: string
  ): Promise<ClientAssignmentResult> {
    await delay();
    const id = uuid();
    const ts = now();
    const assignment: ClientContactAssignment = {
      id,
      client_id: clientId,
      contact_id: contactId,
      organization_id: MOCK_ORG_ID,
      designation: designation as ClientContactAssignment['designation'],
      assigned_at: ts,
      is_active: true,
      created_at: ts,
      updated_at: null,
      last_event_id: null,
      contact_name: null,
      contact_email: null,
    };
    this.assignments = [...this.assignments, assignment];
    return { success: true, assignment_id: id };
  }

  async unassignClientContact(
    clientId: string,
    contactId: string,
    designation: string,
    _reason?: string
  ): Promise<ClientAssignmentResult> {
    await delay();
    this.assignments = this.assignments.map((a) =>
      a.client_id === clientId && a.contact_id === contactId && a.designation === designation
        ? { ...a, is_active: false }
        : a
    );
    return { success: true };
  }
}
