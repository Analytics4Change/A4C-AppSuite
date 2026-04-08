import React, { useEffect, useState, useCallback } from 'react';
import { useParams, Outlet, NavLink, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ArrowLeft, User, Calendar, Loader2, LogOut } from 'lucide-react';
import { getClientService } from '@/services/clients';
import type {
  Client,
  DischargeOutcome,
  DischargeReason,
  DischargePlacement,
} from '@/types/client.types';
import {
  DISCHARGE_OUTCOME_LABELS,
  DISCHARGE_REASON_LABELS,
  DISCHARGE_PLACEMENT_LABELS,
} from '@/types/client.types';

export const ClientDetailLayout: React.FC = () => {
  const { clientId } = useParams<{ clientId: string }>();
  const navigate = useNavigate();
  const [client, setClient] = useState<Client | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Discharge dialog state
  const [showDischargeDialog, setShowDischargeDialog] = useState(false);
  const [isDischarging, setIsDischarging] = useState(false);
  const [dischargeError, setDischargeError] = useState<string | null>(null);
  const [dischargeDate, setDischargeDate] = useState('');
  const [dischargeOutcome, setDischargeOutcome] = useState<DischargeOutcome | ''>('');
  const [dischargeReason, setDischargeReason] = useState<DischargeReason | ''>('');
  const [dischargePlacement, setDischargePlacement] = useState<DischargePlacement | ''>('');

  const loadClient = useCallback(() => {
    if (!clientId) return;
    let cancelled = false;

    setIsLoading(true);
    setError(null);
    getClientService()
      .getClient(clientId)
      .then((c) => {
        if (!cancelled) setClient(c);
      })
      .catch(() => {
        if (!cancelled) setError('Client not found');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [clientId]);

  useEffect(() => {
    return loadClient();
  }, [loadClient]);

  const handleOpenDischarge = () => {
    setDischargeDate(new Date().toISOString().split('T')[0]);
    setDischargeOutcome('');
    setDischargeReason('');
    setDischargePlacement('');
    setDischargeError(null);
    setShowDischargeDialog(true);
  };

  const handleDischarge = async () => {
    if (!clientId || !dischargeDate || !dischargeOutcome || !dischargeReason) return;

    setIsDischarging(true);
    setDischargeError(null);
    try {
      const result = await getClientService().dischargeClient(clientId, {
        discharge_date: dischargeDate,
        discharge_outcome: dischargeOutcome as DischargeOutcome,
        discharge_reason: dischargeReason as DischargeReason,
        discharge_placement: dischargePlacement
          ? (dischargePlacement as DischargePlacement)
          : undefined,
        reason: 'Discharged via client detail page',
      });
      if (!result.success) {
        setDischargeError(result.error ?? 'Failed to discharge client');
        return;
      }
      setShowDischargeDialog(false);
      // Refresh client data
      loadClient();
    } catch (err) {
      setDischargeError(err instanceof Error ? err.message : 'Unexpected error');
    } finally {
      setIsDischarging(false);
    }
  };

  const canConfirmDischarge = !!dischargeDate && !!dischargeOutcome && !!dischargeReason;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12" data-testid="client-detail-loading">
        <Loader2 className="w-6 h-6 animate-spin text-blue-500 mr-2" />
        <span className="text-gray-500">Loading client...</span>
      </div>
    );
  }

  if (error || !client) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500 mb-4">{error ?? 'Client not found'}</p>
        <Button onClick={() => navigate('/clients')}>Back to Clients</Button>
      </div>
    );
  }

  const displayName = client.preferred_name
    ? `${client.preferred_name} (${client.first_name}) ${client.last_name}`
    : `${client.first_name} ${client.last_name}`;

  const tabs = [
    { path: `/clients/${clientId}`, label: 'Overview', exact: true },
    { path: `/clients/${clientId}/medications`, label: 'Medications' },
    { path: `/clients/${clientId}/history`, label: 'History' },
    { path: `/clients/${clientId}/documents`, label: 'Documents' },
  ];

  return (
    <div>
      {/* Back Button */}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => navigate('/clients')}
        className="mb-4"
        data-testid="back-to-clients-btn"
      >
        <ArrowLeft size={16} className="mr-2" />
        Back to Clients
      </Button>

      {/* Client Header */}
      <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-blue-100 rounded-full">
              <User className="w-8 h-8 text-blue-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{displayName}</h1>
              <div className="flex items-center gap-4 mt-2 text-sm text-gray-600">
                {client.mrn && <span>MRN: {client.mrn}</span>}
                <span className="flex items-center gap-1">
                  <Calendar size={14} />
                  DOB: {new Date(client.date_of_birth).toLocaleDateString()}
                </span>
                <span
                  className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                    client.status === 'active'
                      ? 'bg-green-100 text-green-700'
                      : client.status === 'discharged'
                        ? 'bg-amber-100 text-amber-700'
                        : 'bg-gray-100 text-gray-600'
                  }`}
                  data-testid="client-status-badge"
                >
                  {client.status.charAt(0).toUpperCase() + client.status.slice(1)}
                </span>
              </div>
            </div>
          </div>
          {/* Discharge button — only for active clients */}
          {client.status === 'active' && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleOpenDischarge}
              className="text-amber-700 border-amber-300 hover:bg-amber-50"
              data-testid="discharge-client-btn"
            >
              <LogOut size={16} className="mr-2" />
              Discharge
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="flex space-x-8">
          {tabs.map((tab) => (
            <NavLink
              key={tab.path}
              to={tab.path}
              end={tab.exact}
              data-testid={`client-detail-tab-${tab.label.toLowerCase()}`}
              className={({ isActive }) => `
                py-2 px-1 border-b-2 font-medium text-sm transition-colors
                ${
                  isActive
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }
              `}
            >
              {tab.label}
            </NavLink>
          ))}
        </nav>
      </div>

      {/* Content */}
      <Outlet context={{ client }} />

      {/* Discharge Dialog */}
      {showDischargeDialog && (
        <DischargeDialog
          isOpen={showDischargeDialog}
          isLoading={isDischarging}
          error={dischargeError}
          canConfirm={canConfirmDischarge}
          dischargeDate={dischargeDate}
          dischargeOutcome={dischargeOutcome}
          dischargeReason={dischargeReason}
          dischargePlacement={dischargePlacement}
          onDateChange={setDischargeDate}
          onOutcomeChange={setDischargeOutcome}
          onReasonChange={setDischargeReason}
          onPlacementChange={setDischargePlacement}
          onConfirm={handleDischarge}
          onCancel={() => setShowDischargeDialog(false)}
        />
      )}
    </div>
  );
};

// =============================================================================
// Discharge Dialog (inline — single use, not worth extracting)
// =============================================================================

interface DischargeDialogProps {
  isOpen: boolean;
  isLoading: boolean;
  error: string | null;
  canConfirm: boolean;
  dischargeDate: string;
  dischargeOutcome: DischargeOutcome | '';
  dischargeReason: DischargeReason | '';
  dischargePlacement: DischargePlacement | '';
  onDateChange: (v: string) => void;
  onOutcomeChange: (v: DischargeOutcome | '') => void;
  onReasonChange: (v: DischargeReason | '') => void;
  onPlacementChange: (v: DischargePlacement | '') => void;
  onConfirm: () => void;
  onCancel: () => void;
}

const DischargeDialog: React.FC<DischargeDialogProps> = ({
  isOpen,
  isLoading,
  error,
  canConfirm,
  dischargeDate,
  dischargeOutcome,
  dischargeReason,
  dischargePlacement,
  onDateChange,
  onOutcomeChange,
  onReasonChange,
  onPlacementChange,
  onConfirm,
  onCancel,
}) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="discharge-dialog-title"
      data-testid="discharge-dialog"
    >
      <div className="absolute inset-0 bg-black/50" onClick={onCancel} aria-hidden="true" />
      <div className="relative bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
        <h3 id="discharge-dialog-title" className="text-lg font-semibold text-gray-900 mb-4">
          Discharge Client
        </h3>

        {error && (
          <div
            className="mb-4 p-3 rounded-md bg-red-50 text-sm text-red-700"
            role="alert"
            data-testid="discharge-error"
          >
            {error}
          </div>
        )}

        <div className="space-y-4">
          {/* Discharge Date */}
          <div>
            <label
              htmlFor="discharge-date"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Discharge Date <span className="text-red-500">*</span>
            </label>
            <input
              id="discharge-date"
              type="date"
              value={dischargeDate}
              onChange={(e) => onDateChange(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              data-testid="discharge-date-input"
            />
          </div>

          {/* Outcome */}
          <div>
            <label
              htmlFor="discharge-outcome"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Outcome <span className="text-red-500">*</span>
            </label>
            <select
              id="discharge-outcome"
              value={dischargeOutcome}
              onChange={(e) => onOutcomeChange(e.target.value as DischargeOutcome | '')}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              data-testid="discharge-outcome-select"
            >
              <option value="">Select outcome...</option>
              {(Object.entries(DISCHARGE_OUTCOME_LABELS) as [DischargeOutcome, string][]).map(
                ([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                )
              )}
            </select>
          </div>

          {/* Reason */}
          <div>
            <label
              htmlFor="discharge-reason"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Reason <span className="text-red-500">*</span>
            </label>
            <select
              id="discharge-reason"
              value={dischargeReason}
              onChange={(e) => onReasonChange(e.target.value as DischargeReason | '')}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              data-testid="discharge-reason-select"
            >
              <option value="">Select reason...</option>
              {(Object.entries(DISCHARGE_REASON_LABELS) as [DischargeReason, string][]).map(
                ([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                )
              )}
            </select>
          </div>

          {/* Placement (optional) */}
          <div>
            <label
              htmlFor="discharge-placement"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Discharge Placement
            </label>
            <select
              id="discharge-placement"
              value={dischargePlacement}
              onChange={(e) => onPlacementChange(e.target.value as DischargePlacement | '')}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              data-testid="discharge-placement-select"
            >
              <option value="">None selected</option>
              {(Object.entries(DISCHARGE_PLACEMENT_LABELS) as [DischargePlacement, string][]).map(
                ([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                )
              )}
            </select>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <Button
            variant="outline"
            onClick={onCancel}
            disabled={isLoading}
            data-testid="discharge-cancel-btn"
          >
            Cancel
          </Button>
          <Button
            onClick={onConfirm}
            disabled={!canConfirm || isLoading}
            className="bg-amber-600 hover:bg-amber-700 text-white"
            data-testid="discharge-confirm-btn"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Discharging...
              </>
            ) : (
              'Confirm Discharge'
            )}
          </Button>
        </div>
      </div>
    </div>
  );
};
