import { Logger } from '@/utils/logger';
import { CreateProviderRequest } from '@/types/provider.types';

const log = Logger.getLogger('api');

/**
 * Zitadel Provider Service
 * Manages Zitadel organizations for multi-tenant providers
 *
 * Note: This service will need proper service account authentication
 * for production use. Currently implements the interface for future integration.
 */
class ZitadelProviderService {
  private managementApiUrl: string;
  private adminApiUrl: string;

  constructor() {
    const baseUrl = import.meta.env.VITE_ZITADEL_INSTANCE_URL || '';
    this.managementApiUrl = `${baseUrl}/management/v1`;
    this.adminApiUrl = `${baseUrl}/admin/v1`;
  }

  /**
   * Get service account access token
   * TODO: Implement proper JWT assertion flow with service account key
   */
  private async getServiceAccountToken(): Promise<string> {
    // In production, this would:
    // 1. Load service account key from secure storage
    // 2. Create JWT assertion
    // 3. Exchange for access token
    // 4. Cache token until expiry

    log.warn('Service account authentication not yet implemented');

    // For development, you might use a personal access token
    const token = import.meta.env.VITE_ZITADEL_SERVICE_TOKEN || '';
    if (!token) {
      throw new Error('Zitadel service token not configured');
    }

    return token;
  }

  /**
   * Create a new organization in Zitadel for a provider
   */
  async createOrganization(request: CreateProviderRequest): Promise<string> {
    try {
      log.info('Creating Zitadel organization', { name: request.name });

      const token = await this.getServiceAccountToken();

      // Use the Admin API to set up organization with initial user
      const response = await fetch(`${this.adminApiUrl}/orgs/_setup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          org: {
            name: request.name,
            // Use primary contact email domain if available
            domain: this.extractDomain(request.primaryContactEmail)
          },
          human: {
            userName: this.generateUsername(request.adminEmail),
            profile: {
              firstName: request.primaryContactName.split(' ')[0] || 'Admin',
              lastName: request.primaryContactName.split(' ').slice(1).join(' ') || 'User',
              displayName: request.primaryContactName,
              preferredLanguage: 'en'
            },
            email: {
              email: request.adminEmail,
              isEmailVerified: false // Will send verification email
            },
            // Let Zitadel generate a temporary password and send it via email
            password: this.generateTemporaryPassword()
          },
          // Assign ORG_OWNER role by default
          roles: ['ORG_OWNER']
        })
      });

      if (!response.ok) {
        const error = await response.json();
        log.error('Failed to create Zitadel organization', error);
        throw new Error(error.message || 'Failed to create organization');
      }

      const data = await response.json();
      const orgId = data.orgId || data.id;

      log.info('Zitadel organization created successfully', { orgId });

      // Send invitation email to administrator
      await this.sendAdminInvitation(orgId, request.adminEmail);

      return orgId;
    } catch (error) {
      log.error('Error creating Zitadel organization', error);
      throw error;
    }
  }

  /**
   * Update organization details
   */
  async updateOrganization(orgId: string, name: string): Promise<void> {
    try {
      log.info('Updating Zitadel organization', { orgId, name });

      const token = await this.getServiceAccountToken();

      const response = await fetch(`${this.managementApiUrl}/orgs/${orgId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ name })
      });

      if (!response.ok) {
        const error = await response.json();
        log.error('Failed to update Zitadel organization', error);
        throw new Error(error.message || 'Failed to update organization');
      }

