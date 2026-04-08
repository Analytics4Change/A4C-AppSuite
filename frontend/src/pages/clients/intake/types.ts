/**
 * Shared types for intake form section components.
 */

import type { ClientIntakeFormViewModel } from '@/viewModels/client/ClientIntakeFormViewModel';

/** Props shared by all section components */
export interface IntakeSectionProps {
  viewModel: ClientIntakeFormViewModel;
}
