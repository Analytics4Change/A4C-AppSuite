import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Building2, Mail, Phone, User } from 'lucide-react';
import type { Organization } from '@/types/organization.types';

interface OrganizationCardProps {
  organization: Organization;
}

const ORG_TYPE_LABELS: Record<Organization['type'], string> = {
  platform_owner: 'Platform',
  provider: 'Provider',
  provider_partner: 'Partner',
};

export const OrganizationCard: React.FC<OrganizationCardProps> = ({ organization }) => {
  const navigate = useNavigate();

  const handleCardClick = () => {
    navigate(`/organizations/manage?orgId=${organization.id}`);
  };

  const orgTypeLabel = ORG_TYPE_LABELS[organization.type] ?? organization.type;

  return (
    <Card
      data-testid={`org-card-${organization.id}`}
      className="glass-card hover:glass-card-hover transition-all duration-300 cursor-pointer group"
      onClick={handleCardClick}
      style={{
        background: 'rgba(255, 255, 255, 0.7)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: '1px solid',
        borderImage:
          'linear-gradient(135deg, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0.2) 50%, rgba(255,255,255,0.5) 100%) 1',
        boxShadow: `
          0 0 0 1px rgba(255, 255, 255, 0.18) inset,
          0 2px 4px rgba(0, 0, 0, 0.04),
          0 4px 8px rgba(0, 0, 0, 0.04),
          0 8px 16px rgba(0, 0, 0, 0.04)
        `.trim(),
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = `
          0 0 0 1px rgba(255, 255, 255, 0.25) inset,
          0 0 20px rgba(59, 130, 246, 0.15) inset,
          0 2px 4px rgba(0, 0, 0, 0.05),
          0 4px 8px rgba(0, 0, 0, 0.05),
          0 12px 24px rgba(0, 0, 0, 0.08),
          0 24px 48px rgba(59, 130, 246, 0.1)
        `.trim();
        e.currentTarget.style.borderImage =
          'linear-gradient(135deg, rgba(255,255,255,0.7) 0%, rgba(59,130,246,0.3) 50%, rgba(255,255,255,0.7) 100%) 1';
        e.currentTarget.style.transform = 'translateY(-2px)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = `
          0 0 0 1px rgba(255, 255, 255, 0.18) inset,
          0 2px 4px rgba(0, 0, 0, 0.04),
          0 4px 8px rgba(0, 0, 0, 0.04),
          0 8px 16px rgba(0, 0, 0, 0.04)
        `.trim();
        e.currentTarget.style.borderImage =
          'linear-gradient(135deg, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0.2) 50%, rgba(255,255,255,0.5) 100%) 1';
        e.currentTarget.style.transform = 'translateY(0)';
      }}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div
              className="p-2 rounded-full transition-all duration-300 group-hover:scale-110"
              style={{
                background: organization.is_active
                  ? 'linear-gradient(135deg, rgba(59, 130, 246, 0.15) 0%, rgba(59, 130, 246, 0.25) 100%)'
                  : 'linear-gradient(135deg, rgba(156, 163, 175, 0.15) 0%, rgba(156, 163, 175, 0.25) 100%)',
                backdropFilter: 'blur(10px)',
                WebkitBackdropFilter: 'blur(10px)',
                border: organization.is_active
                  ? '1px solid rgba(59, 130, 246, 0.2)'
                  : '1px solid rgba(156, 163, 175, 0.2)',
                boxShadow: organization.is_active
                  ? '0 0 15px rgba(59, 130, 246, 0.15) inset'
                  : '0 0 15px rgba(156, 163, 175, 0.15) inset',
              }}
            >
              <Building2
                className={`w-5 h-5 ${organization.is_active ? 'text-blue-600' : 'text-gray-400'}`}
              />
            </div>
            <div>
              <CardTitle className="text-lg" data-testid="org-card-name">
                {organization.display_name || organization.name}
              </CardTitle>
              <div className="flex items-center gap-2 mt-0.5">
                <span
                  data-testid="org-card-status-badge"
                  className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                    organization.is_active
                      ? 'bg-green-100 text-green-800'
                      : 'bg-gray-100 text-gray-600'
                  }`}
                >
                  {organization.is_active ? 'Active' : 'Inactive'}
                </span>
                <span
                  data-testid="org-card-type-badge"
                  className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700"
                >
                  {orgTypeLabel}
                </span>
              </div>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div
          className="pt-3 space-y-2 text-sm"
          style={{
            borderTop: '1px solid',
            borderImage:
              'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.5) 50%, transparent 100%) 1',
          }}
        >
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">
            Provider Admin
          </div>
          {organization.provider_admin_name ? (
            <>
              <div
                className="flex items-center gap-2 text-gray-700"
                data-testid="org-card-admin-name"
              >
                <User size={14} className="text-gray-400 flex-shrink-0" />
                <span className="truncate">{organization.provider_admin_name}</span>
              </div>
              <div
                className="flex items-center gap-2 text-gray-600"
                data-testid="org-card-admin-email"
              >
                <Mail size={14} className="text-gray-400 flex-shrink-0" />
                <span className="truncate">
                  {organization.provider_admin_email ?? 'Not provided'}
                </span>
              </div>
              <div
                className="flex items-center gap-2 text-gray-600"
                data-testid="org-card-admin-phone"
              >
                <Phone size={14} className="text-gray-400 flex-shrink-0" />
                <span className="truncate">
                  {organization.provider_admin_phone ?? 'Not provided'}
                </span>
              </div>
            </>
          ) : (
            <div
              className="flex items-center gap-2 text-gray-400 italic"
              data-testid="org-card-no-admin"
            >
              <User size={14} className="flex-shrink-0" />
              <span>No admin assigned</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