      log.info('Zitadel organization updated successfully', { orgId });
    } catch (error) {
      log.error('Error updating Zitadel organization', error);
      throw error;
    }
  }

  /**
   * Get organization details
   */
  async getOrganization(orgId: string): Promise<any> {
    try {
      log.info('Fetching Zitadel organization', { orgId });

      const token = await this.getServiceAccountToken();

      const response = await fetch(`${this.managementApiUrl}/orgs/${orgId}`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        const error = await response.json();
        log.error('Failed to fetch Zitadel organization', error);
        throw new Error(error.message || 'Failed to fetch organization');
      }

      const data = await response.json();
      log.info('Zitadel organization fetched successfully', { orgId });

      return data;
    } catch (error) {
      log.error('Error fetching Zitadel organization', error);
      throw error;
    }
  }

  /**
   * Deactivate organization (soft delete)
   */
  async deactivateOrganization(orgId: string): Promise<void> {
    try {
      log.info('Deactivating Zitadel organization', { orgId });

      await this.getServiceAccountToken();

      // Zitadel doesn't have a direct deactivate, but we can remove all users
      // or set metadata to indicate inactive status
      // For now, we'll just log this action

      log.warn('Zitadel organization deactivation not fully implemented', { orgId });

      // In production, you might:
      // 1. Remove all users except a placeholder
      // 2. Revoke all active sessions
      // 3. Set organization metadata to indicate inactive
    } catch (error) {
      log.error('Error deactivating Zitadel organization', error);
      throw error;
    }
  }

  /**
   * Create a project grant for cross-organization access
   * This allows A4C Partners to access provider organizations
   */
  async createProjectGrant(
    providerOrgId: string,
    partnerOrgId: string,
    roleKeys: string[] = ['viewer']
  ): Promise<void> {
    try {
      log.info('Creating project grant', { providerOrgId, partnerOrgId, roleKeys });

      const token = await this.getServiceAccountToken();

      // First, we need a project in the provider org
      // For simplicity, we'll assume a default project exists
      // In production, you'd create or fetch the appropriate project

      const response = await fetch(`${this.managementApiUrl}/projects/grants`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Bearer ${token}`,
          'x-zitadel-orgid': providerOrgId // Set context to provider org
        },
        body: JSON.stringify({
          grantedOrgId: partnerOrgId,
          roleKeys: roleKeys
        })
      });

      if (!response.ok) {
        const error = await response.json();
        log.error('Failed to create project grant', error);
        throw new Error(error.message || 'Failed to create project grant');
      }

      log.info('Project grant created successfully');
    } catch (error) {
      log.error('Error creating project grant', error);
      throw error;
    }
  }

  /**
   * Send invitation email to provider administrator
   * In production, this would trigger Zitadel's email system
   */
  private async sendAdminInvitation(orgId: string, email: string): Promise<void> {
    log.info('Sending admin invitation', { orgId, email });

    // Zitadel automatically sends verification email when creating user
    // with isEmailVerified: false
    // Additional custom invitation logic could go here
  }

  /**
   * Extract domain from email for organization setup
   */
  private extractDomain(email: string): string {
    const domain = email.split('@')[1];
    return domain || 'example.com';
  }

  /**
   * Generate username from email
   */
  private generateUsername(email: string): string {
    return email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  /**
   * Generate a secure temporary password
   * Zitadel will force the user to change this on first login
   */
  private generateTemporaryPassword(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
    let password = '';

    for (let i = 0; i < 16; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    // Ensure password meets Zitadel's requirements
    // Must contain uppercase, lowercase, number, and special character
    if (!/[A-Z]/.test(password)) password += 'A';
    if (!/[a-z]/.test(password)) password += 'a';
    if (!/[0-9]/.test(password)) password += '1';
    if (!/[!@#$%^&*]/.test(password)) password += '!';

    return password;
  }

  /**
   * Set up A4C-Demo organization for development/testing
   */
  async setupDemoOrganization(): Promise<string> {
    try {
      log.info('Setting up A4C-Demo organization');

      const demoRequest: CreateProviderRequest = {
        name: 'A4C-Demo',
        type: 'demo',
        primaryContactName: 'Demo Administrator',
        primaryContactEmail: 'demo@a4c-demo.example',
        adminEmail: 'admin@a4c-demo.example',
        metadata: {
          isDemo: true,
          createdFor: 'development'
        }
      };

      const orgId = await this.createOrganization(demoRequest);

      log.info('A4C-Demo organization created', { orgId });
      return orgId;
    } catch (error) {
      log.error('Error setting up demo organization', error);
      throw error;
    }
  }
}

export const zitadelProviderService = new ZitadelProviderService();