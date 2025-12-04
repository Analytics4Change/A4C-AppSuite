import React, { useState } from 'react';
import { useEvents } from '@/hooks/useEvents';
import { ReasonInput } from '@/components/ui/ReasonInput';
import { EventHistory } from '@/components/EventHistory';
import { toast } from 'sonner';

interface MedicationPrescriptionData {
  medicationId: string;
  medicationName: string;
  dosageAmount: number;
  dosageUnit: string;
  frequency: string;
  route: string;
  startDate: string;
  endDate?: string;
  instructions?: string;
  isPrn: boolean;
  prnReason?: string;
  refillsAuthorized?: number;
}

interface ApprovalData {
  approverId: string;
  approverName: string;
  role: 'physician' | 'nurse_practitioner' | 'pharmacist';
}

export function MedicationPrescriptionForm({
  clientId,
  clientName,
  organizationId
}: {
  clientId: string;
  clientName: string;
  organizationId: string;
}) {
  const { emitEvent, submitting } = useEvents({
    onSuccess: () => {
      toast.success('Medication prescribed successfully');
      resetForm();
    },
    onError: (error) => {
      toast.error(error.message);
    }
  });

  const [formData, setFormData] = useState<MedicationPrescriptionData>({
    medicationId: '',
    medicationName: '',
    dosageAmount: 0,
    dosageUnit: 'mg',
    frequency: '',
    route: 'oral',
    startDate: new Date().toISOString().split('T')[0],
    isPrn: false,
    refillsAuthorized: 0
  });

  const [reason, setReason] = useState('');
  const [approval, setApproval] = useState<ApprovalData | null>(null);
  const [requiresApproval, setRequiresApproval] = useState(false);

  const resetForm = () => {
    setFormData({
      medicationId: '',
      medicationName: '',
      dosageAmount: 0,
      dosageUnit: 'mg',
      frequency: '',
      route: 'oral',
      startDate: new Date().toISOString().split('T')[0],
      isPrn: false,
      refillsAuthorized: 0
    });
    setReason('');
    setApproval(null);
    setRequiresApproval(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const prescriptionId = globalThis.crypto.randomUUID();

    const eventMetadata: any = {};

    if (requiresApproval && approval) {
      eventMetadata.approval_chain = [{
        approver_id: approval.approverId,
        approver_name: approval.approverName,
        role: approval.role,
        approved_at: new Date().toISOString(),
        notes: `Approved prescription of ${formData.medicationName} ${formData.dosageAmount}${formData.dosageUnit}`
      }];
    }

    await emitEvent(
      prescriptionId,
      'medication',
      'medication.prescribed',
      {
        organization_id: organizationId,
        client_id: clientId,
        medication_id: formData.medicationId,
        medication_name: formData.medicationName,
        prescription_date: new Date().toISOString(),
        start_date: formData.startDate,
        end_date: formData.endDate,
        prescriber_name: approval?.approverName,
        dosage_amount: formData.dosageAmount,
        dosage_unit: formData.dosageUnit,
        frequency: formData.frequency,
        route: formData.route,
        instructions: formData.instructions,
        is_prn: formData.isPrn,
        prn_reason: formData.prnReason,
        refills_authorized: formData.refillsAuthorized
      },
      reason,
      eventMetadata
    );
  };

  const updateField = <K extends keyof MedicationPrescriptionData>(
    field: K,
    value: MedicationPrescriptionData[K]
  ) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const commonMedications = [
    { id: 'med-001', name: 'Sertraline', controlledSubstance: false },
    { id: 'med-002', name: 'Fluoxetine', controlledSubstance: false },
    { id: 'med-003', name: 'Lorazepam', controlledSubstance: true },
    { id: 'med-004', name: 'Alprazolam', controlledSubstance: true },
    { id: 'med-005', name: 'Escitalopram', controlledSubstance: false },
  ];

  const handleMedicationSelect = (medicationId: string) => {
    const medication = commonMedications.find(m => m.id === medicationId);
    if (medication) {
      updateField('medicationId', medication.id);
      updateField('medicationName', medication.name);
      setRequiresApproval(medication.controlledSubstance);
    }
  };

  const reasonSuggestions = [
    'Initial prescription for diagnosed anxiety disorder per DSM-5 criteria',
    'Dosage adjustment due to insufficient therapeutic response after 4 weeks',
    'Switching medication due to adverse side effects reported by patient',
    'Continuation of successful treatment regimen from previous provider'
  ];

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit} className="bg-white shadow rounded-lg p-6">
        <div className="mb-4">
          <h2 className="text-xl font-semibold">Prescribe Medication</h2>
          <p className="text-sm text-gray-600 mt-1">
            For: <span className="font-medium">{clientName}</span>
          </p>
        </div>

        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-gray-700">
                Medication <span className="text-red-500">*</span>
              </label>
              <select
                required
                value={formData.medicationId}
                onChange={(e) => handleMedicationSelect(e.target.value)}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
              >
                <option value="">Select medication...</option>
                {commonMedications.map(med => (
                  <option key={med.id} value={med.id}>
                    {med.name} {med.controlledSubstance && '⚠️ (Controlled)'}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Dosage <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  required
                  min="0"
                  step="0.5"
                  value={formData.dosageAmount}
                  onChange={(e) => updateField('dosageAmount', parseFloat(e.target.value))}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Unit <span className="text-red-500">*</span>
                </label>
                <select
                  required
                  value={formData.dosageUnit}
                  onChange={(e) => updateField('dosageUnit', e.target.value)}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                >
                  <option value="mg">mg</option>
                  <option value="mcg">mcg</option>
                  <option value="g">g</option>
                  <option value="ml">ml</option>
                  <option value="units">units</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">
                Frequency <span className="text-red-500">*</span>
              </label>
              <select
                required
                value={formData.frequency}
                onChange={(e) => updateField('frequency', e.target.value)}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
              >
                <option value="">Select frequency...</option>
                <option value="Once daily">Once daily</option>
                <option value="Twice daily">Twice daily</option>
                <option value="Three times daily">Three times daily</option>
                <option value="Four times daily">Four times daily</option>
                <option value="Every 4 hours">Every 4 hours</option>
                <option value="Every 6 hours">Every 6 hours</option>
                <option value="Every 8 hours">Every 8 hours</option>
                <option value="Every 12 hours">Every 12 hours</option>
                <option value="As needed">As needed (PRN)</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">
                Route <span className="text-red-500">*</span>
              </label>
              <select
                required
                value={formData.route}
                onChange={(e) => updateField('route', e.target.value)}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
              >
                <option value="oral">Oral</option>
                <option value="sublingual">Sublingual</option>
                <option value="intravenous">Intravenous</option>
                <option value="intramuscular">Intramuscular</option>
                <option value="subcutaneous">Subcutaneous</option>
                <option value="topical">Topical</option>
                <option value="other">Other</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">
                Start Date <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                required
                value={formData.startDate}
                onChange={(e) => updateField('startDate', e.target.value)}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">
                End Date
              </label>
              <input
                type="date"
                value={formData.endDate || ''}
                onChange={(e) => updateField('endDate', e.target.value || undefined)}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">
                Refills Authorized
              </label>
              <input
                type="number"
                min="0"
                max="11"
                value={formData.refillsAuthorized}
                onChange={(e) => updateField('refillsAuthorized', parseInt(e.target.value) || 0)}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">
              Instructions
            </label>
            <textarea
              value={formData.instructions || ''}
              onChange={(e) => updateField('instructions', e.target.value || undefined)}
              rows={2}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
              placeholder="Take with food, avoid alcohol, etc."
            />
          </div>

          <div className="flex items-center">
            <input
              type="checkbox"
              id="isPrn"
              checked={formData.isPrn}
              onChange={(e) => updateField('isPrn', e.target.checked)}
              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
            />
            <label htmlFor="isPrn" className="ml-2 block text-sm text-gray-900">
              PRN (As Needed)
            </label>
          </div>

          {formData.isPrn && (
            <div>
              <label className="block text-sm font-medium text-gray-700">
                PRN Reason
              </label>
              <input
                type="text"
                value={formData.prnReason || ''}
                onChange={(e) => updateField('prnReason', e.target.value || undefined)}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                placeholder="For anxiety, pain, sleep, etc."
              />
            </div>
          )}

          {requiresApproval && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <h3 className="text-sm font-medium text-amber-800 mb-2">
                ⚠️ Approval Required for Controlled Substance
              </h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <input
                  type="text"
                  placeholder="Approver ID"
                  value={approval?.approverId || ''}
                  onChange={(e) => setApproval(prev => ({
                    ...prev!,
                    approverId: e.target.value
                  } as ApprovalData))}
                  className="text-sm rounded-md border-amber-300"
                />
                <input
                  type="text"
                  placeholder="Approver Name"
                  value={approval?.approverName || ''}
                  onChange={(e) => setApproval(prev => ({
                    ...prev!,
                    approverName: e.target.value
                  } as ApprovalData))}
                  className="text-sm rounded-md border-amber-300"
                />
                <select
                  value={approval?.role || ''}
                  onChange={(e) => setApproval(prev => ({
                    ...prev!,
                    role: e.target.value as ApprovalData['role']
                  } as ApprovalData))}
                  className="text-sm rounded-md border-amber-300"
                >
                  <option value="">Select role...</option>
                  <option value="physician">Physician</option>
                  <option value="nurse_practitioner">Nurse Practitioner</option>
                  <option value="pharmacist">Pharmacist</option>
                </select>
              </div>
            </div>
          )}

          <ReasonInput
            value={reason}
            onChange={setReason}
            label="Medical Justification"
            placeholder="Explain the medical necessity for this prescription"
            suggestions={reasonSuggestions}
            helpText="Document the clinical reasoning for prescribing this medication"
          />

          <div className="flex items-center justify-end gap-4">
            <button
              type="button"
              onClick={resetForm}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              Clear Form
            </button>
            <button
              type="submit"
              disabled={
                submitting ||
                !reason ||
                reason.length < 10 ||
                (requiresApproval && !approval?.approverId)
              }
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? 'Prescribing...' : 'Prescribe Medication'}
            </button>
          </div>
        </div>
      </form>

      <div className="bg-white shadow rounded-lg p-6">
        <EventHistory
          entityId={clientId}
          streamType="medication"
          title="Medication History"
          emptyMessage="No medications prescribed yet"
          realtime={true}
          showRawData={false}
          limit={10}
        />
      </div>
    </div>
  );
}