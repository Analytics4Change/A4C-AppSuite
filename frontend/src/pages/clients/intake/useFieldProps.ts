/**
 * Hook that derives IntakeFormField props from the ViewModel for a given field_key.
 */

import type { ClientIntakeFormViewModel } from '@/viewModels/client/ClientIntakeFormViewModel';
import type { IntakeFormFieldProps } from './IntakeFormField';

type FieldPropsResult = Pick<
  IntakeFormFieldProps,
  'fieldKey' | 'label' | 'fieldType' | 'value' | 'isRequired' | 'isVisible' | 'error' | 'onChange'
>;

export function getFieldProps(
  vm: ClientIntakeFormViewModel,
  fieldKey: string
): FieldPropsResult | null {
  const fd = vm.fieldDefinitions.find((d) => d.field_key === fieldKey && d.is_active);
  if (!fd) return null;

  const isVisible = vm.visibleFieldKeys.has(fieldKey);
  const isRequired = vm.requiredFieldKeys.has(fieldKey);
  const value = vm.formData[fieldKey];
  const error = vm.validationErrors.get(fieldKey);

  return {
    fieldKey,
    label: fd.configurable_label ?? fd.display_name,
    fieldType: fd.field_type,
    value,
    isRequired,
    isVisible,
    error,
    onChange: (key: string, val: unknown) => vm.setField(key, val),
  };
}
