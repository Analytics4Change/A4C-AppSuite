/**
 * ClientIntakePage — Multi-section client registration form.
 *
 * Route: /clients/register
 * Renders a sidebar with section navigation (validation indicators),
 * a completion progress bar, and the active section component.
 * Submits via ClientIntakeFormViewModel, redirects to /clients/:id on success.
 */

import React, { useEffect, useMemo } from 'react';
import { observer } from 'mobx-react-lite';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import {
  ClientIntakeFormViewModel,
  INTAKE_SECTIONS,
  type IntakeSection,
} from '@/viewModels/client/ClientIntakeFormViewModel';
import {
  DemographicsSection,
  ContactInfoSection,
  GuardianSection,
  ReferralSection,
  AdmissionSection,
  InsuranceSection,
  ClinicalSection,
  MedicalSection,
  LegalSection,
  EducationSection,
} from './intake';
import type { IntakeSectionProps } from './intake';
import { CheckCircle, AlertCircle, Circle, ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** Human-readable labels for each section */
const SECTION_LABELS: Record<IntakeSection, string> = {
  demographics: 'Demographics',
  contact_info: 'Contact Info',
  guardian: 'Guardian / Custody',
  referral: 'Referral',
  admission: 'Admission',
  insurance: 'Insurance',
  clinical: 'Clinical',
  medical: 'Medical',
  legal: 'Legal',
  education: 'Education',
};

/** Maps section key to its component */
const SECTION_COMPONENTS: Record<IntakeSection, React.FC<IntakeSectionProps>> = {
  demographics: DemographicsSection,
  contact_info: ContactInfoSection,
  guardian: GuardianSection,
  referral: ReferralSection,
  admission: AdmissionSection,
  insurance: InsuranceSection,
  clinical: ClinicalSection,
  medical: MedicalSection,
  legal: LegalSection,
  education: EducationSection,
};

const glassCardStyle = {
  background: 'rgba(255, 255, 255, 0.7)',
  backdropFilter: 'blur(20px)',
  WebkitBackdropFilter: 'blur(20px)',
  border: '1px solid rgba(255, 255, 255, 0.3)',
  boxShadow: '0 2px 4px rgba(0, 0, 0, 0.05)',
};

/** Validation status icon for sidebar */
const SectionStatusIcon: React.FC<{ status: 'valid' | 'invalid' | 'incomplete' }> = ({
  status,
}) => {
  switch (status) {
    case 'valid':
      return <CheckCircle size={16} className="text-green-500" aria-label="Complete" />;
    case 'invalid':
      return <AlertCircle size={16} className="text-red-500" aria-label="Has errors" />;
    case 'incomplete':
      return <Circle size={16} className="text-gray-300" aria-label="Not started" />;
  }
};

export const ClientIntakePage: React.FC = observer(() => {
  const navigate = useNavigate();
  const { session } = useAuth();
  const orgId = session?.claims?.org_id;

  const vm = useMemo(() => new ClientIntakeFormViewModel(), []);

  useEffect(() => {
    vm.loadFieldDefinitions();
    vm.loadOrganizationUnits();
  }, [vm]);

  // Redirect on success
  useEffect(() => {
    if (vm.submitSuccess && vm.registeredClientId) {
      navigate(`/clients/${vm.registeredClientId}`);
    }
  }, [vm.submitSuccess, vm.registeredClientId, navigate]);

  const ActiveSection = SECTION_COMPONENTS[vm.currentSection];
  const sectionIndex = INTAKE_SECTIONS.indexOf(vm.currentSection);

  const handleSubmit = async () => {
    if (!orgId) return;
    await vm.submit(orgId);
  };

  const handlePrevious = () => {
    if (sectionIndex > 0) {
      vm.setCurrentSection(INTAKE_SECTIONS[sectionIndex - 1]);
    }
  };

  const handleNext = () => {
    if (sectionIndex < INTAKE_SECTIONS.length - 1) {
      vm.setCurrentSection(INTAKE_SECTIONS[sectionIndex + 1]);
    }
  };

  // Loading state
  if (vm.isLoadingFieldDefinitions) {
    return (
      <div className="flex items-center justify-center h-64" data-testid="intake-loading">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
        <span className="ml-3 text-gray-600">Loading form configuration...</span>
      </div>
    );
  }

  // Load error
  if (vm.loadError) {
    return (
      <div
        className="max-w-xl mx-auto mt-12 p-6 rounded-lg bg-red-50 text-red-700"
        data-testid="intake-error"
      >
        <h2 className="text-lg font-semibold mb-2">Failed to load form</h2>
        <p className="text-sm">{vm.loadError}</p>
        <Button variant="outline" className="mt-4" onClick={() => vm.loadFieldDefinitions()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6" data-testid="client-intake-page">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate('/clients')}
          aria-label="Back to client list"
          data-testid="intake-back-button"
        >
          <ArrowLeft size={18} />
        </Button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Register New Client</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Complete each section to register a new client
          </p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mb-6" data-testid="intake-progress">
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm font-medium text-gray-600">Progress</span>
          <span className="text-sm font-medium text-gray-600">{vm.completionPercentage}%</span>
        </div>
        <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-500 rounded-full transition-all duration-300"
            style={{ width: `${vm.completionPercentage}%` }}
            role="progressbar"
            aria-valuenow={vm.completionPercentage}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Form ${vm.completionPercentage}% complete`}
          />
        </div>
      </div>

      {/* Sub-entity error warnings */}
      {vm.subEntityErrors.length > 0 && (
        <div
          className="mb-6 p-4 rounded-lg bg-amber-50 border border-amber-200"
          role="alert"
          data-testid="intake-sub-entity-warnings"
        >
          <h3 className="text-sm font-semibold text-amber-800 mb-1">
            Client registered with warnings
          </h3>
          <ul className="text-sm text-amber-700 list-disc ml-4">
            {vm.subEntityErrors.map((err, i) => (
              <li key={i}>{err}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Submit error */}
      {vm.submitError && (
        <div
          className="mb-6 p-4 rounded-lg bg-red-50 border border-red-200"
          role="alert"
          data-testid="intake-submit-error"
        >
          <p className="text-sm text-red-700">{vm.submitError}</p>
        </div>
      )}

      {/* Main layout: sidebar + content */}
      <div className="flex gap-6">
        {/* Sidebar navigation */}
        <nav
          className="w-56 flex-shrink-0 hidden md:block"
          aria-label="Intake form sections"
          data-testid="intake-sidebar"
        >
          <div className="rounded-xl p-3 space-y-1" style={glassCardStyle}>
            {INTAKE_SECTIONS.map((section) => {
              const status = vm.sectionValidation.get(section) ?? 'incomplete';
              const isActive = vm.currentSection === section;

              return (
                <button
                  key={section}
                  onClick={() => vm.setCurrentSection(section)}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left transition-colors ${
                    isActive
                      ? 'bg-blue-50 text-blue-700 font-medium'
                      : 'text-gray-600 hover:bg-gray-50'
                  }`}
                  aria-current={isActive ? 'step' : undefined}
                  data-testid={`intake-nav-${section}`}
                >
                  <SectionStatusIcon status={status} />
                  <span>{SECTION_LABELS[section]}</span>
                </button>
              );
            })}
          </div>
        </nav>

        {/* Mobile section selector */}
        <div className="md:hidden mb-4 w-full">
          <select
            value={vm.currentSection}
            onChange={(e) => vm.setCurrentSection(e.target.value as IntakeSection)}
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
            aria-label="Select intake section"
            data-testid="intake-mobile-nav"
          >
            {INTAKE_SECTIONS.map((section) => {
              const status = vm.sectionValidation.get(section) ?? 'incomplete';
              const indicator =
                status === 'valid' ? '\u2713' : status === 'invalid' ? '\u2717' : '\u25CB';
              return (
                <option key={section} value={section}>
                  {indicator} {SECTION_LABELS[section]}
                </option>
              );
            })}
          </select>
        </div>

        {/* Active section content */}
        <div className="flex-1 min-w-0">
          <div
            className="rounded-xl p-6"
            style={glassCardStyle}
            data-testid="intake-section-content"
          >
            <ActiveSection viewModel={vm} />
          </div>

          {/* Navigation + Submit footer */}
          <div className="flex items-center justify-between mt-6" data-testid="intake-footer">
            <Button
              variant="outline"
              onClick={handlePrevious}
              disabled={sectionIndex === 0}
              data-testid="intake-prev-button"
            >
              Previous
            </Button>

            <div className="flex gap-3">
              {sectionIndex < INTAKE_SECTIONS.length - 1 ? (
                <Button onClick={handleNext} data-testid="intake-next-button">
                  Next
                </Button>
              ) : (
                <div
                  title={
                    !vm.canSubmit && vm.unfilledRequiredFields.length > 0
                      ? `Missing required fields:\n${vm.unfilledRequiredFields.map((f) => `• ${f.displayName} (${f.section})`).join('\n')}`
                      : undefined
                  }
                >
                  <Button
                    onClick={handleSubmit}
                    disabled={!vm.canSubmit || !orgId}
                    data-testid="intake-submit-button"
                  >
                    {vm.isSubmitting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        Registering...
                      </>
                    ) : (
                      'Register Client'
                    )}
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});
