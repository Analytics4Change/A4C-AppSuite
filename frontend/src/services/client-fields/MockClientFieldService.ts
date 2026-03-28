/**
 * Mock Client Field Service
 *
 * In-memory implementation for local development and testing.
 * Seeded with the same 11 categories and 66 field definitions
 * that the bootstrap workflow creates for real organizations.
 */

import { Logger } from '@/utils/logger';
import type {
  FieldDefinition,
  FieldCategory,
  FieldDefinitionChange,
  BatchUpdateResult,
  CreateFieldDefinitionParams,
  RpcResult,
} from '@/types/client-field-settings.types';
import type { IClientFieldService } from './IClientFieldService';

const log = Logger.getLogger('api');

// System categories matching the 11 seeded categories
const SYSTEM_CATEGORIES: FieldCategory[] = [
  {
    id: 'cat-01',
    organization_id: null,
    name: 'Demographics',
    slug: 'demographics',
    sort_order: 1,
    is_system: true,
    is_active: true,
  },
  {
    id: 'cat-02',
    organization_id: null,
    name: 'Contact Info',
    slug: 'contact_info',
    sort_order: 2,
    is_system: true,
    is_active: true,
  },
  {
    id: 'cat-03',
    organization_id: null,
    name: 'Guardian',
    slug: 'guardian',
    sort_order: 3,
    is_system: true,
    is_active: true,
  },
  {
    id: 'cat-04',
    organization_id: null,
    name: 'Referral',
    slug: 'referral',
    sort_order: 4,
    is_system: true,
    is_active: true,
  },
  {
    id: 'cat-05',
    organization_id: null,
    name: 'Admission',
    slug: 'admission',
    sort_order: 5,
    is_system: true,
    is_active: true,
  },
  {
    id: 'cat-06',
    organization_id: null,
    name: 'Insurance',
    slug: 'insurance',
    sort_order: 6,
    is_system: true,
    is_active: true,
  },
  {
    id: 'cat-07',
    organization_id: null,
    name: 'Clinical',
    slug: 'clinical',
    sort_order: 7,
    is_system: true,
    is_active: true,
  },
  {
    id: 'cat-08',
    organization_id: null,
    name: 'Medical',
    slug: 'medical',
    sort_order: 8,
    is_system: true,
    is_active: true,
  },
  {
    id: 'cat-09',
    organization_id: null,
    name: 'Legal',
    slug: 'legal',
    sort_order: 9,
    is_system: true,
    is_active: true,
  },
  {
    id: 'cat-10',
    organization_id: null,
    name: 'Discharge',
    slug: 'discharge',
    sort_order: 10,
    is_system: true,
    is_active: true,
  },
  {
    id: 'cat-11',
    organization_id: null,
    name: 'Education',
    slug: 'education',
    sort_order: 11,
    is_system: true,
    is_active: true,
  },
];

function makeField(
  id: string,
  categoryId: string,
  categoryName: string,
  categorySlug: string,
  fieldKey: string,
  displayName: string,
  fieldType: FieldDefinition['field_type'],
  isRequired: boolean,
  isDimension: boolean,
  sortOrder: number
): FieldDefinition {
  return {
    id,
    category_id: categoryId,
    category_name: categoryName,
    category_slug: categorySlug,
    field_key: fieldKey,
    display_name: displayName,
    field_type: fieldType,
    is_visible: true,
    is_required: isRequired,
    validation_rules: null,
    is_dimension: isDimension,
    sort_order: sortOrder,
    configurable_label: null,
    conforming_dimension_mapping: null,
    is_active: true,
  };
}

