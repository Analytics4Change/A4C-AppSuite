/**
 * Medication Template Types
 * Templates are reusable medication configurations created from existing medications
 * They exclude PII and specific prescription details
 */

import { DosageForm, DosageRoute, DosageUnit, DosageFrequency } from './models/Dosage';
import { MedicationCategory, MedicationFlags } from './models/Medication';

/**
 * Medication template for reusable medication configurations
 * Created from existing client medications but with PII removed
 */
export interface MedicationTemplate {
  id: string;
  organizationId: string;  // Templates are org-specific
  name: string;            // Template name (e.g., "Lorazepam 1mg Daily")

  // Preserved medication information
  medicationName: string;
  genericName?: string;
  brandName?: string;
  categories: MedicationCategory;
  flags: MedicationFlags;

  // Preserved dosage configuration
  form: DosageForm;
  route?: DosageRoute;
  strength?: string;       // e.g., "1mg", "10mg/5ml"
  frequency: DosageFrequency | DosageFrequency[];
  timings?: string[];      // Preserved timing patterns
  foodConditions?: string[];
  specialRestrictions?: string[];

  // Explicitly excluded fields (always null in templates)
  pharmacyInfo: null;
  dosageAmount: null;      // Actual amount to dispense
  startDate: null;
  discontinueDate: null;
  prescriber: null;
  clientId: null;          // Never store source client

  // Template metadata
  sourceClientInitials?: string;  // Optional reference (e.g., "J.D.")
  createdBy: string;       // User ID who created template
  createdAt: Date;
  updatedAt: Date;
  usageCount: number;      // Track popularity
  lastUsedAt?: Date;
  tags?: string[];         // Optional categorization
  notes?: string;          // Template-specific notes
  isActive: boolean;       // Can be deactivated without deletion
}

/**
 * Request to create a medication template
 */
export interface CreateTemplateRequest {
  medicationId: string;    // Source medication to copy from
  templateName: string;    // Name for the template
  includeClientInitials?: boolean;  // Whether to store initials
  tags?: string[];
  notes?: string;
}

/**
 * Template search/filter options
 */
export interface TemplateFilterOptions {
  searchTerm?: string;     // Search by name or medication
  categories?: string[];   // Filter by categories
  tags?: string[];        // Filter by tags
  isActive?: boolean;     // Active/inactive filter
  sortBy?: 'name' | 'usageCount' | 'lastUsed' | 'created';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

/**
 * Template usage statistics
 */
export interface TemplateStats {
  totalTemplates: number;
  activeTemplates: number;
  mostUsedTemplates: Array<{
    templateId: string;
    name: string;
    usageCount: number;
  }>;
  recentlyUsedTemplates: Array<{
    templateId: string;
    name: string;
    lastUsedAt: Date;
  }>;
  categoryCounts: Record<string, number>;
}

/**
 * Result of applying a template to create a new medication
 */
export interface ApplyTemplateResult {
  // Pre-filled from template
  medicationName: string;
  genericName?: string;
  brandName?: string;
  categories: MedicationCategory;
  flags: MedicationFlags;
  form: DosageForm;
  route?: DosageRoute;
  strength?: string;
  frequency: DosageFrequency | DosageFrequency[];
  timings?: string[];
  foodConditions?: string[];
  specialRestrictions?: string[];

  // Fields that need to be filled by user
  requiredFields: Array<{
    field: string;
    label: string;
    type: 'text' | 'number' | 'date' | 'select';
    required: boolean;
  }>;
}