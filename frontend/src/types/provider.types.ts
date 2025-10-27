/**
 * Provider Management Type Definitions
 * Defines the data structures for multi-tenant provider management
 */

/**
 * Provider status enum
 */
export type ProviderStatus = 'pending' | 'active' | 'suspended' | 'inactive';

/**
 * Provider type - data-driven from database
 */
export interface ProviderType {
  id: string;
  name: string;
  displayOrder: number;
  isActive: boolean;
}

/**
 * Subscription tier for providers
 */
export interface SubscriptionTier {
  id: string;
  name: string;
  features: Record<string, any>;
  price: number;
  isActive: boolean;
}

/**
 * Main Provider interface - represents a tenant organization
 */
export interface Provider {
  // Identity
  id: string; // Unique provider/organization identifier
  name: string;
  type: string; // References ProviderType
  status: ProviderStatus;

  // Primary Contact
  primaryContactName?: string;
  primaryContactEmail?: string;
  primaryContactPhone?: string;
  primaryAddress?: string;

  // Billing Information
  billingContactName?: string;
  billingContactEmail?: string;
  billingContactPhone?: string;
  billingAddress?: string;
  taxId?: string;

  // Subscription
  subscriptionTierId?: string;
  serviceStartDate?: Date;

  // Metadata
  metadata?: Record<string, any>;

  // Audit
  createdAt: Date;
  updatedAt: Date;
  createdBy?: string;
  updatedBy?: string;
}

/**
 * Sub-provider within a provider organization
 */
export interface SubProvider {
  id: string;
  providerId: string;
  parentId?: string; // For nested sub-providers
  name: string;
  level: number; // 1, 2, or 3 (max depth)
  metadata?: Record<string, any>;
  createdAt: Date;
}

/**
 * Provider creation request
 */
export interface CreateProviderRequest {
  name: string;
  type: string;
  primaryContactName: string;
  primaryContactEmail: string;
  primaryContactPhone?: string;
  primaryAddress?: string;
  billingContactName?: string;
  billingContactEmail?: string;
  billingContactPhone?: string;
  billingAddress?: string;
  taxId?: string;
  subscriptionTierId?: string;
  serviceStartDate?: Date;
  adminEmail: string; // Email for the initial administrator invitation
  metadata?: Record<string, any>;
}

/**
 * Provider update request
 */
export interface UpdateProviderRequest {
  name?: string;
  type?: string;
  status?: ProviderStatus;
  primaryContactName?: string;
  primaryContactEmail?: string;
  primaryContactPhone?: string;
  primaryAddress?: string;
  billingContactName?: string;
  billingContactEmail?: string;
  billingContactPhone?: string;
  billingAddress?: string;
  taxId?: string;
  subscriptionTierId?: string;
  metadata?: Record<string, any>;
}

/**
 * Provider list filter options
 */
export interface ProviderFilterOptions {
  status?: ProviderStatus;
  type?: string;
  searchTerm?: string;
  subscriptionTierId?: string;
  createdAfter?: Date;
  createdBefore?: Date;
}

/**
 * Audit log entry for tracking changes
 */
export interface AuditLogEntry {
  id: string;
  tableName: string;
  recordId: string;
  action: 'INSERT' | 'UPDATE' | 'DELETE';
  oldValues?: Record<string, any>;
  newValues?: Record<string, any>;
  userId: string;
  organizationId: string;
  timestamp: Date;
}

/**
 * Provider context for the current user session
 */
export interface ProviderContext {
  currentProvider?: Provider;
  currentSubProvider?: SubProvider;
  availableProviders: Provider[];
  availableSubProviders: SubProvider[];
}

/**
 * Provider statistics for dashboard
 */
export interface ProviderStatistics {
  totalClients: number;
  activeClients: number;
  totalStaff: number;
  totalSubProviders: number;
  lastActivityDate?: Date;
}