function buildSeedFields(): FieldDefinition[] {
  const f = makeField;
  let n = 0;
  const id = () => `field-${String(++n).padStart(2, '0')}`;

  return [
    // Demographics (19)
    f(
      id(),
      'cat-01',
      'Demographics',
      'demographics',
      'first_name',
      'First Name',
      'text',
      true,
      false,
      1
    ),
    f(
      id(),
      'cat-01',
      'Demographics',
      'demographics',
      'last_name',
      'Last Name',
      'text',
      true,
      false,
      2
    ),
    f(
      id(),
      'cat-01',
      'Demographics',
      'demographics',
      'middle_name',
      'Middle Name',
      'text',
      false,
      false,
      3
    ),
    f(
      id(),
      'cat-01',
      'Demographics',
      'demographics',
      'preferred_name',
      'Preferred Name',
      'text',
      false,
      false,
      4
    ),
    f(
      id(),
      'cat-01',
      'Demographics',
      'demographics',
      'date_of_birth',
      'Date of Birth',
      'date',
      true,
      true,
      5
    ),
    f(
      id(),
      'cat-01',
      'Demographics',
      'demographics',
      'gender',
      'Gender Assigned at Birth',
      'enum',
      true,
      true,
      6
    ),
    f(
      id(),
      'cat-01',
      'Demographics',
      'demographics',
      'gender_identity',
      'Gender Identity',
      'text',
      false,
      false,
      7
    ),
    f(
      id(),
      'cat-01',
      'Demographics',
      'demographics',
      'pronouns',
      'Pronouns',
      'text',
      false,
      false,
      8
    ),
    f(id(), 'cat-01', 'Demographics', 'demographics', 'race', 'Race', 'multi_enum', false, true, 9),
    f(
      id(),
      'cat-01',
      'Demographics',
      'demographics',
      'ethnicity',
      'Ethnicity',
      'enum',
      false,
      true,
      10
    ),
    f(
      id(),
      'cat-01',
      'Demographics',
      'demographics',
      'primary_language',
      'Primary Language',
      'text',
      false,
      true,
      11
    ),
    f(
      id(),
      'cat-01',
      'Demographics',
      'demographics',
      'secondary_language',
      'Secondary Language',
      'text',
      false,
      false,
      12
    ),
    f(
      id(),
      'cat-01',
      'Demographics',
      'demographics',
      'interpreter_needed',
      'Interpreter Needed',
      'boolean',
      false,
      false,
      13
    ),
    f(
      id(),
      'cat-01',
      'Demographics',
      'demographics',
      'marital_status',
      'Marital Status',
      'enum',
      false,
      false,
      14
    ),
    f(
      id(),
      'cat-01',
      'Demographics',
      'demographics',
      'citizenship_status',
      'Citizenship Status',
      'enum',
      false,
      false,
      15
    ),
    f(
      id(),
      'cat-01',
      'Demographics',
      'demographics',
      'photo_url',
      'Photo',
      'text',
      false,
      false,
      16
    ),
    f(
      id(),
      'cat-01',
      'Demographics',
      'demographics',
      'mrn',
      'Medical Record Number',
      'text',
      false,
      false,
      17
    ),
    f(
      id(),
      'cat-01',
      'Demographics',
      'demographics',
      'external_id',
      'External ID',
      'text',
      false,
      false,
      18
    ),
    f(
      id(),
      'cat-01',
      'Demographics',
      'demographics',
      'drivers_license',
      "Driver's License",
      'text',
      false,
      false,
      19
    ),
    // Contact Info (3)
    f(
      id(),
      'cat-02',
      'Contact Info',
      'contact_info',
      'client_phones',
      'Phone Numbers',
      'text',
      false,
      false,
      1
    ),
    f(
      id(),
      'cat-02',
      'Contact Info',
      'contact_info',
      'client_emails',
      'Email Addresses',
      'text',
      false,
      false,
      2
    ),
    f(
      id(),
      'cat-02',
      'Contact Info',
      'contact_info',
      'client_addresses',
      'Addresses',
      'text',
      false,
      false,
      3
    ),
    // Guardian (3)
    f(
      id(),
      'cat-03',
      'Guardian',
      'guardian',
      'legal_custody_status',
      'Legal Custody Status',
      'enum',
      false,
      false,
      1
    ),
    f(
      id(),
      'cat-03',
      'Guardian',
      'guardian',
      'court_ordered_placement',
      'Court-Ordered Placement',
      'boolean',
      false,
      false,
      2
    ),
    f(
      id(),
      'cat-03',
      'Guardian',
      'guardian',
      'financial_guarantor_type',
      'Financial Guarantor Type',
      'enum',
      false,
      false,
      3
    ),
    // Referral (4)
    f(
      id(),
      'cat-04',
      'Referral',
      'referral',
      'referral_source_type',
      'Referral Source Type',
      'enum',
      false,
      false,
      1
    ),
    f(
      id(),
      'cat-04',
      'Referral',
      'referral',
      'referral_organization',
      'Referral Organization',
      'text',
      false,
      false,
      2
    ),
    f(
      id(),
      'cat-04',
      'Referral',
      'referral',
      'referral_date',
      'Referral Date',
      'date',
      false,
      false,
      3
    ),
    f(
      id(),
      'cat-04',
      'Referral',
      'referral',
      'reason_for_referral',
      'Reason for Referral',
      'text',
      false,
      false,
      4
    ),
    // Admission (7)
    f(
      id(),
      'cat-05',
      'Admission',
      'admission',
      'admission_date',
      'Admission Date',
      'date',
      true,
      true,
      1
    ),
    f(
      id(),
      'cat-05',
      'Admission',
      'admission',
      'admission_type',
      'Admission Type',
      'enum',
      false,
      false,
      2
    ),
    f(
      id(),
      'cat-05',
      'Admission',
      'admission',
      'level_of_care',
      'Level of Care',
      'text',
      false,
      false,
      3
    ),
    f(
      id(),
      'cat-05',
      'Admission',
      'admission',
      'expected_length_of_stay',
      'Expected Length of Stay',
      'number',
      false,
      false,
      4
    ),
    f(
      id(),
      'cat-05',
      'Admission',
      'admission',
      'initial_risk_level',
      'Initial Risk Level',
      'enum',
      false,
      true,
      5
    ),
    f(
      id(),
      'cat-05',
      'Admission',
      'admission',
      'discharge_plan_status',
      'Discharge Plan Status',
      'enum',
      false,
      false,
      6
    ),
    f(
      id(),
      'cat-05',
      'Admission',
      'admission',
      'placement_arrangement',
      'Placement Arrangement',
      'enum',
      false,
      true,
      7
    ),
    // Insurance (2)
    f(
      id(),
      'cat-06',
      'Insurance',
      'insurance',
      'medicaid_id',
      'Medicaid ID',
      'text',
      false,
      false,
      1
    ),
    f(
      id(),
      'cat-06',
      'Insurance',
      'insurance',
      'medicare_id',
      'Medicare ID',
      'text',
      false,
      false,
      2
    ),
    // Clinical (10)
    f(
      id(),
      'cat-07',
      'Clinical',
      'clinical',
      'primary_diagnosis',
      'Primary Diagnosis',
      'jsonb',
      false,
      false,
      1
    ),
    f(
      id(),
      'cat-07',
      'Clinical',
      'clinical',
      'secondary_diagnoses',
      'Secondary Diagnoses',
      'jsonb',
      false,
      false,
      2
    ),
    f(
      id(),
      'cat-07',
      'Clinical',
      'clinical',
      'dsm5_diagnoses',
      'DSM-5 Diagnoses',
      'jsonb',
      false,
      false,
      3
    ),
    f(
      id(),
      'cat-07',
      'Clinical',
      'clinical',
      'presenting_problem',
      'Presenting Problem',
      'text',
      false,
      false,
      4
    ),
    f(
      id(),
      'cat-07',
      'Clinical',
      'clinical',
      'suicide_risk_status',
      'Suicide Risk Status',
      'enum',
      false,
      false,
      5
    ),
    f(
      id(),
      'cat-07',
      'Clinical',
      'clinical',
      'violence_risk_status',
      'Violence Risk Status',
      'enum',
      false,
      false,
      6
    ),
    f(
      id(),
      'cat-07',
      'Clinical',
      'clinical',
      'trauma_history_indicator',
      'Trauma History',
      'boolean',
      false,
      false,
      7
    ),
    f(
      id(),
      'cat-07',
      'Clinical',
      'clinical',
      'substance_use_history',
      'Substance Use History',
      'text',
      false,
      false,
      8
    ),
    f(
      id(),
      'cat-07',
      'Clinical',
      'clinical',
      'developmental_history',
      'Developmental History',
      'text',
      false,
      false,
      9
    ),
    f(
      id(),
      'cat-07',
      'Clinical',
      'clinical',
      'previous_treatment_history',
      'Previous Treatment History',
      'text',
      false,
      false,
      10
    ),
    // Medical (5)
    f(id(), 'cat-08', 'Medical', 'medical', 'allergies', 'Allergies', 'jsonb', true, false, 1),
    f(
      id(),
      'cat-08',
      'Medical',
      'medical',
      'medical_conditions',
      'Medical Conditions',
      'jsonb',
      true,
      false,
      2
    ),
    f(
      id(),
      'cat-08',
      'Medical',
      'medical',
      'immunization_status',
      'Immunization Status',
      'text',
      false,
      false,
      3
    ),
    f(
      id(),
      'cat-08',
      'Medical',
      'medical',
      'dietary_restrictions',
      'Dietary Restrictions',
      'text',
      false,
      false,
      4
    ),
    f(
      id(),
      'cat-08',
      'Medical',
      'medical',
      'special_medical_needs',
      'Special Medical Needs',
      'text',
      false,
      false,
      5
    ),
    // Legal (6)
    f(
      id(),
      'cat-09',
      'Legal',
      'legal',
      'court_case_number',
      'Court Case Number',
      'text',
      false,
      false,
      1
    ),
    f(id(), 'cat-09', 'Legal', 'legal', 'state_agency', 'State Agency', 'text', false, false, 2),
    f(id(), 'cat-09', 'Legal', 'legal', 'legal_status', 'Legal Status', 'enum', false, false, 3),
    f(
      id(),
      'cat-09',
      'Legal',
      'legal',
      'mandated_reporting_status',
      'Mandated Reporting Status',
      'boolean',
      false,
      false,
      4
    ),
    f(
      id(),
      'cat-09',
      'Legal',
      'legal',
      'protective_services_involvement',
      'Protective Services Involvement',
      'boolean',
      false,
      false,
      5
    ),
    f(
      id(),
      'cat-09',
      'Legal',
      'legal',
      'safety_plan_required',
      'Safety Plan Required',
      'boolean',
      false,
      false,
      6
    ),
    // Discharge (5)
    f(
      id(),
      'cat-10',
      'Discharge',
      'discharge',
      'discharge_date',
      'Discharge Date',
      'date',
      false,
      false,
      1
    ),
    f(
      id(),
      'cat-10',
      'Discharge',
      'discharge',
      'discharge_outcome',
      'Discharge Outcome',
      'enum',
      false,
      true,
      2
    ),
    f(
      id(),
      'cat-10',
      'Discharge',
      'discharge',
      'discharge_reason',
      'Discharge Reason',
      'enum',
      false,
      true,
      3
    ),
    f(
      id(),
      'cat-10',
      'Discharge',
      'discharge',
      'discharge_diagnosis',
      'Discharge Diagnosis',
      'jsonb',
      false,
      false,
      4
    ),
    f(
      id(),
      'cat-10',
      'Discharge',
      'discharge',
      'discharge_placement',
      'Discharge Placement',
      'enum',
      false,
      true,
      5
    ),
    // Education (3)
    f(
      id(),
      'cat-11',
      'Education',
      'education',
      'education_status',
      'Education Status',
      'enum',
      false,
      false,
      1
    ),
    f(
      id(),
      'cat-11',
      'Education',
      'education',
      'grade_level',
      'Grade Level',
      'text',
      false,
      false,
      2
    ),
    f(
      id(),
      'cat-11',
      'Education',
      'education',
      'iep_status',
      'IEP Status',
      'boolean',
      false,
      false,
      3
    ),
  ];
}

