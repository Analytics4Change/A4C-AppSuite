import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { observer } from 'mobx-react-lite';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ArrowLeft, Save, Building } from 'lucide-react';
import { ProviderFormViewModel } from '@/viewModels/providers/ProviderFormViewModel';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('component');

export const ProviderCreatePage: React.FC = observer(() => {
  const navigate = useNavigate();
  const [viewModel] = useState(() => new ProviderFormViewModel());

  useEffect(() => {
    log.debug('ProviderCreatePage mounting');
    viewModel.initializeForCreate();
    return () => {
      viewModel.dispose();
    };
  }, [viewModel]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const providerId = await viewModel.save();
    if (providerId) {
      navigate(`/providers/${providerId}/view`);
    }
  };

  const renderField = (
    id: string,
    label: string,
    field: keyof ProviderFormViewModel,
    type: string = 'text',
    required: boolean = false
  ) => (
    <div>
      <Label htmlFor={id}>
        {label} {required && <span className="text-red-500">*</span>}
      </Label>
      <Input
        id={id}
        type={type}
        value={viewModel[field] as string}
        onChange={(e) => viewModel.setField(field, e.target.value as any)}
        className={viewModel.validationErrors[field as string] ? 'border-red-500' : ''}
        disabled={viewModel.isSaving}
      />
      {viewModel.validationErrors[field as string] && (
        <p className="text-red-500 text-sm mt-1">{viewModel.validationErrors[field as string]}</p>
      )}
    </div>
  );

  return (
    <div className="max-w-4xl mx-auto">
      {/* Page Header */}
      <div className="flex items-center gap-4 mb-6">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate('/providers')}
          className="hover:bg-white/50"
        >
          <ArrowLeft size={20} className="mr-2" />
          Back
        </Button>
        <div className="flex-1">
          <h1 className="text-3xl font-bold text-gray-900">Create New Provider</h1>
          <p className="text-gray-600 mt-1">Set up a new tenant organization</p>
        </div>
      </div>

      {/* Error Display */}
      {viewModel.error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          {viewModel.error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        {/* Basic Information Card */}
        <Card
          className="mb-6"
          style={{
            background: 'rgba(255, 255, 255, 0.8)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            border: '1px solid',
            borderImage: 'linear-gradient(135deg, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0.2) 50%, rgba(255,255,255,0.5) 100%) 1',
            boxShadow: `
              0 0 0 1px rgba(255, 255, 255, 0.18) inset,
              0 2px 4px rgba(0, 0, 0, 0.04),
              0 4px 8px rgba(0, 0, 0, 0.04),
              0 8px 16px rgba(0, 0, 0, 0.04)
            `.trim(),
          }}
        >
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building size={20} />
              Provider Information
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {renderField('name', 'Provider Name', 'name', 'text', true)}

            <div>
              <Label htmlFor="type">
                Provider Type <span className="text-red-500">*</span>
              </Label>
              <select
                id="type"
                value={viewModel.type}
                onChange={(e) => viewModel.setField('type', e.target.value)}
                className={`w-full px-3 py-2 border rounded-md ${
                  viewModel.validationErrors.type ? 'border-red-500' : 'border-gray-300'
                }`}
                disabled={viewModel.isSaving}
              >
                <option value="">Select a type...</option>
                {viewModel.providerTypes.map((type) => (
                  <option key={type.id} value={type.name}>
                    {type.name}
                  </option>
                ))}
                <option value="other">Other</option>
              </select>
              {viewModel.validationErrors.type && (
                <p className="text-red-500 text-sm mt-1">{viewModel.validationErrors.type}</p>
              )}
            </div>

            <div>
              <Label htmlFor="subscriptionTier">Subscription Tier</Label>
              <select
                id="subscriptionTier"
                value={viewModel.subscriptionTierId}
                onChange={(e) => viewModel.setField('subscriptionTierId', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
                disabled={viewModel.isSaving}
              >
                <option value="">Select a tier...</option>
                {viewModel.subscriptionTiers.map((tier) => (
                  <option key={tier.id} value={tier.id}>
                    {tier.name} - ${tier.price}/month
                  </option>
                ))}
              </select>
            </div>

            <div>
              <Label htmlFor="serviceStartDate">Service Start Date</Label>
              <Input
                id="serviceStartDate"
                type="date"
                value={viewModel.serviceStartDate ? viewModel.serviceStartDate.toISOString().split('T')[0] : ''}
                onChange={(e) => viewModel.setField('serviceStartDate', e.target.value ? new Date(e.target.value) : null)}
                disabled={viewModel.isSaving}
              />
            </div>
          </CardContent>
        </Card>

        {/* Primary Contact Card */}
        <Card
          className="mb-6"
          style={{
            background: 'rgba(255, 255, 255, 0.8)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            border: '1px solid',
            borderImage: 'linear-gradient(135deg, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0.2) 50%, rgba(255,255,255,0.5) 100%) 1',
            boxShadow: `
              0 0 0 1px rgba(255, 255, 255, 0.18) inset,
              0 2px 4px rgba(0, 0, 0, 0.04),
              0 4px 8px rgba(0, 0, 0, 0.04),
              0 8px 16px rgba(0, 0, 0, 0.04)
            `.trim(),
          }}
        >
          <CardHeader>
            <CardTitle>Primary Contact</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {renderField('primaryContactName', 'Contact Name', 'primaryContactName', 'text', true)}
            {renderField('primaryContactEmail', 'Contact Email', 'primaryContactEmail', 'email', true)}
            {renderField('primaryContactPhone', 'Contact Phone', 'primaryContactPhone', 'tel')}
            <div className="md:col-span-2">
              {renderField('primaryAddress', 'Primary Address', 'primaryAddress')}
            </div>
          </CardContent>
        </Card>

        {/* Billing Information Card */}
        <Card
          className="mb-6"
          style={{
            background: 'rgba(255, 255, 255, 0.8)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            border: '1px solid',
            borderImage: 'linear-gradient(135deg, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0.2) 50%, rgba(255,255,255,0.5) 100%) 1',
            boxShadow: `
              0 0 0 1px rgba(255, 255, 255, 0.18) inset,
              0 2px 4px rgba(0, 0, 0, 0.04),
              0 4px 8px rgba(0, 0, 0, 0.04),
              0 8px 16px rgba(0, 0, 0, 0.04)
            `.trim(),
          }}
        >
          <CardHeader>
            <CardTitle>Billing Information</CardTitle>
            <p className="text-sm text-gray-600">Leave blank to use primary contact information</p>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {renderField('billingContactName', 'Billing Contact Name', 'billingContactName')}
            {renderField('billingContactEmail', 'Billing Contact Email', 'billingContactEmail', 'email')}
            {renderField('billingContactPhone', 'Billing Contact Phone', 'billingContactPhone', 'tel')}
            {renderField('taxId', 'Tax ID', 'taxId')}
            <div className="md:col-span-2">
              {renderField('billingAddress', 'Billing Address', 'billingAddress')}
            </div>
          </CardContent>
        </Card>

        {/* Administrator Setup Card */}
        <Card
          className="mb-6"
          style={{
            background: 'rgba(255, 255, 255, 0.8)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            border: '1px solid',
            borderImage: 'linear-gradient(135deg, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0.2) 50%, rgba(255,255,255,0.5) 100%) 1',
            boxShadow: `
              0 0 0 1px rgba(255, 255, 255, 0.18) inset,
              0 2px 4px rgba(0, 0, 0, 0.04),
              0 4px 8px rgba(0, 0, 0, 0.04),
              0 8px 16px rgba(0, 0, 0, 0.04)
            `.trim(),
          }}
        >
          <CardHeader>
            <CardTitle>Administrator Setup</CardTitle>
            <p className="text-sm text-gray-600">
              An invitation will be sent to this email to set up the provider administrator account
            </p>
          </CardHeader>
          <CardContent>
            {renderField('adminEmail', 'Administrator Email', 'adminEmail', 'email', true)}
          </CardContent>
        </Card>

        {/* Action Buttons */}
        <div className="flex justify-end gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate('/providers')}
            disabled={viewModel.isSaving}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={viewModel.isSaving}>
            {viewModel.isSaving ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                Creating...
              </>
            ) : (
              <>
                <Save size={20} className="mr-2" />
                Create Provider
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
});