/**
 * User Form Fields Component
 *
 * Shared form fields for user invitation and edit forms.
 * Includes email (with smart lookup), first name, last name, and role selection.
 *
 * Features:
 * - Smart email lookup with on-blur detection
 * - Contextual UI feedback based on email status
 * - Multi-role selection
 * - Field-level validation error display
 * - Accessible labels and error messages
 * - Integration with UserFormViewModel
 *
 * @see UserFormViewModel for validation logic
 */

import React, { useCallback, useId } from 'react';
import { observer } from 'mobx-react-lite';
import { cn } from '@/components/ui/utils';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  AlertCircle,
  Mail,
  User,
  Shield,
  CheckCircle,
  Clock,
  XCircle,
  UserPlus,
  RefreshCw,
  Loader2,
} from 'lucide-react';
import type {
  InviteUserFormData,
  EmailLookupResult,
  EmailLookupStatus,
  InvitationPhone,
} from '@/types/user.types';
import type { Role } from '@/types/role.types';
import { Logger } from '@/utils/logger';
import { InvitationPhoneInput } from './InvitationPhoneInput';

const log = Logger.getLogger('component');

/**
 * Props for UserFormFields component
 */
export interface UserFormFieldsProps {
  /** Current form data */
  formData: InviteUserFormData;

  /** Callback when a field value changes */
  onFieldChange: <K extends keyof InviteUserFormData>(
    field: K,
    value: InviteUserFormData[K]
  ) => void;

  /** Callback when a field loses focus */
  onFieldBlur: (field: keyof InviteUserFormData) => void;

  /** Get error message for a field */
  getFieldError: (field: keyof InviteUserFormData) => string | null;

  /** Available roles for selection */
  availableRoles: Role[];

  /** Called when role selection changes */
  onRoleToggle: (roleId: string) => void;

  /** Email lookup result (from on-blur lookup) */
  emailLookup?: EmailLookupResult | null;

  /** Whether email lookup is in progress */
  isEmailLookupLoading?: boolean;

  /** Called when email is blurred for lookup */
  onEmailBlur?: () => void;

  /** Suggested action based on email lookup */
  suggestedAction?: 'invite' | 'resend' | 'reactivate' | 'add_to_org' | null;

  /** Called when suggested action is accepted */
  onSuggestedAction?: (action: string) => void;

  /** Whether the form is disabled (e.g., during submission) */
  disabled?: boolean;

  /** Whether this is edit mode (hides email field) */
  isEditMode?: boolean;

  /** User UUID (shown read-only in edit mode) */
  userId?: string;

  /**
   * Whether the role list is filtered based on permission constraints.
   * When true, shows an info message explaining that only assignable roles are displayed.
   * @default false
   */
  rolesFiltered?: boolean;

  /**
   * Current phones list (Phase 6)
   * When provided, phone input section is displayed
   */
  phones?: InvitationPhone[];

  /**
   * Called when phones list changes (Phase 6)
   */
  onPhonesChange?: (phones: InvitationPhone[]) => void;

  /**
   * Phone validation errors by index and field (Phase 6)
   */
  phoneErrors?: Record<number, Record<string, string>>;

  /** Additional CSS classes */
  className?: string;
}

/**
 * Field wrapper component with label and error display
 */
interface FieldWrapperProps {
  id: string;
  label: string;
  error: string | null;
  required?: boolean;
  children: React.ReactNode;
  hint?: string;
}