export class MockClientFieldService implements IClientFieldService {
  private fields: FieldDefinition[] = buildSeedFields();
  private categories: FieldCategory[] = [...SYSTEM_CATEGORIES];
  private nextFieldNum = 100;
  private nextCatNum = 100;

  async listFieldDefinitions(includeInactive = false): Promise<FieldDefinition[]> {
    log.debug('[Mock] Fetching field definitions', { includeInactive });
    await this.simulateDelay();

    if (includeInactive) return this.fields.map((f) => ({ ...f }));
    return this.fields.filter((f) => f.is_active).map((f) => ({ ...f }));
  }

  async batchUpdateFieldDefinitions(
    changes: FieldDefinitionChange[],
    reason: string
  ): Promise<BatchUpdateResult> {
    log.debug('[Mock] Batch updating field definitions', { changeCount: changes.length, reason });
    await this.simulateDelay();

    let updatedCount = 0;
    const failed: Array<{ field_id: string; error: string }> = [];

    for (const change of changes) {
      const idx = this.fields.findIndex((f) => f.id === change.field_id && f.is_active);
      if (idx === -1) {
        failed.push({ field_id: change.field_id, error: 'Field not found or inactive' });
        continue;
      }
      const field = this.fields[idx];
      if (change.is_visible !== undefined) field.is_visible = change.is_visible;
      if (change.is_required !== undefined) field.is_required = change.is_required;
      if (change.configurable_label !== undefined)
        field.configurable_label = change.configurable_label;
      if (change.display_name !== undefined) field.display_name = change.display_name;
      if (change.sort_order !== undefined) field.sort_order = change.sort_order;
      updatedCount++;
    }

    log.info('[Mock] Batch update complete', { updatedCount, failedCount: failed.length });
    return {
      success: true,
      updated_count: updatedCount,
      failed,
      correlation_id: globalThis.crypto.randomUUID(),
    };
  }

