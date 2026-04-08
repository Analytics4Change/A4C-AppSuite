/**
 * Insurance Section — Step 6 of client intake form.
 *
 * Fields: medicaid_id, medicare_id.
 * Sub-entity collection: insurance policies with add/remove/update.
 */

import React from 'react';
import { observer } from 'mobx-react-lite';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { IntakeFormField } from './IntakeFormField';
import { getFieldProps } from './useFieldProps';
import type { IntakeSectionProps } from './types';
import { INSURANCE_POLICY_TYPE_LABELS, type InsurancePolicyType } from '@/types/client.types';

const POLICY_TYPE_OPTIONS = Object.entries(INSURANCE_POLICY_TYPE_LABELS) as [
  InsurancePolicyType,
  string,
][];

export const InsuranceSection: React.FC<IntakeSectionProps> = observer(({ viewModel }) => {
  const vm = viewModel;
  const field = (key: string) => getFieldProps(vm, key);

  return (
    <div className="space-y-6" data-testid="intake-section-insurance">
      <div>
        <h3 className="text-lg font-semibold text-gray-900">Insurance & Coverage</h3>
        <p className="text-sm text-gray-500 mt-1">Insurance policies and government program IDs</p>
      </div>

      {/* Medicaid/Medicare IDs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {(() => {
          const p = field('medicaid_id');
          return p ? <IntakeFormField {...p} placeholder="Medicaid ID number" /> : null;
        })()}
        {(() => {
          const p = field('medicare_id');
          return p ? <IntakeFormField {...p} placeholder="Medicare ID number" /> : null;
        })()}
      </div>

      {/* Insurance Policies */}
      <div className="space-y-3" data-testid="intake-insurance-policies">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium text-gray-700">Insurance Policies</Label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-blue-600 hover:text-blue-700"
            onClick={() =>
              vm.addInsurancePolicy({
                policy_type: 'primary',
                payer_name: '',
                policy_number: '',
                group_number: '',
                subscriber_name: '',
                subscriber_relation: '',
                coverage_start_date: '',
                coverage_end_date: '',
              })
            }
            data-testid="add-insurance-btn"
          >
            <Plus size={16} className="mr-1" /> Add Policy
          </Button>
        </div>

        {vm.insurancePolicies.map((policy, i) => (
          <div key={i} className="p-4 border rounded-lg bg-gray-50/50 space-y-3">
            <div className="flex items-center justify-between">
              <select
                value={policy.policy_type}
                onChange={(e) =>
                  vm.updateInsurancePolicy(i, {
                    policy_type: e.target.value as InsurancePolicyType,
                  })
                }
                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
                data-testid={`insurance-type-${i}`}
              >
                {POLICY_TYPE_OPTIONS.map(([val, lbl]) => (
                  <option key={val} value={val}>
                    {lbl}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-red-500 hover:text-red-700"
                onClick={() => vm.removeInsurancePolicy(i)}
                aria-label={`Remove policy ${i + 1}`}
                data-testid={`remove-insurance-${i}`}
              >
                <Trash2 size={16} />
              </Button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor={`payer-${i}`} className="text-xs text-gray-500">
                  Payer Name
                </Label>
                <Input
                  id={`payer-${i}`}
                  value={policy.payer_name}
                  onChange={(e) => vm.updateInsurancePolicy(i, { payer_name: e.target.value })}
                  placeholder="Insurance company"
                  data-testid={`insurance-payer-${i}`}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`policy-num-${i}`} className="text-xs text-gray-500">
                  Policy Number
                </Label>
                <Input
                  id={`policy-num-${i}`}
                  value={policy.policy_number}
                  onChange={(e) => vm.updateInsurancePolicy(i, { policy_number: e.target.value })}
                  placeholder="Policy #"
                  data-testid={`insurance-policy-number-${i}`}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor={`group-${i}`} className="text-xs text-gray-500">
                  Group Number
                </Label>
                <Input
                  id={`group-${i}`}
                  value={policy.group_number}
                  onChange={(e) => vm.updateInsurancePolicy(i, { group_number: e.target.value })}
                  placeholder="Group #"
                  data-testid={`insurance-group-${i}`}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`subscriber-${i}`} className="text-xs text-gray-500">
                  Subscriber Name
                </Label>
                <Input
                  id={`subscriber-${i}`}
                  value={policy.subscriber_name}
                  onChange={(e) => vm.updateInsurancePolicy(i, { subscriber_name: e.target.value })}
                  placeholder="Subscriber name"
                  data-testid={`insurance-subscriber-${i}`}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label htmlFor={`sub-rel-${i}`} className="text-xs text-gray-500">
                  Subscriber Relation
                </Label>
                <Input
                  id={`sub-rel-${i}`}
                  value={policy.subscriber_relation}
                  onChange={(e) =>
                    vm.updateInsurancePolicy(i, { subscriber_relation: e.target.value })
                  }
                  placeholder="e.g., Self, Parent"
                  data-testid={`insurance-relation-${i}`}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`cov-start-${i}`} className="text-xs text-gray-500">
                  Coverage Start
                </Label>
                <Input
                  id={`cov-start-${i}`}
                  type="date"
                  value={policy.coverage_start_date}
                  onChange={(e) =>
                    vm.updateInsurancePolicy(i, { coverage_start_date: e.target.value })
                  }
                  data-testid={`insurance-start-${i}`}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`cov-end-${i}`} className="text-xs text-gray-500">
                  Coverage End
                </Label>
                <Input
                  id={`cov-end-${i}`}
                  type="date"
                  value={policy.coverage_end_date}
                  onChange={(e) =>
                    vm.updateInsurancePolicy(i, { coverage_end_date: e.target.value })
                  }
                  data-testid={`insurance-end-${i}`}
                />
              </div>
            </div>
          </div>
        ))}

        {vm.insurancePolicies.length === 0 && (
          <p className="text-sm text-gray-400 italic py-2">
            No insurance policies added. Click &ldquo;Add Policy&rdquo; to add coverage information.
          </p>
        )}
      </div>
    </div>
  );
});