const FieldWrapper: React.FC<FieldWrapperProps> = ({
  id,
  label,
  error,
  required = false,
  children,
  hint,
}) => {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;

  return (
    <div className="space-y-1.5">
      <Label
        htmlFor={id}
        className={cn('text-sm font-medium', error ? 'text-red-600' : 'text-gray-700')}
      >
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </Label>
      {children}
      {hint && !error && (
        <p id={hintId} className="text-xs text-gray-500">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="flex items-center gap-1 text-sm text-red-600" role="alert">
          <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
};

/**
 * Email lookup status feedback configuration
 */
const EMAIL_STATUS_CONFIG: Record<
  EmailLookupStatus,
  {
    icon: React.ReactNode;
    bgClass: string;
    textClass: string;
    message: string;
    actionLabel?: string;
    actionVariant?: 'default' | 'outline';
  }
> = {
  not_found: {
    icon: <Mail size={16} />,
    bgClass: 'bg-blue-50',
    textClass: 'text-blue-700',
    message: 'New user - complete the form to send an invitation.',
    actionLabel: undefined,
  },
  pending: {
    icon: <Clock size={16} />,
    bgClass: 'bg-yellow-50',
    textClass: 'text-yellow-700',
    message: 'This email has a pending invitation.',
    // No button yet. `viewModel.resendInvitation(invitationId)` exists, but the
    // page's resend handlers read `currentItem`, which is null in create mode —
    // they need parameterising on an explicit id first. Deferred to its own card
    // rather than shipped half-wired.
    actionLabel: undefined,
  },
  expired: {
    icon: <XCircle size={16} />,
    bgClass: 'bg-red-50',
    textClass: 'text-red-700',
    message: 'Previous invitation expired.',
    // No button: "Send New Invitation" is exactly what the form's own Send button
    // does. A second control for the same action is noise.
    actionLabel: undefined,
  },
  active_member: {
    icon: <CheckCircle size={16} />,
    bgClass: 'bg-green-50',
    textClass: 'text-green-700',
    message: 'This user is already an active member of this organization.',
    // No button yet. "View User" is genuinely useful and cheap to dispatch, but it
    // navigates away from a partly-filled create form, which needs the dirty/discard
    // dance — out of scope for the wireup. Deferred to the same card as resend.
    actionLabel: undefined,
  },
  deactivated: {
    icon: <XCircle size={16} />,
    bgClass: 'bg-gray-50',
    textClass: 'text-gray-700',
    message: 'This user was deactivated.',
    // No action button: a standalone "Reactivate" would reactivate WITHOUT the
    // roles the admin just selected, whereas submitting the form reactivates
    // and assigns them in one transaction (invite-user/index.ts, deactivated
    // route). Two paths for one intent, with the button being the lossy one.
    actionLabel: undefined,
  },
  other_org: {
    icon: <UserPlus size={16} />,
    bgClass: 'bg-purple-50',
    textClass: 'text-purple-700',
    message: 'This user exists but is not in this organization.',
    // No action button: SupabaseUserCommandService.addUserToOrganization is a
    // not-implemented stub. Normal submit already routes this case correctly
    // server-side.
    actionLabel: undefined,
  },
  lookup_failed: {
    icon: <AlertCircle size={16} />,
    // Orange, not amber: `pending` above is already yellow-50/yellow-700 and
    // amber-50 is visually indistinguishable from it. The icon and copy carry
    // the meaning either way (WCAG 1.4.1), but the panels should not read as
    // the same state at a glance.
    bgClass: 'bg-orange-50',
    textClass: 'text-orange-800',
    // Deliberately does NOT promise correct routing. The Edge Function re-runs
    // these same checks, but shares this read path's failure modes — so if the
    // lookup failed for an infrastructural reason, the server's re-check may
    // fail too. Promise only what is guaranteed: that it re-checks.
    message:
      "Couldn't check this email's status. You can still send the invitation; the server re-checks before routing.",
    // Retry is the ONE action in this config that is both wanted and fully
    // implementable, and PR B wires its handler — so the label ships with it,
    // never ahead of it.
    actionLabel: 'Try again',
    actionVariant: 'outline',
  },
};

/**
 * Email lookup feedback component
 */
interface EmailLookupFeedbackProps {
  lookup: EmailLookupResult;
  onAction?: (action: string) => void;
  isLoading?: boolean;
}

const EmailLookupFeedback: React.FC<EmailLookupFeedbackProps> = ({
  lookup,
  onAction,
  isLoading = false,
}) => {
  const config = EMAIL_STATUS_CONFIG[lookup.status];

  if (!config) return null;

  const handleActionClick = () => {
    let action: string;
    switch (lookup.status) {
      case 'pending':
        action = 'resend';
        break;
      case 'expired':
        action = 'invite';
        break;
      case 'active_member':
        action = 'view';
        break;
      case 'lookup_failed':
        action = 'retry';
        break;
      // Every other status carries no actionLabel, so this handler is unreachable
      // for them — see EMAIL_STATUS_CONFIG for the per-status reason.
      default:
        action = 'invite';
    }
    onAction?.(action);
  };

  // `lookup_failed` is a separate variant of EmailLookupResult that carries no
  // identity fields at all, so the narrowing below is what makes "never surface
  // a name or role for a lookup we could not complete" structural.
  const identity = lookup.status === 'lookup_failed' ? null : lookup;

  // NOTE: no role/aria-live here. The live region is the always-mounted wrapper in
  // UserFormFields — a region inserted into the DOM in the same tick as its text is
  // not reliably announced, so it must exist and be observed BEFORE content lands.
  return (
    <div
      className={cn('mt-2 p-3 rounded-lg flex items-start gap-3', config.bgClass)}
      data-testid={`email-lookup-${lookup.status}`}
    >
      <span className={cn('mt-0.5', config.textClass)} aria-hidden="true">
        {config.icon}
      </span>
      <div className="flex-1">
        <p className={cn('text-sm', config.textClass)}>{config.message}</p>
        {identity?.firstName && (
          <p className="text-sm text-gray-600 mt-1">
            Name: {identity.firstName} {identity.lastName}
          </p>
        )}
        {identity?.currentRoles && identity.currentRoles.length > 0 && (
          <p className="text-sm text-gray-600 mt-1">
            Current roles: {identity.currentRoles.map((r) => r.roleName).join(', ')}
          </p>
        )}
      </div>
      {config.actionLabel && onAction && (
        <Button
          size="sm"
          variant={config.actionVariant || 'default'}
          onClick={handleActionClick}
          disabled={isLoading}
          className="shrink-0"
          data-testid={`email-lookup-action-${lookup.status}`}
        >
          {isLoading ? (
            <Loader2 size={14} className="mr-1.5 animate-spin" aria-hidden="true" />
          ) : lookup.status === 'pending' ? (
            <RefreshCw size={14} className="mr-1.5" aria-hidden="true" />
          ) : null}
          {config.actionLabel}
        </Button>
      )}
    </div>
  );
};

/**
 * UserFormFields - Form fields for user invitation/edit
 *
 * @example
 * <UserFormFields
 *   formData={viewModel.formData}
 *   onFieldChange={viewModel.setFieldValue}
 *   onFieldBlur={viewModel.touchField}
 *   getFieldError={viewModel.getFieldError}
 *   availableRoles={viewModel.availableRoles}
 *   onRoleToggle={viewModel.toggleRole}
 *   emailLookup={viewModel.emailLookupResult}
 *   onEmailBlur={viewModel.lookupEmail}
 * />
 */
export const UserFormFields: React.FC<UserFormFieldsProps> = observer(
  ({
    formData,
    onFieldChange,
    onFieldBlur,
    getFieldError,
    availableRoles,
    onRoleToggle,
    emailLookup,
    isEmailLookupLoading = false,
    onEmailBlur,
    suggestedAction: _suggestedAction,
    onSuggestedAction,
    disabled = false,
    isEditMode = false,
    userId,
    rolesFiltered = false,
    phones,
    onPhonesChange,
    phoneErrors,
    className,
  }) => {
    const baseId = useId();

    log.debug('UserFormFields rendering', {
      isEditMode,
      roleCount: availableRoles.length,
      selectedRoles: formData.roleIds.length,
      hasEmailLookup: !!emailLookup,
    });

    // Field IDs
    const emailId = `${baseId}-email`;
    const firstNameId = `${baseId}-firstName`;
    const lastNameId = `${baseId}-lastName`;
    const rolesId = `${baseId}-roles`;

    // Handle email blur
    const handleEmailBlur = useCallback(() => {
      onFieldBlur('email');
      onEmailBlur?.();
    }, [onFieldBlur, onEmailBlur]);

    // Get errors
    const emailError = getFieldError('email');
    const firstNameError = getFieldError('firstName');
    const lastNameError = getFieldError('lastName');
    const rolesError = getFieldError('roleIds');

    // Show email feedback when we have a lookup result and email field is valid
    const showEmailFeedback = emailLookup && !emailError && formData.email.trim();

    // Should disable other fields based on email status
    const shouldDisableFields =
      disabled ||
      !!(
        emailLookup &&
        (emailLookup.status === 'active_member' || emailLookup.status === 'pending')
      );

    return (
      <div className={cn('space-y-4', className)}>
        {isEditMode && userId && (
          <div className="text-xs text-gray-500 font-mono bg-gray-50 px-3 py-2 rounded">
            ID: {userId}
          </div>
        )}

        {/* Email Field (hidden in edit mode) */}
        {!isEditMode && (
          <div>
            <FieldWrapper
              id={emailId}
              label="Email Address"
              error={emailError}
              required
              hint="Enter the user's email address to check their status"
            >
              <div className="relative">
                <Mail
                  className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400"
                  size={16}
                  aria-hidden="true"
                />
                <Input
                  id={emailId}
                  type="email"
                  value={formData.email}
                  onChange={(e) => onFieldChange('email', e.target.value)}
                  onBlur={handleEmailBlur}
                  disabled={disabled}
                  placeholder="user@example.com"
                  className={cn('pl-10', emailError && 'border-red-300 focus:ring-red-500')}
                  aria-required="true"
                  aria-invalid={!!emailError}
                  aria-busy={isEmailLookupLoading || undefined}
                  aria-describedby={
                    emailError
                      ? `${emailId}-error`
                      : showEmailFeedback
                        ? `${emailId}-feedback`
                        : `${emailId}-hint`
                  }
                />
                {isEmailLookupLoading && (
                  // Decorative: the live region below announces the in-flight state.
                  // A bare <svg aria-label> has no role="img", so the name may not be
                  // exposed at all — don't rely on it to carry meaning.
                  <Loader2
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 animate-spin"
                    size={16}
                    aria-hidden="true"
                    data-testid="email-lookup-spinner"
                  />
                )}
              </div>
            </FieldWrapper>

            {/*
              Email lookup feedback — the live region is ALWAYS mounted.

              Screen readers only announce changes to a region they were already
              observing; one inserted together with its text is routinely missed.
              Mounting the container unconditionally and swapping only its children
              is what makes the "couldn't check this email" panel audible rather
              than sighted-users-only.

              It also announces the in-flight state, so a slow lookup is not
              silence — the spinner alone conveys nothing to AT.
            */}
            <div id={`${emailId}-feedback`} role="status" aria-live="polite">
              {isEmailLookupLoading ? (
                <p className="mt-2 text-sm text-gray-600" data-testid="email-lookup-checking">
                  Checking this email…
                </p>
              ) : showEmailFeedback ? (
                <EmailLookupFeedback
                  lookup={emailLookup}
                  onAction={onSuggestedAction}
                  isLoading={disabled}
                />
              ) : null}
            </div>
          </div>
        )}

        {/* First Name */}
        <FieldWrapper id={firstNameId} label="First Name" error={firstNameError} required>
          <div className="relative">
            <User
              className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400"
              size={16}
              aria-hidden="true"
            />
            <Input
              id={firstNameId}
              type="text"
              value={formData.firstName}
              onChange={(e) => onFieldChange('firstName', e.target.value)}
              onBlur={() => onFieldBlur('firstName')}
              disabled={shouldDisableFields}
              placeholder="John"
              className={cn('pl-10', firstNameError && 'border-red-300 focus:ring-red-500')}
              aria-required="true"
              aria-invalid={!!firstNameError}
              aria-describedby={firstNameError ? `${firstNameId}-error` : undefined}
            />
          </div>
        </FieldWrapper>

        {/* Last Name */}
        <FieldWrapper id={lastNameId} label="Last Name" error={lastNameError} required>
          <div className="relative">
            <User
              className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400"
              size={16}
              aria-hidden="true"
            />
            <Input
              id={lastNameId}
              type="text"
              value={formData.lastName}
              onChange={(e) => onFieldChange('lastName', e.target.value)}
              onBlur={() => onFieldBlur('lastName')}
              disabled={shouldDisableFields}
              placeholder="Smith"
              className={cn('pl-10', lastNameError && 'border-red-300 focus:ring-red-500')}
              aria-required="true"
              aria-invalid={!!lastNameError}
              aria-describedby={lastNameError ? `${lastNameId}-error` : undefined}
            />
          </div>
        </FieldWrapper>

        {/* Role Selection */}
        <div className="space-y-1.5">
          <Label
            id={`${rolesId}-label`}
            className={cn('text-sm font-medium', rolesError ? 'text-red-600' : 'text-gray-700')}
          >
            Roles
          </Label>
          <p className="text-xs text-gray-500 mb-1">
            Select one or more roles to assign to this user
          </p>
          {rolesFiltered && (
            <p className="text-xs text-blue-600 mb-2 flex items-center gap-1">
              <Shield size={12} aria-hidden="true" />
              <span>Showing roles you have permission to assign</span>
            </p>
          )}

          <div
            role="group"
            aria-labelledby={`${rolesId}-label`}
            aria-describedby={rolesError ? `${rolesId}-error` : undefined}
            className={cn(
              'border rounded-lg p-3 space-y-2 max-h-48 overflow-y-auto',
              rolesError ? 'border-red-300 bg-red-50/30' : 'border-gray-200 bg-white/50'
            )}
          >
            {availableRoles.length === 0 ? (
              <p className="text-sm text-gray-500 italic py-2 text-center">
                No roles available for assignment
              </p>
            ) : (
              availableRoles.map((role) => {
                const isSelected = formData.roleIds.includes(role.id);
                const checkboxId = `${rolesId}-${role.id}`;

                return (
                  <label
                    key={role.id}
                    htmlFor={checkboxId}
                    className={cn(
                      'flex items-start gap-3 p-2 rounded-md cursor-pointer transition-colors',
                      isSelected
                        ? 'bg-blue-50 border border-blue-200'
                        : 'hover:bg-gray-50 border border-transparent',
                      shouldDisableFields && 'opacity-50 cursor-not-allowed'
                    )}
                  >
                    <Checkbox
                      id={checkboxId}
                      checked={isSelected}
                      onCheckedChange={() => onRoleToggle(role.id)}
                      disabled={shouldDisableFields}
                      aria-describedby={`${checkboxId}-desc`}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Shield
                          size={14}
                          className={isSelected ? 'text-blue-600' : 'text-gray-400'}
                          aria-hidden="true"
                        />
                        <span
                          className={cn(
                            'font-medium text-sm',
                            isSelected ? 'text-blue-900' : 'text-gray-900'
                          )}
                        >
                          {role.name}
                        </span>
                        {!role.isActive && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">
                            Inactive
                          </span>
                        )}
                      </div>
                      <p
                        id={`${checkboxId}-desc`}
                        className="text-xs text-gray-500 mt-0.5 line-clamp-2"
                      >
                        {role.description}
                      </p>
                      <div className="flex items-center gap-3 mt-0.5">
                        {role.permissionCount !== undefined && role.permissionCount > 0 && (
                          <span className="text-xs text-gray-400">
                            {role.permissionCount} permission{role.permissionCount !== 1 ? 's' : ''}
                          </span>
                        )}
                        {role.orgHierarchyScope && (
                          <span className="text-xs text-gray-400 font-mono">
                            Scope: {role.orgHierarchyScope}
                          </span>
                        )}
                      </div>
                    </div>
                  </label>
                );
              })
            )}
          </div>

          {rolesError && (
            <p
              id={`${rolesId}-error`}
              className="flex items-center gap-1 text-sm text-red-600"
              role="alert"
            >
              <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
              <span>{rolesError}</span>
            </p>
          )}
        </div>

        {/* Phone Numbers Section (Phase 6) */}
        {onPhonesChange && (
          <InvitationPhoneInput
            phones={phones ?? []}
            onChange={onPhonesChange}
            errors={phoneErrors}
            disabled={shouldDisableFields}
          />
        )}
      </div>
    );
  }
);

UserFormFields.displayName = 'UserFormFields';