  async createFieldDefinition(params: CreateFieldDefinitionParams): Promise<RpcResult> {
    log.debug('[Mock] Creating field definition', { params });
    await this.simulateDelay();

    const existing = this.fields.find((f) => f.field_key === params.field_key && f.is_active);
    if (existing) {
      return { success: false, error: 'Field key already exists for this organization' };
    }

    const category = this.categories.find((c) => c.id === params.category_id);
    if (!category) {
      return { success: false, error: 'Category not found or inactive' };
    }

    const fieldId = `field-custom-${++this.nextFieldNum}`;
    this.fields.push({
      id: fieldId,
      category_id: category.id,
      category_name: category.name,
      category_slug: category.slug,
      field_key: params.field_key,
      display_name: params.display_name,
      field_type: (params.field_type as FieldDefinition['field_type']) ?? 'text',
      is_visible: params.is_visible ?? true,
      is_required: params.is_required ?? false,
      validation_rules: params.validation_rules ?? null,
      is_dimension: params.is_dimension ?? false,
      sort_order: params.sort_order ?? 0,
      configurable_label: null,
      conforming_dimension_mapping: null,
      is_active: true,
    });

    return { success: true, field_id: fieldId };
  }

  async deactivateFieldDefinition(fieldId: string, reason: string): Promise<RpcResult> {
    log.debug('[Mock] Deactivating field definition', { fieldId, reason });
    await this.simulateDelay();

    const field = this.fields.find((f) => f.id === fieldId && f.is_active);
    if (!field) {
      return { success: false, error: 'Field definition not found or already inactive' };
    }

    field.is_active = false;
    return { success: true, field_id: fieldId };
  }

  async listFieldCategories(): Promise<FieldCategory[]> {
    log.debug('[Mock] Fetching field categories');
    await this.simulateDelay();

    return this.categories.filter((c) => c.is_active).map((c) => ({ ...c }));
  }

  async createFieldCategory(name: string, slug: string, sortOrder?: number): Promise<RpcResult> {
    log.debug('[Mock] Creating field category', { name, slug });
    await this.simulateDelay();

    const existing = this.categories.find((c) => c.slug === slug && c.is_active);
    if (existing) {
      return { success: false, error: 'Category slug already exists' };
    }

    const categoryId = `cat-custom-${++this.nextCatNum}`;
    this.categories.push({
      id: categoryId,
      organization_id: 'mock-org-id',
      name,
      slug,
      sort_order: sortOrder ?? this.categories.length + 1,
      is_system: false,
      is_active: true,
    });

    return { success: true, category_id: categoryId };
  }

  async deactivateFieldCategory(categoryId: string, reason: string): Promise<RpcResult> {
    log.debug('[Mock] Deactivating field category', { categoryId, reason });
    await this.simulateDelay();

    const category = this.categories.find(
      (c) => c.id === categoryId && c.is_active && !c.is_system
    );
    if (!category) {
      return {
        success: false,
        error: 'Category not found, is a system category, or already inactive',
      };
    }

    category.is_active = false;
    return { success: true, category_id: categoryId };
  }

  private simulateDelay(): Promise<void> {
    const delay = import.meta.env.MODE === 'test' ? 0 : 300;
    return new Promise((resolve) => setTimeout(resolve, delay));
  }
}
